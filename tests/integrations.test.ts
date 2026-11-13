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
    expect((await listRecords(C, "int.connection", { filter: { kind: "eet" } }, client)).rows[0].certPassword).toBe(SECRET_MASK);

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
    // systémové účty podle osnovy, chybějící hlásí srozumitelně
    const sys = (await listRecords(G, "gl.systemAccount", {}, client)).rows;
    expect(Object.fromEntries(sys.map((r) => [r.postingType, (r._titles as Record<string, string>).accountId.slice(0, 6)]))).toMatchObject({ realizedGain: "663000", roundingGain: "648000", error: "395000", profitLoss: "431000" });
    const { systemAccount } = await import("@/modules/gl/posting");
    const { inTenant } = await import("@/server/data");
    // druh jen jednou; bez nastaveného účtu srozumitelná chyba
    await expect(saveRecord(G, "gl.systemAccount", null, { postingType: "roundingGain", accountId: sys[0].accountId }, undefined, client)).rejects.toBeTruthy();
    const pg = sys.find((r) => r.postingType === "pennyGain")!;
    await inTenant(G, async (s) => expect(await systemAccount(s.sys().api(), "pennyGain")).toBe(pg.accountId), client);
    await expect(inTenant(G, (s) => systemAccount(s.sys().api(), "nothing"), client)).rejects.toMatchObject({ label: "@GL:SystemAccountMissing" });
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

describe("testování a vývoj", () => {
  it("funkce, scénář s výsledkem, požadavek s číslem a vazbami", async () => {
    const Q = (await provisionTenant(client, { code: `t-qa-${run}`, name: "QA", adminEmail: `qa-${run}@test.local`, adminPassword: "heslo-12345", modules: ["qa"], company: { code: "Q", name: "Q" } })).ctx;
    const f = await saveRecord(Q, "qa.feature", null, { code: "POS-SALE", name: "Prodej", status: "fat" }, undefined, client);
    const sc = await saveRecord(Q, "qa.scenario", null, { code: "UAT-1", title: "Prodej na váhu", featureId: f.id, stage: "uat", result: "failed" }, undefined, client);
    expect(sc.testedAt).toBe(new Date().toISOString().slice(0, 10));
    const iss = await saveRecord(Q, "qa.issue", null, { type: "bug", title: "Špatné zaokrouhlení", featureId: f.id, scenarioId: sc.id, priority: "high" }, undefined, client);
    expect(String(iss.issueNum)).toMatch(/^CR\d{2}-0001$/);
    expect(iss.status).toBe("new");
  });
});

