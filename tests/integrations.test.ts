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
