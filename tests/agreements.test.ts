/**
 * Smlouvy (předplatné na období): tarif z položky → výzva k platbě (objednávka + záloha s VS)
 * → úhrada bankou → aktivní do konce období + zaúčtovaná faktura → dávka: další výzva, blokace po lhůtě.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { getRecord, inTenant, listRecords, runAction, saveRecord, type Ctx } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { agreementState, periodEnd, runAgreements, type AgreementDocs } from "@/modules/tax/agreements";
import { ar } from "@/modules/ar";

const client = createPrisma();
const run = Date.now().toString(36);
afterAll(() => client.$disconnect());

const iso = (d: Date) => d.toISOString().slice(0, 10);
const plus = (days: number) => iso(new Date(Date.now() + days * 86400000));

async function payAdvance(T: Ctx, bankId: string, advanceId: string, n: number) {
  const adv = (await getRecord(T, "ar.advance", advanceId, client))!;
  const st = await saveRecord(T, "bank.statement", null, { bankAccountId: bankId, statementNum: String(n), date: iso(new Date()), openingBalance: "0" }, undefined, client);
  await saveRecord(T, "bank.statementLine", null, { statementId: st.id, lineNum: 1, date: iso(new Date()), amount: adv.amount, vs: adv.vs }, undefined, client);
  await runAction(T, "bank.statement", String(st.id), "match", client);
  await runAction(T, "bank.statement", String(st.id), "post", client);
}

describe("období smlouvy", () => {
  it("konec období = od + N měsíců − 1 den, i přes konec měsíce", () => {
    expect(periodEnd("2026-01-01", 1)).toBe("2026-01-31");
    expect(periodEnd("2026-01-31", 1)).toBe("2026-02-27");
    expect(periodEnd("2026-11-22", 12)).toBe("2027-11-21");
  });
  it("stav: zaplaceno → aktivní, po splatnosti + lhůtě → blokovaná", () => {
    const a = { status: "awaiting", paidUntil: null, dueDate: "2026-11-01" };
    expect(agreementState(a, { status: "open", dueDate: "2026-11-01" }, "2026-11-10", 14)).toBe("awaiting");
    expect(agreementState(a, { status: "open", dueDate: "2026-11-01" }, "2026-11-16", 14)).toBe("blocked");
    expect(agreementState({ ...a, status: "blocked", paidUntil: "2026-12-31" }, { status: "paid" }, "2026-11-20", 14)).toBe("active");
    expect(agreementState({ status: "active", paidUntil: "2026-12-31", endDate: "2026-12-31" }, null, "2027-01-02", 14)).toBe("ended");
  });
});

describe("prodejní smlouva", () => {
  it("tarif → výzva → platba → aktivní + výnos; další období a blokace dávkou", async () => {
    const T = (await provisionTenant(client, { code: `t-agr-${run}`, name: "AGR", adminEmail: `agr-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar", "bank", "inv"], company: { code: "G", name: "Gym" } })).ctx;
    const acc = async (num: string) => String((await listRecords(T, "gl.account", { filter: { accountNum: num } }, client)).rows[0].id);
    const g = (await listRecords(T, "inv.itemGroup", {}, client)).rows[0];
    const u = (await listRecords(T, "inv.unit", {}, client)).rows[0];
    // tarif: roční členství 10 000 Kč s DPH
    const tariff = await saveRecord(T, "inv.item", null, { itemNum: "CLEN12", name: "Členství roční", groupId: g.id, unitId: u.id, salesPrice: "10000", priceInclTax: true, agreementMonths: 12 }, undefined, client);
    const subj = await saveRecord(T, "gab.subject", null, { name: "Jan Členský" }, undefined, client);
    const [grp] = (await listRecords(T, "ar.group", {}, client)).rows;
    const cust = await saveRecord(T, "ar.customer", null, { subjectId: subj.id, groupId: grp.id }, undefined, client);

    const agr = await saveRecord(T, "ar.agreement", null, { customerId: cust.id, itemId: tariff.id, startDate: plus(0) }, undefined, client);
    expect(agr.agreementNum).toMatch(/^SM26\d{5}$/);
    expect([agr.amount, agr.periodMonths, agr.description, agr.status]).toEqual(["10000.00", 12, "Členství roční", "draft"]);

    // výzva: objednávka s cenou s DPH + záloha s VS, období rok od začátku
    await runAction(T, "ar.agreement", String(agr.id), "requestPayment", client);
    let a = (await getRecord(T, "ar.agreement", String(agr.id), client))!;
    expect([a.status, a.periodFrom, a.periodTo]).toEqual(["awaiting", plus(0), periodEnd(plus(0), 12)]);
    const adv = (await getRecord(T, "ar.advance", String(a.advanceId), client))!;
    expect([adv.amount, adv.agreementId, adv.status]).toEqual(["10000.00", agr.id, "open"]);
    expect(adv.vs).toMatch(/^\d+$/);
    // druhá výzva, dokud první není zaplacená, nejde
    await expect(runAction(T, "ar.agreement", String(agr.id), "requestPayment", client)).rejects.toMatchObject({ label: "@TAX:AgrPending" });

    // platba bankou → aktivní do konce období, faktura zaúčtovaná proti záloze, výnos 604 bez DPH
    const bank = await saveRecord(T, "bank.account", null, { code: "KB", name: "Účet", accountNum: "123456789/0100", glAccountId: await acc("221000") }, undefined, client);
    await payAdvance(T, String(bank.id), String(adv.id), 1);
    a = (await getRecord(T, "ar.agreement", String(agr.id), client))!;
    expect([a.status, a.paidUntil]).toEqual(["active", a.periodTo]);
    const inv = (await listRecords(T, "ar.invoice", { filter: { agreementId: agr.id } }, client)).rows;
    expect(inv.map((i) => [i.status, i.amountGross, i.advanceAmount])).toEqual([["posted", "10000.00", "10000.00"]]);
    const bal = async (num: string) => (await listRecords(T, "gl.trans", { filter: { accountId: await acc(num) }, totals: true }, client)).totals!.amount;
    // výnos bez DPH (10 000 / 1,21) na účtu výnosů položky / skupiny
    const rev = (await listRecords(T, "gl.trans", { filter: { voucherId: inv[0].voucherId } }, client)).rows;
    const accNum = new Map((await listRecords(T, "gl.account", { pageSize: 500 }, client)).rows.map((x) => [x.id, String(x.accountNum)]));
    const by = (prefix: string) => rev.filter((t) => accNum.get(t.accountId)!.startsWith(prefix)).reduce((x, t) => x + Number(t.amount), 0);
    expect([await bal("221000"), await bal("324000"), await bal("311000")]).toEqual(["10000.00", "0.00", "0.00"]);
    expect(by("6").toFixed(2)).toBe("-8264.46");

    // dávka: dlouho před koncem nic; 14 dní před koncem další výzva, smlouva zůstává aktivní
    const job = async (today: string) => inTenant(T, (s) => runAgreements(s.sys().api(), regDocs(), today), client);
    expect(await job(plus(30))).toEqual({ issued: 0, blocked: 0 });
    const end = String(a.paidUntil).slice(0, 10);
    const before = iso(new Date(new Date(`${end}T00:00:00Z`).getTime() - 10 * 86400000));
    expect(await job(before)).toEqual({ issued: 1, blocked: 0 });
    a = (await getRecord(T, "ar.agreement", String(agr.id), client))!;
    const nextFrom = iso(new Date(new Date(`${end}T00:00:00Z`).getTime() + 86400000));
    expect([a.status, a.periodFrom]).toEqual(["active", nextFrom]);
    // nezaplaceno: po konci období čeká, po splatnosti + 14 dní blokovaná
    const afterEnd = iso(new Date(new Date(`${end}T00:00:00Z`).getTime() + 2 * 86400000));
    expect((await job(afterEnd)).blocked).toBe(0);
    expect((await getRecord(T, "ar.agreement", String(agr.id), client))!.status).toBe("awaiting");
    const late = iso(new Date(new Date(`${String(a.dueDate).slice(0, 10)}T00:00:00Z`).getTime() + 15 * 86400000));
    expect(await job(late)).toEqual({ issued: 0, blocked: 1 });
    a = (await getRecord(T, "ar.agreement", String(agr.id), client))!;
    expect([a.status, a.blockedDate]).toEqual(["blocked", late]);

    // pozdní platba blokovanou smlouvu zase aktivuje na další rok
    await payAdvance(T, String(bank.id), String(a.advanceId), 2);
    a = (await getRecord(T, "ar.agreement", String(agr.id), client))!;
    expect([a.status, a.paidUntil, a.blockedDate]).toEqual(["active", periodEnd(nextFrom, 12), null]);
    expect((await listRecords(T, "ar.invoice", { filter: { agreementId: agr.id } }, client)).total).toBe(2);

    // ukončení: nezaplacená výzva se zruší, další výzva nejde
    await runAction(T, "ar.agreement", String(agr.id), "end", client);
    a = (await getRecord(T, "ar.agreement", String(agr.id), client))!;
    expect(a.status).toBe("ended");
    await expect(runAction(T, "ar.agreement", String(agr.id), "requestPayment", client)).rejects.toMatchObject({ label: "@GL:Locked" });
  });
});

/** Dokumenty smluv odběratelů z továrny (stejné, jaké používá dávka modulu). */
const regDocs = (): AgreementDocs => ar.agreementDocs;

