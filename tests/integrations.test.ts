/**
 * Integrace: EET 2.0 (zpráva, podpis, odpovědi, evidence účtenek, dodatečné
 * odeslání), platební terminál (simulátor), tajné údaje, tisk ESC/POS.
 * Síť je nahrazená — skutečný Playground ověřuje ruční skript (viz AGENTS.md).
 */
import { createHash, createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import forge from "node-forge";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { UserError } from "@/core/module";
import { buildEetMessage, openP12, parseEetResponse, pragueDateTime } from "@/modules/int/eet";
import { encodeText, receiptEscPos } from "@/lib/escpos";
import { createPrisma } from "@/server/db";
import { getRecord, inTenant, listRecords, runAction, saveRecord, type Ctx } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { revealSecret, SECRET_MASK } from "@/server/secrets";
import { paymentStart, paymentStatus, assertPaid, eetResendPending, eetRegisterReceipt, connectionsFor } from "@/modules/int/drivers";
import { sell } from "@/modules/pos/sale";

const client = createPrisma();
const run = Date.now().toString(36);
afterAll(() => client.$disconnect());

/** Pokladní certifikát jako z DIS+ (PKCS#12, CN = DIČ). */
function makeP12(dic: string, password: string) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = forge.pki.privateKeyFromPem(privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicKey.export({ type: "spki", format: "pem" }).toString());
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
  cert.setSubject([{ name: "commonName", value: dic }]);
  cert.setIssuer([{ name: "commonName", value: "Test CA" }]);
  cert.sign(key, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(key, [cert], password, { algorithm: "3des" });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary");
}

const POK = "987a6be5-6af5-44f3-b4fc-987654321000-ff";
const okResponse = `<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><tns:Odpoved xmlns:tns="http://fs.gov.cz/eet/schema/v4"><tns:Hlavicka uuid_zpravy="x" dat_prij="2027-01-07T22:01:01+01:00"/><tns:Potvrzeni pok="${POK}" test="true"/><tns:Varovani kod_varov="5">Datum a cas trzby je prilis v minulosti</tns:Varovani></tns:Odpoved></soapenv:Body></soapenv:Envelope>`;

describe("EET 2.0 — zpráva a odpovědi", () => {
  it("podpis nad kanonickým tělem ověřitelný veřejným klíčem certifikátu", () => {
    const cert = openP12(makeP12("CZ8551015704", "aaaa1111").toString("base64"), "aaaa1111");
    expect(cert.subject).toBe("CZ8551015704");
    const m = buildEetMessage(
      { eic: "CZ8551015704", unitId: "202", posId: "Kasa č.1", seq: "U26000001", date: new Date("2027-01-07T21:01:00Z"), amount: "246" },
      cert,
      { first: true, verify: false, uuid: "b16b955b-5913-4edc-b3cc-51e058c70684", sentAt: new Date("2027-01-07T21:01:02Z") },
    );
    // pořadí atributů a hodnoty podle XSD; diakritika pryč, čas v pražském pásmu
    expect(m.body).toContain(
      '<eet:Data celk_trzba="246.00" dat_trzby="2027-01-07T22:01:00+01:00" eic_popl="CZ8551015704" id_jednotky="202" id_pokl="Kasa c.1" porad_cis="U26000001"></eet:Data>',
    );
    expect(m.body).toContain('<eet:Hlavicka dat_odesl="2027-01-07T22:01:02+01:00" prvni_zaslani="true" uuid_zpravy="b16b955b-5913-4edc-b3cc-51e058c70684"></eet:Hlavicka>');
    expect(m.xml).toContain(m.body);
    const digest = /<ds:DigestValue>([^<]+)</.exec(m.xml)![1];
    expect(digest).toBe(createHash("sha256").update(m.body).digest("base64"));
    const signedInfo = /<ds:SignedInfo[\s\S]*<\/ds:SignedInfo>/.exec(m.xml)![0];
    const sig = /<ds:SignatureValue>([^<]+)</.exec(m.xml)![1];
    const certPem = `-----BEGIN CERTIFICATE-----\n${cert.certB64}\n-----END CERTIFICATE-----`;
    expect(verify("sha256", Buffer.from(signedInfo), createPublicKey(certPem), Buffer.from(sig, "base64"))).toBe(true);
    expect(pragueDateTime(new Date("2027-07-01T10:00:00Z"))).toBe("2027-07-01T12:00:00+02:00");
  });

  it("rozbor potvrzení, chyby a dočasné chyby", () => {
    expect(parseEetResponse(okResponse)).toMatchObject({ status: "ok", pok: POK, test: true, warnings: ["5: Datum a cas trzby je prilis v minulosti"] });
    expect(parseEetResponse('<tns:Odpoved><tns:Chyba kod="0">Datovou zpravu ... se podarilo zpracovat</tns:Chyba></tns:Odpoved>')).toMatchObject({ status: "verified" });
    expect(parseEetResponse('<tns:Odpoved><tns:Chyba kod="4">Neplatny podpis SOAP zpravy</tns:Chyba></tns:Odpoved>')).toMatchObject({ status: "error", code: 4, retry: false });
    expect(parseEetResponse('<tns:Odpoved><tns:Chyba kod="-1">Docasna technicka chyba</tns:Chyba></tns:Odpoved>')).toMatchObject({ status: "error", code: -1, retry: true });
  });
});

describe("tisk ESC/POS", () => {
  it("čeština v PC852, řez a zásuvka", () => {
    expect(encodeText("Šunka žluťoučký 2×", "cp852")).toEqual([0xe6, 0x75, 0x6e, 0x6b, 0x61, 0x20, 0xa7, 0x6c, 0x75, 0x9c, 0x6f, 0x75, 0xe8 - 0xe8 + 0x9f, 0x6b, 0xec, 0x20, 0x32, 0x78]);
    expect(encodeText("Šunka", "ascii")).toEqual([0x53, 0x75, 0x6e, 0x6b, 0x61]);
    const bytes = Array.from(
      receiptEscPos(
        {
          receiptNum: "U1",
          issuedAt: "2027-01-07T21:01:00Z",
          register: "Pokladna 1",
          company: { name: "Uzeniny", regNo: "1", vatId: "CZ1", address: null },
          lines: [{ description: "Šunka", qty: "0.25", unit: "KG", unitPrice: "459.90", amount: "114.98", rate: "12" }],
          vat: [{ rate: "12", base: "102.66", tax: "12.32" }],
          gross: "114.98",
          rounding: "0.02",
          paid: "115.00",
          payment: "cash",
          cashGiven: "200.00",
          change: "85.00",
          footer: null,
          eet: { status: "sent", pok: POK },
        },
        { SimplifiedDoc: "Doklad", Rounding: "Zaokr.", Total: "Celkem", Cash: "Hotově", Card: "Kartou", ChangeDue: "Vrátit", VatRecap: "DPH", Base: "Základ", Vat: "DPH", EetLater: "-" },
        (v) => `${Number(v).toFixed(2)} Kč`,
        { width: 48, codePage: "cp852", drawer: true, locale: "cs-CZ" },
      ),
    );
    expect(bytes.slice(0, 5)).toEqual([0x1b, 0x40, 0x1b, 0x74, 18]);
    expect(bytes.slice(5, 10)).toEqual([0x1b, 0x70, 0, 25, 250]);
    expect(bytes.slice(-4)).toEqual([0x1d, 0x56, 66, 0]);
    expect(Buffer.from(bytes).toString("latin1")).toContain(`POK: ${POK}`);
  });
});

describe("napojení pokladny", () => {
  let C: Ctx;
  let regId: string;
  let itemId: string;
  beforeAll(async () => {
    const r = await provisionTenant(client, {
      code: `t-int-${run}`,
      name: "Uzeniny",
      adminEmail: `int-${run}@test.local`,
      adminPassword: "heslo-12345",
      modules: ["pos", "int"],
      company: { code: "UZ", name: "Uzeniny", regNo: "41832744", vatId: "CZ8551015704" },
    });
    C = r.ctx;
    regId = String((await listRecords(C, "pos.register", {}, client)).rows[0].id);
    const g = (await listRecords(C, "inv.itemGroup", {}, client)).rows[0];
    const u = (await listRecords(C, "inv.unit", { filter: { code: "KS" } }, client)).rows[0];
    itemId = String((await saveRecord(C, "inv.item", null, { itemNum: "PAS", name: "Paštika", groupId: g.id, unitId: u.id, salesPrice: "50.13", priceInclTax: true }, undefined, client)).id);
    await saveRecord(C, "pos.shift", null, { registerId: regId }, undefined, client);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("tajné údaje: v databázi šifrovaně, ven jen maska, maska při uložení nic nemění", async () => {
    const conn = await saveRecord(C, "int.connection", null, { code: "EET", name: "EET", kind: "eet", driver: "eet2", unitId: "202", posId: "KASA1", certPassword: "aaaa1111" }, undefined, client);
    expect(conn.certPassword).toBe(SECRET_MASK);
    const raw = await client.intConnection.findUnique({ where: { id: String(conn.id) } });
    expect(String(raw!.certPassword)).toMatch(/^enc:v1:/);
    expect(revealSecret(raw!.certPassword)).toBe("aaaa1111");
    await saveRecord(C, "int.connection", String(conn.id), { certPassword: SECRET_MASK, name: "EET 2.0" }, undefined, client);
    const raw2 = await client.intConnection.findUnique({ where: { id: String(conn.id) } });
    expect(raw2!.certPassword).toBe(raw!.certPassword);
    expect((await listRecords(C, "int.connection", {}, client)).rows[0].certPassword).toBe(SECRET_MASK);

    // ovladač musí patřit k druhu; EET potřebuje jednotku a pokladní zařízení
    await expect(saveRecord(C, "int.connection", null, { code: "X", name: "X", kind: "eet", driver: "sumup" }, undefined, client)).rejects.toBeInstanceOf(UserError);

    // certifikát: špatné heslo odmítne, správné uloží s DIČ a platností
    await expect(runAction(C, "int.connection", String(conn.id), "uploadCert", client, { name: "x.p12", data: makeP12("CZ8551015704", "jine") })).rejects.toMatchObject({ label: "@INT:BadCertificate" });
    await runAction(C, "int.connection", String(conn.id), "uploadCert", client, { name: "x.p12", data: makeP12("CZ8551015704", "aaaa1111") });
    const after = (await getRecord(C, "int.connection", String(conn.id), client))!;
    expect([after.certSubject, after.certData]).toEqual(["CZ8551015704", SECRET_MASK]);
  });

  it("účtenka se zaeviduje (POK), při výpadku čeká a dodatečně se odešle", async () => {
    const api = <T,>(fn: (a: import("@/core/module").DataApi) => Promise<T>) => inTenant(C, (s) => fn(s.sys().api()), client);
    const sent: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      sent.push(init.body);
      return new Response(okResponse, { status: 200, headers: { "X-Global-Transaction-Id": "tx1" } });
    });
    const r1 = await api((a) => sell(a, { registerId: regId, payment: "cash", lines: [{ itemId, qty: "1" }] }));
    const conn = (await api((a) => connectionsFor(a, regId))).eet!;
    expect(await api(async (a) => eetRegisterReceipt(a, C.companyId, conn, (await a.get("pos.receipt", String(r1.id)))!, true))).toBe("sent");
    const rec = (await getRecord(C, "pos.receipt", String(r1.id), client))!;
    expect([rec.eetStatus, rec.eetPok]).toEqual(["sent", POK]);
    // hotovost zaokrouhlená na 50 Kč = celková tržba ve zprávě
    expect(sent[0]).toContain('celk_trzba="50.00"');
    expect(sent[0]).toContain(`porad_cis="${rec.receiptNum}"`);
    expect(sent[0]).toContain('prvni_zaslani="true"');

    // výpadek → čeká; dodatečně s prvni_zaslani=false
    vi.stubGlobal("fetch", async () => {
      throw new Error("connect ETIMEDOUT");
    });
    const r2 = await api((a) => sell(a, { registerId: regId, payment: "cash", lines: [{ itemId, qty: "2" }] }));
    expect(await api(async (a) => eetRegisterReceipt(a, C.companyId, conn, (await a.get("pos.receipt", String(r2.id)))!, true))).toBe("pending");
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      sent.push(init.body);
      return new Response(okResponse, { status: 200 });
    });
    expect(await api((a) => eetResendPending(a, C.companyId, regId))).toEqual({ sent: 1, pending: 0 });
    expect(sent.at(-1)).toContain('prvni_zaslani="false"');
    const log = (await listRecords(C, "int.log", { filter: { connectionId: String(conn.id) } }, client)).rows.map((l) => [l.operation, l.status]);
    expect(log).toEqual(expect.arrayContaining([["eet.send", "ok"], ["eet.send", "pending"], ["eet.resend", "ok"]]));
  });

  it("platba kartou přes simulátor: schválení, zamítnutí, kontrola částky a jediného použití", async () => {
    const api = <T,>(fn: (a: import("@/core/module").DataApi) => Promise<T>) => inTenant(C, (s) => fn(s.sys().api()), client);
    const conn = await saveRecord(C, "int.connection", null, { code: "TERM", name: "Terminál", kind: "payment", driver: "simulator", registerId: regId }, undefined, client);
    const c = (await api((a) => connectionsFor(a, regId))).payment!;
    expect(c.id).toBe(conn.id);
    // 50,13 Kč končí na ,13 → simulátor zamítne
    const declined = await api((a) => paymentStart(a, c, BigInt(5013), "KASA1"));
    const ok = await api((a) => paymentStart(a, c, BigInt(10026), "KASA1"));
    expect(await api((a) => paymentStatus(a, c, ok.ref))).toMatchObject({ state: "pending" });
    await new Promise((r) => setTimeout(r, 3100));
    expect(await api((a) => paymentStatus(a, c, declined.ref))).toMatchObject({ state: "failed" });
    expect(await api((a) => paymentStatus(a, c, ok.ref))).toMatchObject({ state: "successful" });
    await expect(api((a) => assertPaid(a, c, ok.ref, BigInt(5013)))).rejects.toBeInstanceOf(UserError);
    await expect(api((a) => assertPaid(a, c, declined.ref, BigInt(5013)))).rejects.toBeInstanceOf(UserError);
    await api((a) => assertPaid(a, c, ok.ref, BigInt(10026)));
    await api((a) => sell(a, { registerId: regId, payment: "card", paymentRef: ok.ref, lines: [{ itemId, qty: "2" }] }));
    await expect(api((a) => assertPaid(a, c, ok.ref, BigInt(10026)))).rejects.toBeInstanceOf(UserError);
  }, 15000);
});

