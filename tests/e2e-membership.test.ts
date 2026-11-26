/**
 * Komplexní průchod členství (režim Kalendář) jako v provozu:
 * portál (formulář, stát, počátek od platby, kontakty) → výpis GPC (VS smlouvy) → párování → deník z výpisu
 * (Označeno k vyrovnání, dimenze Partner, banka protiúčet) → zaúčtování (aktivace = objednávka K fakturaci,
 * platba smlouvy v saldu) → hlídání 15 dnů → Vyfakturovat hromadně (DUZP = den platby, uhrazeno platbou)
 * → dávka: další splátka K fakturaci → faktura z objednávky → druhý výpis (VS faktury) → uhrazeno → třetí
 * splátka po splatnosti → blokace → úhrada odblokuje. Kontroly salda a hlavní knihy po každém kroku.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { downloadFile, getRecord, inTenant, listRecords, runAction, saveRecord } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { gpcHeader, gpcLine } from "@/modules/bank/gpc";
import { importStatementsBulk } from "@/server/bank-import";
import { runAgreements } from "@/modules/tax/agreements";
import { ar } from "@/modules/ar";
import type { AppSession } from "@/server/auth";

const client = createPrisma();
const run = Date.now().toString(36);
afterAll(() => client.$disconnect());

const iso = (d: Date) => d.toISOString().slice(0, 10);
const plus = (days: number, from = new Date()) => iso(new Date(from.getTime() + days * 86400000));
const cents = (v: string) => BigInt(Math.round(Number(v) * 100));

function gpc(num: string, opening: string, date: string, lines: { amount: string; vs: string; msg: string }[], account = "2000145399") {
  const cs = lines.map((l) => cents(l.amount));
  const credit = cs.filter((x) => x > BigInt(0)).reduce((a, b) => a + b, BigInt(0));
  const debit = -cs.filter((x) => x < BigInt(0)).reduce((a, b) => a + b, BigInt(0));
  const o = cents(opening);
  return [
    gpcHeader({ account, name: "Gym", num, date, opening: o, closing: o + credit - debit, debit, credit }),
    ...lines.map((l, i) => gpcLine({ counter: "1234567" + i, cents: cs[i], vs: l.vs, date, message: l.msg })),
  ].join("\r\n");
}

describe("členství od přihlášky po blokaci", () => {
  it("portál → výpis → deník → aktivace → faktury → úhrady → blokace", async () => {
    const { agreementPortalInfo, agreementPortalSubmit } = await import("@/server/agreement-portal");
    const T = (await provisionTenant(client, { code: `t-e2e-${run}`, name: "E2E", adminEmail: `e2e-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar", "bank", "inv", "int", "org"], company: { code: "G", name: "Gym s.r.o." } })).ctx;
    const session = { ctx: T, lang: "cs", companies: [{ id: T.companyId!, code: "G", name: "Gym" }], superUser: true, adminCompanyIds: [T.companyId!] } as unknown as AppSession;
    const rows = async (obj: string, filter: Record<string, unknown> = {}) => (await listRecords(T, obj, { filter, pageSize: 500 }, client)).rows;
    const acc = async (n: string) => String((await rows("gl.account", { accountNum: n }))[0].id);
    const balance = async (n: string) => (await rows("gl.trans", { accountId: await acc(n) })).reduce((a, t) => a + cents(String(t.amount)), BigInt(0));

    // nastavení: Kalendář (splatnost 3 dny, blokace hned), dimenze Partner, účet banky, tarif, portál s formulářem
    const [prm] = await rows("ar.parameters");
    await saveRecord(T, "ar.parameters", String(prm.id), { agreementMode: "schedule", agreementDueDays: 3, agreementBlockDays: 0, agreementRenewDays: 14 }, prm.version as number, client);
    // dimenze 1 = Partner (výchozí dimenze firmy přepnutá na zdroj Partner)
    const d1 = (await rows("gl.dimension")).find((d) => Number(d.position) === 1);
    if (d1) await saveRecord(T, "gl.dimension", String(d1.id), { source: "partner", active: true }, d1.version as number, client);
    else await saveRecord(T, "gl.dimension", null, { code: "PART", name: "Partner", position: 1, source: "partner", active: true }, undefined, client);
    const bank = await saveRecord(T, "bank.account", null, { code: "KB", name: "Účet", accountNum: "2000145399/0800", glAccountId: await acc("221000"), isDefault: true }, undefined, client);
    const g = (await rows("inv.itemGroup"))[0];
    const u = (await rows("inv.unit"))[0];
    await saveRecord(T, "inv.item", null, { itemNum: "MES", name: "Členství měsíční", groupId: g.id, unitId: u.id, salesPrice: "1210", priceInclTax: true, agreementMonths: 1 }, undefined, client);
    const fm = await saveRecord(T, "int.form", null, { code: "CLEN", name: "Členství" }, undefined, client);
    const fld = (sequence: number, key: string, label: string, kind: string, mapping: string, extra: Record<string, unknown> = {}) => saveRecord(T, "int.formField", null, { formId: fm.id, sequence, key, label, kind, mapping, ...extra }, undefined, client);
    await fld(10, "jmeno", "Jméno", "text", "subject.firstName", { required: true });
    await fld(20, "prijmeni", "Příjmení", "text", "subject.lastName", { required: true });
    await fld(30, "email", "E-mail", "email", "subject.email", { required: true });
    await fld(40, "telefon", "Telefon", "phone", "subject.phone", { required: true });
    await fld(50, "ulice", "Ulice", "text", "address.street", { required: true });
    await fld(60, "obec", "Obec", "text", "address.city", { required: true });
    await fld(70, "psc", "PSČ", "text", "address.zipCode", { required: true });
    await fld(80, "stat", "Stát", "select", "address.country", { options: "Česká republika|Slovensko", defaultValue: "Česká republika" });
    await fld(90, "zacatek", "Počátek", "date", "agreement.startDate");
    await fld(100, "souhlas", "Souhlasím s podmínkami", "consent", "form");
    const portal = await saveRecord(T, "int.portal", null, { name: "Členství", purpose: "agreement", title: "Členství", agreementTerms: "1. ÚVODNÍ USTANOVENÍ\n1.1. Text.", formId: fm.id, ipHourLimit: 50 }, undefined, client);

    // 1) přihláška na portálu: Slovensko, bez počátku (od první platby)
    const info = (await agreementPortalInfo(T.tenantId, String(portal.token), client))!;
    expect(info.form?.fields.find((f) => f.key === "stat")?.defaultValue).toBe("Česká republika");
    const r = (await agreementPortalSubmit(T.tenantId, String(portal.token), { tariffId: info.tariffs[0].id, firstName: "", lastName: "", email: "", phone: "", street: "", city: "", zipCode: "", startDate: "", consent: true, answers: { jmeno: "Zuzana", prijmeni: "Horváthová", email: "zuzana@example.test", telefon: "+421 908 333 777", ulice: "Obchodná 7", obec: "Bratislava", psc: "81106", stat: "Slovensko", zacatek: "", souhlas: true } }, "10.2.0.1", client))!;
    expect(r.ok).toBe(true);
    expect(r.payment?.qr).toMatch(/ACC:CZ\d+.*AM:1210\.00.*MSG:Smlouva SM/);
    let agr = (await getRecord(T, "ar.agreement", r.agreementId!, client))!;
    expect([agr.status, agr.startOnPayment]).toEqual(["awaiting", true]);
    expect((await rows("ar.order", { agreementId: agr.id })).length + (await rows("ar.advance", { agreementId: agr.id })).length).toBe(0);
    const cust = (await getRecord(T, "ar.customer", String(agr.customerId), client))!;
    const subjectId = String(cust.subjectId);
    expect((await rows("gab.address", { subjectId })).map((a) => a.country)).toContain("SK");
    expect((await rows("gab.contact", { subjectId })).map((c) => c.kind).sort()).toEqual(["email", "phone"]);

    // 2) výpis s první platbou (VS smlouvy) + poplatek; párování; deník z výpisu
    const payDay = iso(new Date());
    const imp = await importStatementsBulk(session, { name: "v1.gpc", data: Buffer.from(gpc("1", "0", payDay, [{ amount: "1210", vs: String(agr.vs), msg: "HORVATHOVA" }, { amount: "-35", vs: "", msg: "Poplatek za vedeni" }])) });
    expect(imp.map((x) => x.status)).toEqual(["imported"]);
    const [st1] = await rows("bank.statement", { bankAccountId: bank.id });
    const sl = (await rows("bank.statementLine", { statementId: st1.id })).sort((a, b) => Number(a.lineNum) - Number(b.lineNum));
    expect(sl.map((l) => l.matchKind)).toEqual(["customerAgreement", "rule"]);
    // náhled zápisů před deníkem
    const { previewPosting } = await import("@/server/posting-preview");
    expect((await previewPosting(T, "bank.statement", String(st1.id), client)).vouchers.length).toBe(1);
    await runAction(T, "bank.statement", String(st1.id), "createJournal", client);
    const j1 = String((await getRecord(T, "bank.statement", String(st1.id), client))!.journalId);
    const jl = (await rows("gl.journalLine", { journalId: j1 })).sort((a, b) => Number(a.lineNum) - Number(b.lineNum));
    // partner vlevo s dimenzí Partner, banka protiúčet, VS, označeno k vyrovnání; poplatek z předkontace
    expect([jl[0].accountType, jl[0].customerId, jl[0].dim1, jl[0].offsetType, jl[0].offsetBankAccountId, jl[0].vs, jl[0].credit, jl[0].settleStatus]).toEqual(["customer", cust.id, cust.accountNum, "bank", bank.id, String(agr.vs), "1210.00", "full"]);
    expect([jl[1].accountType, jl[1].debit, jl[1].settleStatus]).toEqual(["ledger", "35.00", "none"]);
    expect((await getRecord(T, "ar.agreement", String(agr.id), client))!.status).toBe("awaiting");

    // 3) zaúčtování deníku: aktivace, objednávka K fakturaci, platba smlouvy v saldu, dimenze v zápisech
    await runAction(T, "gl.journal", j1, "post", client);
    agr = (await getRecord(T, "ar.agreement", String(agr.id), client))!;
    expect([agr.status, String(agr.startDate).slice(0, 10)]).toEqual(["active", payDay]);
    let lines = (await rows("ar.agreementLine", { agreementId: agr.id })).sort((a, b) => Number(a.lineNum) - Number(b.lineNum));
    expect([lines[0].status, String(lines[0].paymentDate).slice(0, 10)]).toEqual(["toInvoice", payDay]);
    expect((await rows("ar.invoice", { agreementId: agr.id })).length).toBe(0);
    const [prepay] = await rows("ar.trans", { agreementId: agr.id, kind: "payment" });
    expect([prepay.amountCur, prepay.closed]).toEqual(["-1210.00", false]);
    expect((await getRecord(T, "gl.journalLine", String(jl[0].id), client))!.settleStatus).toBe("settled");
    const t311 = await rows("gl.trans", { accountId: await acc("311000") });
    expect(t311.map((x) => [x.amount, x.dim1])).toEqual([["-1210.00", cust.accountNum]]);
    expect(await balance("221000")).toBe(cents("1175"));

    // 4) hlídání 15 dnů: po 10 dnech upozornění
    const job = (today: string) => inTenant(T, (s) => runAgreements(s.sys().api(), ar.agreementDocs, today), client);
    await job(plus(10));
    expect((await rows("sys.notification")).some((n) => String(n.title) === "@TAX:AgrToInvoiceLate")).toBe(true);

    // 5) Vyfakturovat hromadně (seznam smluv): DUZP = den platby, uhrazeno přijatou platbou
    await runAction(T, "ar.agreement", String(agr.id), "invoiceDue", client);
    const [inv1] = await rows("ar.invoice", { agreementId: agr.id });
    expect([inv1.status, String(inv1.taxDate).slice(0, 10), inv1.vs, inv1.paidAmount]).toEqual(["posted", payDay, agr.vs, "1210.00"]);
    expect((await getRecord(T, "ar.trans", String(prepay.id), client))!.closed).toBe(true);
    expect(await balance("311000")).toBe(BigInt(0)); // faktura 1210 MD a platba 1210 D
    const isdoc = String((await downloadFile(T, "ar.invoice", String(inv1.id), "isdoc", client)).data);
    expect(isdoc).toContain("<PayableAmount>0.00</PayableAmount>");

    // 6) dávka: druhá splátka K fakturaci → Vytvořit fakturu u objednávky → úhrada výpisem (VS faktury)
    lines = (await rows("ar.agreementLine", { agreementId: agr.id })).sort((a, b) => Number(a.lineNum) - Number(b.lineNum));
    const from2 = String(lines[1].periodFrom).slice(0, 10);
    expect((await job(from2)).issued).toBe(1);
    lines = (await rows("ar.agreementLine", { agreementId: agr.id })).sort((a, b) => Number(a.lineNum) - Number(b.lineNum));
    expect(lines[1].status).toBe("toInvoice");
    await runAction(T, "ar.order", String(lines[1].orderId), "createInvoice", client);
    const inv2 = (await rows("ar.invoice", { agreementId: agr.id })).find((x) => x.id !== inv1.id)!;
    expect([inv2.status, inv2.paidAmount]).toEqual(["posted", "0.00"]);
    await importStatementsBulk(session, { name: "v2.gpc", data: Buffer.from(gpc("2", "1175", plus(1), [{ amount: "1210", vs: String(agr.vs), msg: "HORVATHOVA 2" }])) });
    const st2 = (await rows("bank.statement", { bankAccountId: bank.id })).find((x) => Number(x.statementNum) === 2)!;
    const [l2] = await rows("bank.statementLine", { statementId: st2.id });
    expect(l2.matchKind).toBe("customer");
    await runAction(T, "bank.statement", String(st2.id), "createJournal", client);
    const j2 = String((await getRecord(T, "bank.statement", String(st2.id), client))!.journalId);
    expect((await rows("gl.journalLine", { journalId: j2 }))[0].settleStatus).toBe("full");
    await runAction(T, "gl.journal", j2, "post", client);
    expect((await getRecord(T, "ar.invoice", String(inv2.id), client))!.paidAmount).toBe("1210.00");
    agr = (await getRecord(T, "ar.agreement", String(agr.id), client))!;
    expect([agr.status, String(agr.paidUntil).slice(0, 10)]).toEqual(["active", String(lines[1].periodTo).slice(0, 10)]);

    // 7) třetí splátka: faktura nezaplacená po splatnosti → blokace, úhrada odblokuje
    const from3 = String(lines[2].periodFrom).slice(0, 10);
    await job(from3);
    lines = (await rows("ar.agreementLine", { agreementId: agr.id })).sort((a, b) => Number(a.lineNum) - Number(b.lineNum));
    await runAction(T, "ar.agreement", String(agr.id), "invoiceDue", client);
    const inv3 = (await rows("ar.invoice", { agreementId: agr.id })).find((x) => x.id !== inv1.id && x.id !== inv2.id)!;
    const due3 = String(inv3.dueDate).slice(0, 10);
    expect((await job(plus(1, new Date(`${due3}T00:00:00Z`)))).blocked).toBe(1);
    expect((await getRecord(T, "ar.agreement", String(agr.id), client))!.status).toBe("blocked");
    const imp3 = await importStatementsBulk(session, { name: "v3.gpc", data: Buffer.from(gpc("3", "2385", plus(2), [{ amount: "1210", vs: String(agr.vs), msg: "HORVATHOVA 3" }])) });
    expect(imp3.map((x) => x.status)).toEqual(["imported"]);
    const st3 = (await rows("bank.statement", { bankAccountId: bank.id })).find((x) => Number(x.statementNum) === 3)!;
    await runAction(T, "bank.statement", String(st3.id), "post", client); // tentokrát rovnou zaúčtovat výpis
    agr = (await getRecord(T, "ar.agreement", String(agr.id), client))!;
    expect(agr.status).toBe("active");
    expect(await balance("311000")).toBe(BigInt(0));
    expect(await balance("221000")).toBe(cents("3595"));
    // předvaha sedí: součet všech zápisů = 0
    const all = await rows("gl.trans");
    expect(all.reduce((a, t) => a + cents(String(t.amount)), BigInt(0))).toBe(BigInt(0));
  }, 240_000);
});