describe("finanční dimenze", () => {
  it("pravidla podle začátku účtu, povinná / nepovolená v deníku, partner z faktury, popisky", async () => {
    const D = (await provisionTenant(client, { code: `t-dim-${run}`, name: "Dim", adminEmail: `dim-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar"], company: { code: "D", name: "D" } })).ctx;
    const dims = (await listRecords(D, "gl.dimension", {}, client)).rows;
    expect(dims.map((d) => [d.position, d.code, d.source])).toEqual([[1, "STR", "custom"], [2, "ZAK", "custom"], [3, "PAR", "partner"]]);
    const str = dims[0];
    await saveRecord(D, "gl.dimensionValue", null, { dimensionId: str.id, code: "prodejna", name: "Prodejna" }, undefined, client);
    // náklady (5) vyžadují středisko, účet 518100 ho naopak nepovoluje (nejdelší shoda)
    await saveRecord(D, "gl.dimensionRule", null, { dimensionId: str.id, accountMask: "5", requirement: "mandatory" }, undefined, client);
    await saveRecord(D, "gl.dimensionRule", null, { dimensionId: str.id, accountMask: "5181", requirement: "notAllowed" }, undefined, client);
    const acc = async (n: string) => (await listRecords(D, "gl.account", { filter: { accountNum: n } }, client)).rows[0];
    expect([(await acc("518000")).dim1Req, (await acc("518100")).dim1Req, (await acc("604000")).dim1Req]).toEqual(["mandatory", "notAllowed", "optional"]);
    // nový účet převezme nastavení z pravidel
    expect((await saveRecord(D, "gl.account", null, { accountNum: "512100", name: "Cestovné tuzemsko" }, undefined, client)).dim1Req).toBe("mandatory");

    const j = await saveRecord(D, "gl.journal", null, { date: "2026-11-12", description: "Dimenze" }, undefined, client);
    const a518 = await acc("518000");
    await expect(saveRecord(D, "gl.journalLine", null, { journalId: j.id, accountId: a518.id, debit: "100" }, undefined, client)).rejects.toMatchObject({ label: "@GL:DimMandatory" });
    await expect(saveRecord(D, "gl.journalLine", null, { journalId: j.id, accountId: a518.id, debit: "100", dim1: "SKLAD" }, undefined, client)).rejects.toMatchObject({ label: "@GL:DimValueUnknown" });
    await expect(saveRecord(D, "gl.journalLine", null, { journalId: j.id, accountId: (await acc("518100")).id, debit: "100", dim1: "PRODEJNA" }, undefined, client)).rejects.toMatchObject({ label: "@GL:DimNotAllowed" });
    await saveRecord(D, "gl.journalLine", null, { journalId: j.id, accountId: a518.id, debit: "100", dim1: "prodejna" }, undefined, client);
    await saveRecord(D, "gl.journalLine", null, { journalId: j.id, accountId: (await acc("395000")).id, credit: "100" }, undefined, client);
    await runAction(D, "gl.journal", String(j.id), "post", client);
    const posted = (await getRecord(D, "gl.journal", String(j.id), client))!;
    const tr = (await listRecords(D, "gl.trans", { filter: { voucherId: String(posted.voucherId) } }, client)).rows;
    expect(tr.find((t) => t.accountId === a518.id)!.dim1).toBe("PRODEJNA");

    // vydaná faktura: partner = číslo odběratele, doplní se sám na všech řádcích zápisu
    const grp = (await listRecords(D, "ar.group", {}, client)).rows[0];
    const subj = await saveRecord(D, "gab.subject", null, { name: "Restaurace" }, undefined, client);
    const cust = await saveRecord(D, "ar.customer", null, { subjectId: subj.id, groupId: grp.id }, undefined, client);
    const inv = await saveRecord(D, "ar.invoice", null, { customerId: cust.id, invoiceDate: "2026-11-12" }, undefined, client);
    await saveRecord(D, "ar.invoiceLine", null, { invoiceId: inv.id, description: "Catering", qty: "1", unitPrice: "1000" }, undefined, client);
    await runAction(D, "ar.invoice", String(inv.id), "post", client);
    const v = (await getRecord(D, "ar.invoice", String(inv.id), client))!.voucherId;
    const lines = (await listRecords(D, "gl.trans", { filter: { voucherId: String(v) } }, client)).rows;
    expect(lines.every((l) => l.dim3 === cust.accountNum)).toBe(true);
  });
});

describe("výkazy hlavní knihy", () => {
  it("předvaha, výsledovka a rozvaha ze zápisů; filtr dimenze; po syntetice", async () => {
    const { trialBalance, incomeStatement, balanceSheet } = await import("@/modules/gl/reports");
    const R = (await provisionTenant(client, { code: `t-rep-${run}`, name: "Rep", adminEmail: `rep-${run}@test.local`, adminPassword: "heslo-12345", modules: ["gl"], company: { code: "R", name: "R" } })).ctx;
    const acc = async (n: string) => (await listRecords(R, "gl.account", { filter: { accountNum: n } }, client)).rows[0];
    const str = (await listRecords(R, "gl.dimension", { filter: { code: "STR" } }, client)).rows[0];
    await saveRecord(R, "gl.dimensionValue", null, { dimensionId: str.id, code: "A", name: "A" }, undefined, client);
    const post = async (date: string, lines: [string, string, string?][]) => {
      const j = await saveRecord(R, "gl.journal", null, { date, description: "x" }, undefined, client);
      for (const [num, amount, dim] of lines) {
        const a = await acc(num);
        const v = Number(amount);
        await saveRecord(R, "gl.journalLine", null, { journalId: j.id, accountId: a.id, ...(v > 0 ? { debit: amount } : { credit: String(-v) }), ...(dim ? { dim1: dim } : {}) }, undefined, client);
      }
      await runAction(R, "gl.journal", String(j.id), "post", client);
    };
    await post("2026-01-05", [["395000", "1000"], ["411000", "-1000"]]); // počáteční vklad
    await post("2026-03-10", [["518000", "300", "A"], ["395000", "-300"]]);
    await post("2026-03-11", [["518100", "200"], ["395000", "-200"]]);
    await post("2026-03-12", [["395000", "900"], ["602000", "-900"]]);
    const run2 = (def: typeof trialBalance, p: Record<string, unknown>) =>
      inTenant(R, (s) => def.run(s.sys().api(), p, { companyId: R.companyId, t: (x) => x }), client);
    const tb = await run2(trialBalance, { dateFrom: "2026-03-01", dateTo: "2026-03-31" });
    const row = (n: string) => tb.rows.find((r) => r.account === n)!;
    expect([row("395000").opening, row("395000").debit, row("395000").credit, row("395000").closing]).toEqual(["1000.00", "900.00", "500.00", "1400.00"]);
    const syn = await run2(trialBalance, { dateFrom: "2026-03-01", dateTo: "2026-03-31", bySynthetic: true });
    expect(syn.rows.find((r) => r.account === "518")!.debit).toBe("500.00");
    const dimA = await run2(trialBalance, { dateFrom: "2026-03-01", dateTo: "2026-03-31", dim1: "a" });
    expect(dimA.rows.map((r) => r.account)).toEqual(["518000"]);
    const is = await run2(incomeStatement, { dateFrom: "2026-01-01", dateTo: "2026-12-31" });
    expect(is.rows.at(-1)!.amount).toBe("400.00"); // 900 − 500
    const bs = await run2(balanceSheet, { dateTo: "2026-12-31" });
    expect(bs.rows.find((r) => r.name === "@GL:Assets")!.amount).toBe("1400.00");
    expect(bs.rows.find((r) => r.name === "@GL:LiabilitiesEquity")!.amount).toBe("1400.00"); // 1000 kapitál + 400 výsledek
  });
});

describe("kategorie prodeje", () => {
  it("strom z jednoho souboru (nadřazená v témže importu), zákaz cyklu", async () => {
    const { importRecords, parseCsv } = await import("@/server/import");
    const K = (await provisionTenant(client, { code: `t-cat-${run}`, name: "Cat", adminEmail: `cat-${run}@test.local`, adminPassword: "heslo-12345", modules: ["inv"], company: { code: "K", name: "K" } })).ctx;
    const r = await importRecords(K, "inv.category", parseCsv("Kód;Název;Nadřazená kategorie;Pořadí\nUZENINY;Uzeniny;;10\nSALAMY;Salámy;UZENINY;11"), { dryRun: false, lang: "cs" }, client);
    expect([r.created, r.errors.length]).toEqual([2, 0]);
    const [root] = (await listRecords(K, "inv.category", { filter: { code: "UZENINY" } }, client)).rows;
    const [child] = (await listRecords(K, "inv.category", { filter: { code: "SALAMY" } }, client)).rows;
    expect(child.parentId).toBe(root.id);
    await expect(saveRecord(K, "inv.category", String(root.id), { parentId: child.id }, undefined, client)).rejects.toMatchObject({ fields: { parentId: "@INV:CategoryLoop" } });
  });
});

describe("diskuze u požadavků", () => {
  it("příspěvek s autorem a datem, vývoj se přiřadí vývojáři", async () => {
    const Q = (await provisionTenant(client, { code: `t-qad-${run}`, name: "QA", adminEmail: `qad-${run}@test.local`, adminPassword: "heslo-12345", modules: ["qa"], company: { code: "Q", name: "Q" } })).ctx;
    const iss = await saveRecord(Q, "qa.issue", null, { title: "Kasa: kategorie", status: "development" }, undefined, client);
    expect(iss.assignedTo).toBe("Claude (vývoj)");
    const c = await saveRecord({ ...Q, userName: "Václav" }, "qa.comment", null, { issueId: iss.id, text: "Na tabletu je tlačítko moc malé." }, undefined, client);
    expect([c.author, c.postedAt]).toEqual(["Václav", new Date().toISOString().slice(0, 10)]);
  });
});

describe("REST API", () => {
  it("klíč s rozsahem qa: čte a zakládá požadavky, jinam ne, bez klíče 401", async () => {
    const { GET, POST, PATCH } = await import("@/app/api/v1/[[...path]]/route");
    const A = (await provisionTenant(client, { code: `t-api-${run}`, name: "API", adminEmail: `api-${run}@test.local`, adminPassword: "heslo-12345", modules: ["qa", "int", "inv"], company: { code: "A", name: "A" } })).ctx;
    await expect(saveRecord(A, "int.connection", null, { code: "BAD", name: "x", kind: "api", driver: "rest", scopes: "sys" }, undefined, client)).rejects.toMatchObject({ fields: { scopes: "@INT:ScopeUnknown" } });
    const conn = await saveRecord(A, "int.connection", null, { code: "CLAUDE", name: "Claude", kind: "api", driver: "rest", scopes: "qa" }, undefined, client);
    const file = await inTenant(A, (s) => s.download("int.connection", String(conn.id), "token"), client);
    const token = String(file.data).trim().split("\n").pop()!;
    const call = (m: typeof GET, path: string[], init: RequestInit = {}, auth = `Bearer ${token}`) =>
      m(new Request(`http://x/api/v1/${path.join("/")}`, { ...init, headers: { authorization: auth, "content-type": "application/json" } }), { params: Promise.resolve({ path }) });
    expect((await call(GET, ["qa.issue"], {}, "Bearer shn.nic")).status).toBe(401);
    const created = await call(POST, ["qa.issue"], { method: "POST", body: JSON.stringify({ title: "Z API", status: "development" }) });
    expect(created.status).toBe(201);
    const iss = await created.json();
    expect(iss.assignedTo).toBe("Claude (vývoj)");
    const upd = await (await call(PATCH, ["qa.issue", iss.id], { method: "PATCH", body: JSON.stringify({ status: "uat" }) })).json();
    expect(upd.status).toBe("uat");
    const c = await (await call(POST, ["qa.comment"], { method: "POST", body: JSON.stringify({ issueId: iss.id, text: "Hotovo k testu." }) })).json();
    expect(c.author).toBe("API · Claude");
    const list = await (await call(GET, ["qa.issue"])).json();
    expect(list.rows.some((r: { id: string }) => r.id === iss.id)).toBe(true);
    expect((await call(GET, ["inv.item"])).status).toBe(403);
    expect((await call(POST, ["qa.issue"], { method: "POST", body: JSON.stringify({ status: "uat" }) })).status).toBe(400);
  });
});

describe("dávkové úlohy", () => {
  it("plán: pražský čas, přechod času, měsíce, bez dohánění", async () => {
    const { nextPragueTime, nextRun } = await import("@/server/batch");
    // 14:45 v Praze v zimě = 13:45 UTC, v létě 12:45 UTC
    expect(nextPragueTime("14:45", new Date("2026-11-13T10:00:00Z")).toISOString()).toBe("2026-11-13T13:45:00.000Z");
    expect(nextPragueTime("14:45", new Date("2026-07-01T15:00:00Z")).toISOString()).toBe("2026-07-02T12:45:00.000Z");
    // denně přes konec letního času drží 02:00 Prahy
    expect(nextRun(new Date("2026-10-24T00:00:00Z"), "days", 1, new Date("2026-10-25T12:00:00Z"))!.toISOString()).toBe("2026-10-26T01:00:00.000Z");
    expect(nextRun(new Date("2026-01-31T09:00:00Z"), "months", 1, new Date("2026-02-01T00:00:00Z"))!.getUTCMonth()).toBe(2);
    // zmeškané běhy: další termín je až po „teď“, ne hromada běhů
    expect(nextRun(new Date("2026-11-01T10:00:00Z"), "minutes", 15, new Date("2026-11-13T10:07:00Z"))!.toISOString()).toBe("2026-11-13T10:15:00.000Z");
    expect(nextRun(new Date(), "once", 1)).toBeNull();
  });

  it("výchozí úlohy, Spustit nyní, plánovač spustí splatnou úlohu", async () => {
    const { runDueJobs } = await import("@/server/batch");
    const B = (await provisionTenant(client, { code: `t-bat-${run}`, name: "Batch", adminEmail: `bat-${run}@test.local`, adminPassword: "heslo-12345", modules: ["gl", "int"], company: { code: "B", name: "B" } })).ctx;
    const jobs = (await listRecords(B, "sys.batchJob", {}, client)).rows;
    expect(jobs.map((j) => j.jobClass).sort()).toEqual(["gl.dimensionRules", "int.eetResend", "sys.ratesCnb", "sys.ratesEcb"]);
    const dim = jobs.find((j) => j.jobClass === "gl.dimensionRules")!;
    await runAction(B, "sys.batchJob", String(dim.id), "run", client);
    const after = await getRecord(B, "sys.batchJob", String(dim.id), client);
    expect([after!.status, String(after!.lastMessage)]).toEqual(["ok", expect.stringMatching(/^Upraveno účtů: \d+\.$/)]);
    // splatná úloha (EET bez pokladen) — plánovač ji spustí a posune termín
    const eet = jobs.find((j) => j.jobClass === "int.eetResend")!;
    const past = new Date(Date.now() - 3600000).toISOString();
    await saveRecord(B, "sys.batchJob", String(eet.id), { nextRunAt: past }, undefined, client);
    expect(await runDueJobs(new Date(), client)).toBeGreaterThanOrEqual(1);
    const e2 = await getRecord(B, "sys.batchJob", String(eet.id), client);
    expect([e2!.status, e2!.lastMessage]).toEqual(["ok", "Odesláno 0, čeká 0."]);
    expect(new Date(String(e2!.nextRunAt)).getTime()).toBeGreaterThan(Date.now());
    const runs = (await listRecords(B, "sys.batchRun", { filter: { jobId: eet.id } }, client)).rows;
    expect(runs.length).toBe(1);
  });
});

describe("Duplikovat", () => {
  it("číselník → předvyplněné hodnoty bez klíče; doklad s řadou → kopie s novým číslem, bez diskuze", async () => {
    const { duplicateRecord } = await import("@/server/duplicate");
    const Q = (await provisionTenant(client, { code: `t-dup-${run}`, name: "Dup", adminEmail: `dup-${run}@test.local`, adminPassword: "heslo-12345", modules: ["qa", "gl"], company: { code: "D", name: "D" } })).ctx;
    const [acc] = (await listRecords(Q, "gl.account", { filter: { accountNum: "211000" } }, client)).rows;
    const a = await duplicateRecord(Q, "gl.account", String(acc.id), client);
    expect(a && "values" in a && a.values.accountNum).toBeUndefined();
    expect(a && "values" in a && a.values.name).toBe(acc.name);
    const iss = await saveRecord(Q, "qa.issue", null, { title: "Šablona", priority: "high" }, undefined, client);
    await saveRecord(Q, "qa.comment", null, { issueId: iss.id, text: "x" }, undefined, client);
    const d = await duplicateRecord(Q, "qa.issue", String(iss.id), client);
    expect(d && "id" in d).toBe(true);
    const copy = await getRecord(Q, "qa.issue", (d as { id: string }).id, client);
    expect([copy!.title, copy!.priority, copy!.issueNum === iss.issueNum]).toEqual(["Šablona", "high", false]);
    expect((await listRecords(Q, "qa.comment", { filter: { issueId: copy!.id } }, client)).total).toBe(0);
  });
});

describe("zaokrouhlení podle měny", () => {
  it("roundCents: koruny, nahoru, dolů, 0,05, záporné", async () => {
    const { roundCents } = await import("@/core/money");
    const c = (n: number) => BigInt(n);
    expect([roundCents(c(12349), "1"), roundCents(c(12350), "1"), roundCents(c(12301), "1", "up"), roundCents(c(12399), "1", "down")]).toEqual([c(12300), c(12400), c(12400), c(12300)]);
    expect([roundCents(c(1232), "0.05"), roundCents(c(1233), "0.05"), roundCents(c(-12350), "1"), roundCents(c(12345), "0.01")]).toEqual([c(1230), c(1235), c(-12400), c(12345)]);
  });
});

describe("odložené nákupy (boxy)", () => {
  it("box s QR: otevře/založí nákup, souběh hlídá verze, zaplacení uvolní box", async () => {
    const { boxByCode, basketForBox, saveBasket, openBaskets } = await import("@/modules/pos/basket");
    const { sell } = await import("@/modules/pos/sale");
    const { inTenant } = await import("@/server/data");
    const P = (await provisionTenant(client, { code: `t-box-${run}`, name: "Box", adminEmail: `box-${run}@test.local`, adminPassword: "heslo-12345", modules: ["pos"], company: { code: "B", name: "B" } })).ctx;
    const reg = String((await listRecords(P, "pos.register", {}, client)).rows[0].id);
    const g = (await listRecords(P, "inv.itemGroup", {}, client)).rows[0];
    const u = (await listRecords(P, "inv.unit", { filter: { code: "KS" } }, client)).rows[0];
    const item = String((await saveRecord(P, "inv.item", null, { itemNum: "SAL", name: "Salám", groupId: g.id, unitId: u.id, salesPrice: "100", priceInclTax: true }, undefined, client)).id);
    await saveRecord(P, "pos.shift", null, { registerId: reg }, undefined, client);
    await expect(saveRecord(P, "pos.box", null, { code: "B 7" }, undefined, client)).rejects.toBeTruthy();
    await saveRecord(P, "pos.box", null, { code: "B07" }, undefined, client);
    await inTenant(P, async (s) => {
      const api = s.sys().api();
      expect(await boxByCode(api, "nic")).toBeNull();
      const box = (await boxByCode(api, " b07 "))!;
      const b1 = await basketForBox(api, box, reg);
      expect([b1.label, b1.boxCode, b1.lines.length]).toEqual(["B07", "B07", 0]);
      // váha přidá položku, druhé načtení boxu vrátí stejný nákup
      const b2 = await saveBasket(api, { id: b1.id, registerId: reg, version: b1.version, lines: [{ itemId: item, qty: "2" }] });
      expect((await basketForBox(api, box, reg)).id).toBe(b1.id);
      // kasa se starou verzí → konflikt
      await expect(saveBasket(api, { id: b1.id, registerId: reg, version: b1.version, lines: [] })).rejects.toMatchObject({ label: "@POS:BasketChanged" });
      // box obsazený, nový nákup pod stejný box nejde; pod jméno ano
      await expect(saveBasket(api, { boxCode: "B07", registerId: reg, lines: [] })).rejects.toMatchObject({ label: "@POS:BoxBusy" });
      const named = await saveBasket(api, { label: "Novák", boxCode: "Novák", registerId: reg, lines: [{ itemId: item, qty: "1" }] });
      expect([named.label, named.boxCode]).toEqual(["Novák", null]);
      expect((await openBaskets(api)).map((b) => b.label)).toEqual(["B07", "Novák"]);
      // zaplacení nákupu boxu → box volný
      const r = await sell(api, { registerId: reg, payment: "cash", lines: b2.lines, basketId: b2.id });
      expect((await api.get("pos.basket", b2.id))!.receiptId).toBe(r.id);
      expect((await openBaskets(api)).map((b) => b.label)).toEqual(["Novák"]);
      expect((await basketForBox(api, box, reg)).id).not.toBe(b1.id);
    }, client);
  });
});

describe("výchozí dimenze a hodnoty z adresáře (CR-001)", () => {
  it("dimenze z adresáře: nový subjekt → hodnota, dodavatel ji dostane, účtování doplní řádek → partner → účet", async () => {
    const E = (await provisionTenant(client, { code: `t-dd-${run}`, name: "DD", adminEmail: `dd-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ap", "ar"], company: { code: "D", name: "D" } })).ctx;
    const dims = (await listRecords(E, "gl.dimension", {}, client)).rows;
    const par = dims.find((d) => d.code === "PAR")!;
    // existující subjekt před přepnutím — doplní se akcí
    const old = await saveRecord(E, "gab.subject", null, { name: "Starý dodavatel" }, undefined, client);
    await saveRecord(E, "gl.dimension", String(par.id), { source: "subject", valuePrefix: "P", valueDigits: 4, nextValue: 1 }, undefined, client);
    const s1 = await saveRecord(E, "gab.subject", null, { name: "Masna Novák" }, undefined, client);
    const vals = async () => (await listRecords(E, "gl.dimensionValue", { filter: { dimensionId: String(par.id) } }, client)).rows;
    expect((await vals()).map((v) => [v.code, v.name])).toEqual([["P0001", "Masna Novák"]]);
    await runAction(E, "gl.dimension", String(par.id), "createSubjectValues", client);
    expect((await vals()).map((v) => v.code).sort()).toEqual(["P0001", "P0002"]);
    expect((await vals()).find((v) => v.subjectId === old.id)!.code).toBe("P0002");
    // přejmenování subjektu → název hodnoty
    await saveRecord(E, "gab.subject", String(s1.id), { name: "Masna Novák s.r.o." }, undefined, client);
    expect((await vals()).find((v) => v.code === "P0001")!.name).toBe("Masna Novák s.r.o.");
    // dodavatel subjektu dostane výchozí dimenzi
    const grp = (await listRecords(E, "ap.group", {}, client)).rows[0];
    const v = await saveRecord(E, "ap.vendor", null, { subjectId: s1.id, groupId: grp.id }, undefined, client);
    expect(v.dim3).toBe("P0001");
    // výchozí hodnota na účtu se doplní do řádku deníku
    const str = dims.find((d) => d.code === "STR")!;
    await saveRecord(E, "gl.dimensionValue", null, { dimensionId: str.id, code: "KRAM", name: "Krám" }, undefined, client);
    const [a518] = (await listRecords(E, "gl.account", { filter: { accountNum: "518000" } }, client)).rows;
    await saveRecord(E, "gl.account", String(a518.id), { dim1: "KRAM" }, undefined, client);
    const j = await saveRecord(E, "gl.journal", null, { date: "2026-11-13", description: "Výchozí" }, undefined, client);
    const line = await saveRecord(E, "gl.journalLine", null, { journalId: j.id, accountId: a518.id, debit: "10" }, undefined, client);
    expect(line.dim1).toBe("KRAM");
  });
});

describe("testovací prostředí a datové služby (CR-036)", () => {
  it("zapnutí: testovací napojení, ostré pozastavené, EET simulátor dá testovací FIK; vypnutí vrátí ostrá", async () => {
    const { enableTestEnv, disableTestEnv, testEnvState } = await import("@/modules/int/test-env");
    const { withService } = await import("@/modules/int/services");
    const { sell } = await import("@/modules/pos/sale");
    const { eetRegisterReceipt, connectionsFor } = await import("@/modules/int/drivers");
    const { inTenant } = await import("@/server/data");
    const T = (await provisionTenant(client, { code: `t-env-${run}`, name: "Env", adminEmail: `env-${run}@test.local`, adminPassword: "heslo-12345", modules: ["pos", "int"], company: { code: "E", name: "E", vatId: "CZ8551015704" } })).ctx;
    const reg = String((await listRecords(T, "pos.register", {}, client)).rows[0].id);
    const g = (await listRecords(T, "inv.itemGroup", {}, client)).rows[0];
    const u = (await listRecords(T, "inv.unit", { filter: { code: "KS" } }, client)).rows[0];
    const item = String((await saveRecord(T, "inv.item", null, { itemNum: "X", name: "X", groupId: g.id, unitId: u.id, salesPrice: "10", priceInclTax: true }, undefined, client)).id);
    await saveRecord(T, "pos.shift", null, { registerId: reg }, undefined, client);
    // výchozí datové služby
    const svc = (await listRecords(T, "int.connection", { filter: { kind: "service" } }, client)).rows.map((c) => c.driver).sort();
    expect(svc).toEqual(["ares", "cnb", "ecb", "vies"]);
    // ostré platební napojení se pozastaví
    const real = await saveRecord(T, "int.connection", null, { code: "SUMUP", name: "SumUp", kind: "payment", driver: "manual" }, undefined, client);
    await inTenant(T, async (s) => {
      const api = s.sys().api();
      await enableTestEnv(api, (x) => x, true);
      const st = await testEnvState(api);
      expect([st.active, st.connections.map((c) => c.code).sort(), st.paused]).toEqual([true, ["TEST-EET", "TEST-PAY", "TEST-PRINT"], ["SUMUP"]]);
      expect((await api.find("pos.box", {}, { take: 10 })).length).toBe(5);
      const conns = await connectionsFor(api, reg);
      expect([conns.eet?.driver, conns.payment?.driver, conns.printer?.driver]).toEqual(["eetSimulator", "simulator", "browser"]);
      const r = await sell(api, { registerId: reg, payment: "cash", lines: [{ itemId: item, qty: "1" }] });
      await eetRegisterReceipt(api, T.companyId, conns.eet!, r, true);
      const rr = (await api.get("pos.receipt", String(r.id)))!;
      expect([rr.eetStatus, String(rr.eetPok).startsWith("TEST-")]).toEqual(["sent", true]);
      await disableTestEnv(api);
      expect((await api.get("int.connection", String(real.id)))!.active).toBe(true);
      expect((await testEnvState(api)).active).toBe(false);
      // vypnutá služba zastaví volání, zapnutá ho zapíše do logu
      const [cnb] = await api.find("int.connection", { kind: "service", driver: "cnb" }, { take: 1 });
      await api.update("int.connection", String(cnb.id), { active: false });
      await expect(withService(api, "cnb", "x", async () => 1)).rejects.toMatchObject({ label: "@INT:ServiceDisabled" });
      await api.update("int.connection", String(cnb.id), { active: true });
      expect(await withService(api, "cnb", "rates.cnb", async () => 7, (n) => `n=${n}`)).toBe(7);
      expect((await api.find("int.log", { connectionId: cnb.id }, { take: 5 })).map((l) => [l.operation, l.status, l.message])).toEqual([["rates.cnb", "ok", "n=7"]]);
    }, client);
  });
});

describe("pokladní kniha", () => {
  it("PPD/VPD s řadou, DPH zjednodušeného dokladu, zákaz mínusu, limit, report s průběžným zůstatkem", async () => {
    const { runReport } = await import("@/server/report");
    const P = (await provisionTenant(client, { code: `t-cash-${run}`, name: "Cash", adminEmail: `cash-${run}@test.local`, adminPassword: "heslo-12345", modules: ["cash", "tax"], company: { code: "C", name: "C" } })).ctx;
    const [desk] = (await listRecords(P, "cash.desk", {}, client)).rows;
    expect([desk.code, (desk._titles as Record<string, string>).accountId.slice(0, 6)]).toEqual(["HOT", "211000"]);
    const acc = async (n: string) => String((await listRecords(P, "gl.account", { filter: { accountNum: n } }, client)).rows[0].id);
    const today = new Date().toISOString().slice(0, 10);
    // výdej z prázdné pokladny neprojde
    const out1 = await saveRecord(P, "cash.voucher", null, { deskId: desk.id, direction: "out", date: today, description: "Čisticí prostředky", amount: "121", offsetAccountId: await acc("501000") }, undefined, client);
    expect(String(out1.docNum)).toMatch(/^VPD\d{2}00001$/);
    await expect(runAction(P, "cash.voucher", String(out1.id), "post", client)).rejects.toMatchObject({ label: "@CASH:NegativeBalance" });
    // vklad do pokladny, pak výdej s DPH 21 %
    const in1 = await saveRecord(P, "cash.voucher", null, { deskId: desk.id, direction: "in", date: today, description: "Vklad hotovosti", amount: "1000", offsetAccountId: await acc("261000") }, undefined, client);
    expect(String(in1.docNum)).toMatch(/^PPD\d{2}00001$/);
    await runAction(P, "cash.voucher", String(in1.id), "post", client);
    const [tc] = (await listRecords(P, "tax.taxCode", { filter: { code: "P21" } }, client)).rows;
    const out2 = await saveRecord(P, "cash.voucher", String(out1.id), { taxCodeId: tc.id }, undefined, client);
    expect([out2.amountNet, out2.taxAmount]).toEqual(["100.00", "21.00"]);
    await runAction(P, "cash.voucher", String(out1.id), "post", client);
    const tt = (await listRecords(P, "tax.trans", { filter: { sourceId: String(out1.id) } }, client)).rows;
    expect([tt.length, tt[0].base, tt[0].tax, tt[0].simplified]).toEqual([1, "100.00", "21.00", true]);
    // limit zůstatku
    await saveRecord(P, "cash.desk", String(desk.id), { maxBalance: "1000" }, undefined, client);
    const in2 = await saveRecord(P, "cash.voucher", null, { deskId: desk.id, direction: "in", date: today, description: "Tržba", amount: "500", offsetAccountId: await acc("604000") }, undefined, client);
    await expect(runAction(P, "cash.voucher", String(in2.id), "post", client)).rejects.toMatchObject({ label: "@CASH:OverLimit" });
    // report: počáteční 0, +1000, −121, konečný 879
    const S = { ctx: P, lang: "cs" } as unknown as Parameters<typeof runReport>[0];
    const r = await runReport({ ...S, superUser: true } as never, "cash", "cashBook", { deskId: desk.id, dateFrom: today, dateTo: today }).catch(() => null);
    if (r) {
      const bal = r.rows.map((x) => x.balance);
      expect([bal[0], bal[bal.length - 1]]).toEqual(["0.00", "879.00"]);
    }
  });
});

describe("adresář: založení z registru, dodavatel a odběratel", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("ARES podle IČO, VIES podle zahraničního DIČ, duplicita, vytvoření partnerů", async () => {
    const { lookupRegistry, createFromRegistry } = await import("@/modules/gab/registry-lookup");
    const { inTenant } = await import("@/server/data");
    const A = (await provisionTenant(client, { code: `t-reg-${run}`, name: "Reg", adminEmail: `reg-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ap", "ar", "int"], company: { code: "R", name: "R" } })).ctx;
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).includes("ares.gov.cz"))
        return new Response(JSON.stringify({ ico: "27079864", obchodniJmeno: "Uzenářství s.r.o.", dic: "CZ27079864", pravniForma: "112", sidlo: { kodStatu: "CZ", nazevObce: "Davle", nazevUlice: "Na náměstí", cisloDomovni: 97, psc: 25206 } }), { status: 200 });
      if (String(url).includes("/ms/DE/vat/123456789"))
        return new Response(JSON.stringify({ isValid: true, userError: "VALID", name: "Wurst GmbH", address: "Hauptstr. 1\n80331 München\nDeutschland" }), { status: 200 });
      return new Response(JSON.stringify({ isValid: false, userError: "INVALID" }), { status: 200 });
    });
    await inTenant(A, async (s) => {
      const api = s.sys().api();
      const a = await lookupRegistry(api, "CZ 2707 9864");
      expect([a?.source, a?.regNo, a?.name, a?.city, a?.existingId]).toEqual(["ares", "27079864", "Uzenářství s.r.o.", "Davle", null]);
      const id = await createFromRegistry(api, "27079864", { vendor: true, customer: true });
      expect((await api.find("ap.vendor", { subjectId: id }, { take: 2 })).length).toBe(1);
      expect((await api.find("ar.customer", { subjectId: id }, { take: 2 })).length).toBe(1);
      expect((await lookupRegistry(api, "27079864"))?.existingId).toBe(id);
      await expect(createFromRegistry(api, "27079864", {})).rejects.toMatchObject({ label: "@GAB:SubjectExists" });
      const v = await lookupRegistry(api, "DE123456789");
      expect([v?.source, v?.name, v?.vatId, v?.zipCode, v?.city, v?.country]).toEqual(["vies", "Wurst GmbH", "DE123456789", "80331", "München", "DE"]);
      expect(await lookupRegistry(api, "DE999")).toBeNull();
      await expect(lookupRegistry(api, "nesmysl!")).rejects.toMatchObject({ label: "@GAB:LookupFormat" });
      // ARES i VIES jdou do protokolu napojení
      const conns = await api.find("int.connection", { kind: "service" }, { take: 10 });
      const logs = await api.find("int.log", {}, { take: 50 });
      expect(new Set(logs.map((l) => conns.find((c) => c.id === l.connectionId)?.driver))).toEqual(new Set(["ares", "vies"]));
    }, client);
    // akce na záznamu adresáře
    const sub = await saveRecord(A, "gab.subject", null, { name: "Bez partnera" }, undefined, client);
    await runAction(A, "gab.subject", String(sub.id), "createVendor", client);
    await expect(runAction(A, "gab.subject", String(sub.id), "createVendor", client)).rejects.toMatchObject({ label: "@GAB:PartnerExists" });
  });
});

describe("import řádků dokladu", () => {
  it("řádky deníku hlavní knihy ze souboru do konkrétního deníku (rodič pevně)", async () => {
    const { importRecords, parseCsv } = await import("@/server/import");
    const J = (await provisionTenant(client, { code: `t-jl-${run}`, name: "JL", adminEmail: `jl-${run}@test.local`, adminPassword: "heslo-12345", modules: ["gl"], company: { code: "J", name: "J" } })).ctx;
    const j = await saveRecord(J, "gl.journal", null, { date: "2026-11-13", description: "Import řádků" }, undefined, client);
    const csv = "Účet;Má dáti;Dal;Text\n518000;1000;;Nájem\n395000;;1000;Nájem\n";
    const dry = await importRecords(J, "gl.journalLine", parseCsv(csv), { dryRun: true, lang: "cs", fixed: { journalId: String(j.id) } }, client);
    expect([dry.errors, dry.missing]).toEqual([[], []]);
    const r = await importRecords(J, "gl.journalLine", parseCsv(csv), { dryRun: false, lang: "cs", fixed: { journalId: String(j.id) } }, client);
    expect([r.created, r.errors.length]).toEqual([2, 0]);
    await runAction(J, "gl.journal", String(j.id), "post", client);
    expect((await getRecord(J, "gl.journal", String(j.id), client))!.status).toBe("posted");
  });
});

describe("tiskové sestavy", () => {
  it("IBAN z čísla účtu, QR platba, výchozí šablony, data faktury a účtenky", async () => {
    const { czIban, spayd } = await import("@/core/print");
    expect(czIban("19-2000145399/0800")).toBe("CZ6508000000192000145399");
    expect(czIban("nesmysl")).toBeNull();
    expect(spayd({ iban: "CZ6508000000192000145399", amount: "1210", vs: "FV2026-0001", date: "2026-11-27", message: "Faktura FV*1" })).toBe("SPD*1.0*ACC:CZ6508000000192000145399*AM:1210.00*CC:CZK*X-VS:20260001*DT:20261127*MSG:Faktura FV 1");
    const { printJob } = await import("@/server/print");
    const { fillText } = await import("@/lib/print-render");
    const P = (await provisionTenant(client, { code: `t-prt-${run}`, name: "Prt", adminEmail: `prt-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar", "pos", "org"], company: { code: "P", name: "Tisk s.r.o." } })).ctx;
    const tpls = (await listRecords(P, "prt.template", {}, client)).rows.map((r) => [r.docType, r.paper, r.isDefault]);
    expect(tpls.sort()).toEqual([["ar.invoice", "a4", true], ["pos.receipt", "receipt80", true]]);
    // bankovní účet firmy → QR platba na faktuře
    const [org] = (await listRecords(P, "org.entity", {}, client)).rows;
    await saveRecord(P, "org.entity", String(org.id), { bankAccount: "19-2000145399/0800" }, undefined, client);
    const grp = (await listRecords(P, "ar.group", {}, client)).rows[0];
    const subj = await saveRecord(P, "gab.subject", null, { name: "Restaurace U Lípy", regNo: "12345678" }, undefined, client);
    const cust = await saveRecord(P, "ar.customer", null, { subjectId: subj.id, groupId: grp.id }, undefined, client);
    const inv = await saveRecord(P, "ar.invoice", null, { customerId: cust.id, invoiceDate: "2026-11-13", dueDate: "2026-11-27" }, undefined, client);
    await saveRecord(P, "ar.invoiceLine", null, { invoiceId: inv.id, description: "Šunka 5 kg", qty: "5", unitPrice: "200" }, undefined, client);
    const job = await printJob(P, "ar.invoice", String(inv.id), null, client);
    const d = job.data as { doc: Record<string, unknown>; partner: Record<string, unknown>; lines: unknown[]; qr: string };
    expect([d.partner.name, d.lines.length, d.qr.startsWith("SPD*1.0*ACC:CZ6508000000192000145399*AM:")]).toEqual(["Restaurace U Lípy", 1, true]);
    expect(fillText("Faktura {doc.number} k úhradě {doc.due:money}", job.data, "cs-CZ")).toMatch(/^Faktura \S+ k úhradě 1\s210,00$/);
    // tisk bez práva číst doklad nejde
    await expect(printJob({ ...P, perms: { admin: false, levels: {} } }, "ar.invoice", String(inv.id), null, client)).rejects.toMatchObject({ label: "@SYS:NoAccess" });
  });
});

describe("založení firmy z rejstříku", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("ARES → firma (kód = IČO), výchozí nastavení, organizace se sídlem; duplicita", async () => {
    const { createCompanyFromRegistry } = await import("@/server/company-lookup");
    const T = (await provisionTenant(client, { code: `t-cmp-${run}`, name: "Cmp", adminEmail: `cmp-${run}@test.local`, adminPassword: "heslo-12345", modules: ["org", "gl"], company: { code: "A", name: "A" } })).ctx;
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ ico: "27079864", obchodniJmeno: "Uzenářství s.r.o.", dic: "CZ27079864", pravniForma: "112", sidlo: { kodStatu: "CZ", nazevObce: "Davle", nazevUlice: "Na náměstí", cisloDomovni: 97, cisloOrientacni: 3, psc: 25206 } }), { status: 200 }),
    );
    const id = await createCompanyFromRegistry(T, "27079864", client);
    const c = (await getRecord(T, "sys.company", id, client))!;
    expect([c.code, c.name, c.vatId]).toEqual(["27079864", "Uzenářství s.r.o.", "CZ27079864"]);
    const C2 = { ...T, companyId: id };
    const [org] = (await listRecords(C2, "org.entity", {}, client)).rows;
    expect([org.legalName, org.street, org.houseNo, org.orientNo, org.city, org.zipCode]).toEqual(["Uzenářství s.r.o.", "Na náměstí", "97", "3", "Davle", "252 06"]);
    expect((await listRecords(C2, "gl.account", { pageSize: 1 }, client)).total).toBeGreaterThan(10);
    await expect(createCompanyFromRegistry(T, "27079864", client)).rejects.toMatchObject({ label: "@ORG:CompanyExists" });
  });
});