describe("organizace", () => {
  it("výchozí údaje z firmy a daňových parametrů, propis do firmy, adresa na účtence", async () => {
    const r = await provisionTenant(client, {
      code: `t-org-${run}`,
      name: "Org",
      adminEmail: `org-${run}@test.local`,
      adminPassword: "heslo-12345",
      modules: ["org", "pos"],
      company: { code: "UZ", name: "Demo s.r.o.", regNo: "12345678", vatId: "CZ12345678" },
    });
    const O = r.ctx;
    const [e] = (await listRecords(O, "org.entity", {}, client)).rows;
    expect([e.legalName, e.regNo, e.vatId, e.legalForm]).toEqual(["Demo s.r.o.", "12345678", "CZ12345678", "legal"]);
    await expect(saveRecord(O, "org.entity", null, { legalName: "Druhá" }, undefined, client)).rejects.toMatchObject({ label: "@ORG:OneEntity" });
    await expect(saveRecord(O, "org.entity", String(e.id), { bankAccount: "123" }, undefined, client)).rejects.toBeInstanceOf(UserError);

    await saveRecord(O, "org.entity", String(e.id), {
      legalName: "Hynek Cibulka",
      tradeName: "Uzeniny Hynek Cibulka",
      legalForm: "natural",
      firstName: "Hynek",
      lastName: "Cibulka",
      regNo: "41832744",
      street: "Uhelný trh",
      houseNo: "413",
      orientNo: "8",
      city: "Praha 1",
      zipCode: "110 00",
      bankAccount: "19-2000145399/0800",
    }, undefined, client);
    const company = (await getRecord(O, "sys.company", O.companyId!, client))!;
    expect([company.name, company.regNo]).toEqual(["Uzeniny Hynek Cibulka", "41832744"]);

    const regId = String((await listRecords(O, "pos.register", {}, client)).rows[0].id);
    const g = (await listRecords(O, "inv.itemGroup", {}, client)).rows[0];
    const u = (await listRecords(O, "inv.unit", { filter: { code: "KS" } }, client)).rows[0];
    const it = await saveRecord(O, "inv.item", null, { itemNum: "X", name: "X", groupId: g.id, unitId: u.id, salesPrice: "10", priceInclTax: true }, undefined, client);
    await saveRecord(O, "pos.shift", null, { registerId: regId }, undefined, client);
    const print = await inTenant(O, async (s) => {
      const a = s.sys().api();
      const rec = await sell(a, { registerId: regId, payment: "card", lines: [{ itemId: String(it.id), qty: "1" }] });
      const { receiptPrint } = await import("@/modules/pos/sale");
      return receiptPrint(a, O.companyId, String(rec.id));
    }, client);
    expect(print.company).toEqual({ name: "Hynek Cibulka", tradeName: "Uzeniny Hynek Cibulka", regNo: "41832744", vatId: "CZ12345678", address: "Uhelný trh 413/8, 110 00 Praha 1" });
  });
});