describe("portál smluv", () => {
  it("tarify z položek, kontroly údajů, smlouva + odběratel + výzva s QR", async () => {
    const { agreementPortalInfo, agreementPortalSubmit } = await import("@/server/agreement-portal");
    const T = (await provisionTenant(client, { code: `t-agp-${run}`, name: "AGP", adminEmail: `agp-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar", "bank", "inv", "int"], company: { code: "M", name: "Monster Gym" } })).ctx;
    const g = (await listRecords(T, "inv.itemGroup", {}, client)).rows[0];
    const u = (await listRecords(T, "inv.unit", {}, client)).rows[0];
    const mesic = await saveRecord(T, "inv.item", null, { itemNum: "CLEN1", name: "Členství měsíční", groupId: g.id, unitId: u.id, salesPrice: "1200", priceInclTax: true, agreementMonths: 1 }, undefined, client);
    await saveRecord(T, "inv.item", null, { itemNum: "CLEN12", name: "Členství roční", groupId: g.id, unitId: u.id, salesPrice: "10000", priceInclTax: true, agreementMonths: 12 }, undefined, client);
    await saveRecord(T, "inv.item", null, { itemNum: "PROT", name: "Protein", groupId: g.id, unitId: u.id, salesPrice: "500" }, undefined, client);
    await saveRecord(T, "bank.account", null, { code: "KB", name: "Účet", accountNum: "123456789/0100", isDefault: true }, undefined, client).catch(() => null);
    const p = await saveRecord(T, "int.portal", null, { name: "Členství", purpose: "agreement", title: "Staň se členem", agreementTerms: "Členská smlouva Monster Gym…", ipHourLimit: 5 }, undefined, client);

    const info = (await agreementPortalInfo(T.tenantId, String(p.token), client))!;
    expect([info.title, info.terms, info.tariffs.map((t) => [t.name, t.months, t.price])]).toEqual(["Staň se členem", "Členská smlouva Monster Gym…", [["Členství měsíční", 1, "1200.00"], ["Členství roční", 12, "10000.00"]]]);

    const base = { tariffId: String(mesic.id), firstName: "Petra", lastName: "Silná", email: "petra@example.com", phone: "+420 777 123 456", street: "Hlavní 1", city: "Praha", zipCode: "110 00", startDate: iso(new Date()), consent: true };
    expect(await agreementPortalSubmit(T.tenantId, String(p.token), { ...base, consent: false }, "10.0.0.1", client)).toMatchObject({ ok: false, error: expect.stringContaining("souhlasu") });
    expect(await agreementPortalSubmit(T.tenantId, String(p.token), { ...base, zipCode: "11" }, "10.0.0.1", client)).toMatchObject({ ok: false });
    expect(await agreementPortalSubmit(T.tenantId, String(p.token), { ...base, tariffId: "x" }, "10.0.0.1", client)).toMatchObject({ ok: false });

    const r = (await agreementPortalSubmit(T.tenantId, String(p.token), base, "10.0.0.2", client))!;
    expect(r.ok).toBe(true);
    expect(r.payment).toMatchObject({ amount: "1200.00", vs: expect.stringMatching(/^\d+$/) });
    const [agr] = (await listRecords(T, "ar.agreement", {}, client)).rows;
    expect([agr.agreementNum, agr.status, agr.amount, agr.periodMonths]).toEqual([r.agreementNum, "awaiting", "1200.00", 1]);
    expect(String(agr.terms)).toContain("Členská smlouva Monster Gym");
    const cust = (await getRecord(T, "ar.customer", String(agr.customerId), client))!;
    const subj = (await getRecord(T, "gab.subject", String(cust.subjectId), client))!;
    expect([subj.name, subj.type, subj.email]).toEqual(["Petra Silná", "person", "petra@example.com"]);
    // tatáž osoba podruhé: žádný nový subjekt ani odběratel, jen další smlouva
    await agreementPortalSubmit(T.tenantId, String(p.token), { ...base, firstName: "petra", lastName: "silná" }, "10.0.0.3", client);
    expect([(await listRecords(T, "ar.customer", {}, client)).total, (await listRecords(T, "ar.agreement", {}, client)).total]).toEqual([1, 2]);
    // portál na doklady smlouvu neuzavře
    const docs = await saveRecord(T, "int.portal", null, { name: "Doklady", slug: "faktury" }, undefined, client);
    expect(await agreementPortalSubmit(T.tenantId, String(docs.token), base, "10.0.0.4", client)).toBeNull();
  });
});