describe("položky: marže, slevy, ARES", () => {
  let D: Ctx;
  beforeAll(async () => {
    D = (
      await provisionTenant(client, {
        code: `t-disc-${run}`,
        name: "Slevy",
        adminEmail: `disc-${run}@test.local`,
        adminPassword: "heslo-12345",
        modules: ["pos", "ap"],
        company: { code: "UZ", name: "Uzeniny" },
      })
    ).ctx;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("marže z prodejní ceny bez DPH, nejvýhodnější sleva v pokladně", async () => {
    const g = (await listRecords(D, "inv.itemGroup", {}, client)).rows[0];
    const u = (await listRecords(D, "inv.unit", { filter: { code: "KG" } }, client)).rows[0];
    // 229 Kč s DPH 21 % (skupina ZBOZI) = 189,26 bez DPH; nákup 139 → marže 26,56 %
    const it = await saveRecord(D, "inv.item", null, { itemNum: "SPEK", name: "Iberijský špek", groupId: g.id, unitId: u.id, salesPrice: "229", priceInclTax: true, purchasePrice: "139", weighed: true }, undefined, client);
    expect([it.priceNet, it.marginPct]).toEqual(["189.26", "26.5600"]);
    await saveRecord(D, "inv.discount", null, { code: "SKUP10", name: "Skupina −10 %", kind: "percent", percent: "10", groupId: g.id }, undefined, client);
    await saveRecord(D, "inv.discount", null, { code: "AKCE", name: "Akce týdne", kind: "price", price: "199", itemId: it.id, validFrom: "2020-01-01", validTo: "2099-12-31" }, undefined, client);
    await saveRecord(D, "inv.discount", null, { code: "STARA", name: "Stará akce", kind: "price", price: "99", itemId: it.id, validTo: "2020-01-01" }, undefined, client);
    await expect(saveRecord(D, "inv.discount", null, { code: "X", name: "X", kind: "percent", percent: "0" }, undefined, client)).rejects.toBeInstanceOf(UserError);

    const regId = String((await listRecords(D, "pos.register", {}, client)).rows[0].id);
    await saveRecord(D, "pos.shift", null, { registerId: regId }, undefined, client);
    const r = await inTenant(D, (s) => sell(s.sys().api(), { registerId: regId, payment: "card", lines: [{ itemId: String(it.id), qty: "0.5" }] }), client);
    const [line] = (await listRecords(D, "pos.receiptLine", { filter: { receiptId: String(r.id) } }, client)).rows;
    // −10 % = 206,10 vs. akční 199 → 199; propadlá akce 99 se nepoužije
    expect([line.unitPrice, line.originalPrice, line.amountGross]).toEqual(["199.00", "229.00", "99.50"]);
  });

  it("ARES: doplní subjekt a sídlo podle IČO, partner přes svůj subjekt", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      expect(String(url)).toContain("/ekonomicke-subjekty/27079864");
      return new Response(
        JSON.stringify({
          ico: "27079864",
          obchodniJmeno: "Řeznictví a uzenářství U DOLEJŠÍCH s.r.o.",
          dic: "CZ27079864",
          pravniForma: "112",
          sidlo: { kodStatu: "CZ", nazevObce: "Davle", nazevUlice: "Na náměstí", cisloDomovni: 97, psc: 25206 },
        }),
        { status: 200 },
      );
    });
    const subj = await saveRecord(D, "gab.subject", null, { name: "U Dolejších", regNo: "27079864" }, undefined, client);
    const grp = (await listRecords(D, "ap.group", {}, client)).rows[0];
    const vendor = await saveRecord(D, "ap.vendor", null, { subjectId: subj.id, groupId: grp.id }, undefined, client);
    await runAction(D, "ap.vendor", String(vendor.id), "ares", client);
    const s2 = (await getRecord(D, "gab.subject", String(subj.id), client))!;
    expect([s2.name, s2.vatId, s2.type]).toEqual(["Řeznictví a uzenářství U DOLEJŠÍCH s.r.o.", "CZ27079864", "organization"]);
    const [addr] = (await listRecords(D, "gab.address", { filter: { subjectId: String(subj.id) } }, client)).rows;
    expect([addr.street, addr.city, addr.zipCode, addr.kind]).toEqual(["Na náměstí 97", "Davle", "252 06", "registered"]);
  });
});

describe("obrázky položek", () => {
  it("import se složkou obrázků (spárování podle cesty), stejný soubor se neukládá znovu, ruční nahrání a odebrání", async () => {
    const { importRecords, parseCsv, imagesFromUploads } = await import("@/server/import");
    const { setImage } = await import("@/server/docuref");
    const C = (
      await provisionTenant(client, { code: `t-img-${run}`, name: "Img", adminEmail: `img-${run}@test.local`, adminPassword: "heslo-12345", modules: ["inv"], company: { code: "I", name: "I" } })
    ).ctx;
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
    // cesta z Windows (zpětná lomítka), soubory ze složky v prohlížeči (dopředná)
    const win = ["C:", "Data", "nahledy", "antoni", "002_spek.jpg"].join(String.fromCharCode(92));
    const csv = `Číslo položky;Název;Skupina;MJ;Obrázek\nA1;Šunka;ZBOZI;KG;${win}\nA2;Salám;ZBOZI;KG;chybi.jpg`;
    const uploads = imagesFromUploads([{ path: "nahledy/antoni/002_spek.jpg", data: jpg }]);
    const first = await importRecords(C, "inv.item", parseCsv(csv), { dryRun: false, lang: "cs", images: uploads }, client);
    // chybějící obrázek položku neblokuje — jen upozornění
    expect([first.applied, first.created, first.errors.length]).toEqual([true, 2, 0]);
    expect(first.warnings[0]).toMatchObject({ row: 3, column: "Obrázek" });
    const it1 = (await listRecords(C, "inv.item", { filter: { itemNum: "A1" } }, client)).rows[0];
    expect(it1.image).toMatch(/^[0-9a-f-]{36}$/);
    // znovu stejný soubor → beze změny
    await importRecords(C, "inv.item", parseCsv(csv.split("\n").slice(0, 2).join("\n")), { dryRun: false, lang: "cs", images: uploads }, client);
    expect((await listRecords(C, "inv.item", { filter: { itemNum: "A1" } }, client)).rows[0].image).toBe(it1.image);
    // ruční nahrání: jiný soubor nahradí starý, ne-obrázek odmítne, odebrání
    await expect(setImage(C, "inv.item", String(it1.id), "image", { name: "x.txt", data: Buffer.from("ahoj") }, client)).rejects.toMatchObject({ label: "@SYS:ImageInvalid" });
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50)]);
    const newId = await setImage(C, "inv.item", String(it1.id), "image", { name: "nova.png", data: png }, client);
    expect(newId).not.toBe(it1.image);
    expect(await client.sysDocuRef.count({ where: { id: String(it1.image) } })).toBe(0);
    await setImage(C, "inv.item", String(it1.id), "image", null, client);
    expect((await getRecord(C, "inv.item", String(it1.id), client))!.image).toBeNull();
  });
});

describe("parametry hlavní knihy a kurzy ECB", () => {
  it("výchozí parametry, kurz ze zvoleného zdroje vůči účetní měně, ruční kurz má přednost", async () => {
    const { parseEcb } = await import("@/modules/sys/currency");
    const { ledgerRate } = await import("@/modules/gl/posting");
    const xml = `<gesmes:Envelope><Cube><Cube time='2026-11-12'><Cube currency='USD' rate='1.0800'/><Cube currency='CZK' rate='25.000'/></Cube></Cube></gesmes:Envelope>`;
    const days = parseEcb(xml);
    expect(days.get("2026-11-12")!.get("CZK")).toBe(25);
    const G = (await provisionTenant(client, { code: `t-gl-${run}`, name: "GL", adminEmail: `gl-${run}@test.local`, adminPassword: "heslo-12345", modules: ["gl"], company: { code: "G", name: "G" } })).ctx;
    const [p] = (await listRecords(G, "gl.parameters", {}, client)).rows;
    expect([p.rateSource, p.rateMaxAgeDays, (p._titles as Record<string, string>).accountingCurrencyId]).toEqual(["cnb", 7, "CZK"]);
    expect((p._titles as Record<string, string>).realizedGainAccountId).toBe("663000");
    await expect(saveRecord(G, "gl.parameters", null, { accountingCurrencyId: p.accountingCurrencyId }, undefined, client)).rejects.toMatchObject({ label: "@GL:OneParameters" });
    // přepnout na ECB: kurz USD se dopočte přes EUR (25 / 1,08)
    await saveRecord(G, "gl.parameters", String(p.id), { rateSource: "ecb" }, undefined, client);
    vi.stubGlobal("fetch", async () => new Response(xml.replace("2026-11-12", new Date().toISOString().slice(0, 10)), { status: 200 }));
    const usd = (await listRecords(G, "sys.currency", { filter: { code: "USD" } }, client)).rows[0];
    const today = new Date().toISOString().slice(0, 10);
    const r = await inTenant(G, (s) => ledgerRate(s.sys().api(), G.companyId, String(usd.id), today), client);
    expect([r.rate, r.amount]).toEqual(["23.148148", 1]);
    // ruční kurz téhož dne má přednost
    await saveRecord(G, "sys.exchangeRate", null, { currencyId: usd.id, date: today, rate: "22", base: "CZK", source: "manual" }, undefined, client);
    const r2 = await inTenant(G, (s) => ledgerRate(s.sys().api(), G.companyId, String(usd.id), today), client);
    expect(r2.rate).toBe("22.000000");
    vi.unstubAllGlobals();
  });
});
