/**
 * Smlouvy (předplatné na období): tarif z položky → výzva k platbě (objednávka + záloha s VS)
 * → úhrada bankou → aktivní do konce období + zaúčtovaná faktura → dávka: další výzva, blokace po lhůtě.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { createPrisma } from "@/server/db";
import { deleteRecord, getRecord, inTenant, listRecords, runAction, saveRecord, type Ctx } from "@/server/data";
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

    // mazání nezaúčtovaného (smlouva ↔ objednávka ↔ záloha na sebe odkazují)
    const b = await saveRecord(T, "ar.agreement", null, { customerId: cust.id, itemId: tariff.id, startDate: plus(0) }, undefined, client);
    await runAction(T, "ar.agreement", String(b.id), "requestPayment", client);
    let bb = (await getRecord(T, "ar.agreement", String(b.id), client))!;
    await deleteRecord(T, "ar.advance", String(bb.advanceId), client);
    bb = (await getRecord(T, "ar.agreement", String(b.id), client))!;
    expect([bb.advanceId, bb.status]).toEqual([null, "draft"]);
    await deleteRecord(T, "ar.order", String(bb.orderId), client);
    expect((await getRecord(T, "ar.agreement", String(b.id), client))!.orderId).toBeNull();
    await runAction(T, "ar.agreement", String(b.id), "requestPayment", client);
    bb = (await getRecord(T, "ar.agreement", String(b.id), client))!;
    const advId = String(bb.advanceId);
    await deleteRecord(T, "ar.order", String(bb.orderId), client); // s ní i nezaplacená záloha
    expect(await getRecord(T, "ar.advance", advId, client)).toBeNull();
    await runAction(T, "ar.agreement", String(b.id), "requestPayment", client);
    // smlouva s objednávkou / zálohou: nejdřív smazat je (stornovaná objednávka jde smazat), pak smlouvu
    await expect(deleteRecord(T, "ar.agreement", String(b.id), client)).rejects.toMatchObject({ label: "@TAX:AgrDeleteDocsFirst" });
    bb = (await getRecord(T, "ar.agreement", String(b.id), client))!;
    await runAction(T, "ar.order", String(bb.orderId), "cancel", client).catch(() => undefined);
    await deleteRecord(T, "ar.order", String(bb.orderId), client);
    await deleteRecord(T, "ar.agreement", String(b.id), client);
    expect(await getRecord(T, "ar.agreement", String(b.id), client)).toBeNull();
    expect((await listRecords(T, "ar.order", { filter: { agreementId: b.id } }, client)).total).toBe(0);
    // smlouva s fakturami ani zaplacená záloha smazat nejde
    await expect(deleteRecord(T, "ar.agreement", String(agr.id), client)).rejects.toMatchObject({ label: "@SYS:Locked" });
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

    // formulář portálu: pole, typ, povinnost a kam se uloží
    const fm = await saveRecord(T, "int.form", null, { code: "CLEN", name: "Přihláška", heading: "Údaje člena" }, undefined, client);
    const fld = (sequence: number, key: string, label: string, kind: string, mapping = "form", extra: Record<string, unknown> = {}) =>
      saveRecord(T, "int.formField", null, { formId: fm.id, sequence, key, label, kind, mapping, ...extra }, undefined, client);
    await fld(1, "jmeno", "Jméno", "text", "subject.firstName", { required: true });
    await fld(2, "prijmeni", "Příjmení", "text", "subject.lastName", { required: true });
    await fld(3, "email", "E-mail", "email", "subject.email", { required: true });
    await fld(4, "narozen", "Datum narození", "date", "form", { required: true });
    await fld(5, "op", "Číslo OP/pasu", "text");
    await fld(6, "ulice", "Ulice", "text", "address.street");
    await fld(7, "obec", "Obec", "text", "address.city");
    await fld(8, "kulice", "Kontaktní ulice", "text", "contact.street");
    await fld(9, "kobec", "Kontaktní obec", "text", "contact.city");
    await fld(10, "druh", "Druh členství", "select", "form", { options: "individuální\nfiremní", required: true });
    await fld(11, "karta", "Číslo karty", "text", "agreement.cardNumber");
    await fld(12, "oddil", "Souhlasy", "heading");
    await fld(13, "marketing", "Souhlasím se zasíláním obchodních sdělení", "checkbox");
    await fld(14, "vop", "Seznámil jsem se s VOP", "consent");
    await saveRecord(T, "int.portal", String(p.id), { formId: fm.id }, p.version as number, client);
    const fi = (await agreementPortalInfo(T.tenantId, String(p.token), client))!;
    expect([fi.form?.heading, fi.form?.fields.length, fi.form?.fields.find((x) => x.key === "druh")?.options, fi.form?.fields.find((x) => x.key === "vop")?.required]).toEqual(["Údaje člena", 14, ["individuální", "firemní"], true]);
    expect(JSON.stringify(fi.form)).not.toContain("subject."); // mapování na stránku nejde
    const ans = { jmeno: "Karel", prijmeni: "Silák", email: "Karel@Example.com", narozen: "1990-05-01", op: "123456789", ulice: "Dělnická 1", obec: "Praha", kulice: "Jiná 2", kobec: "Brno", druh: "individuální", karta: "K-77", marketing: false, vop: true };
    let ipN = 10;
    const sub = (a: Record<string, unknown>) => agreementPortalSubmit(T.tenantId, String(p.token), { ...base, firstName: "", lastName: "", email: "", answers: a as Record<string, string | boolean> }, `10.0.1.${ipN++}`, client);
    expect(await sub({ ...ans, vop: false })).toMatchObject({ ok: false, error: expect.stringContaining("VOP") });
    expect(await sub({ ...ans, narozen: "" })).toMatchObject({ ok: false, error: expect.stringContaining("Datum narození") });
    expect(await sub({ ...ans, druh: "jiný" })).toMatchObject({ ok: false, error: expect.stringContaining("Druh členství") });
    const rf = (await sub(ans))!;
    expect(rf.ok).toBe(true);
    const fa = (await listRecords(T, "ar.agreement", { filter: { agreementNum: rf.agreementNum } }, client)).rows[0];
    expect(fa.cardNumber).toBe("K-77");
    expect(JSON.parse(String(fa.formData))).toMatchObject({ narozen: "1990-05-01", op: "123456789", druh: "individuální", marketing: false, vop: true });
    expect(String(fa.formText)).toContain("Datum narození: 01. 05. 1990");
    const fs = (await getRecord(T, "gab.subject", String((await getRecord(T, "ar.customer", String(fa.customerId), client))!.subjectId), client))!;
    expect([fs.name, fs.email]).toEqual(["Karel Silák", "karel@example.com"]);
    const adr = (await listRecords(T, "gab.address", { filter: { subjectId: fs.id } }, client)).rows.map((a) => [a.kind, a.city]).sort();
    expect(adr).toEqual([["delivery", "Brno"], ["registered", "Praha"]]);
    // tisková sestava smlouvy: údaje formuláře jako {form.<klíč>}
    const { agreementPrintable } = await import("@/modules/prt/printables");
    const pd = await inTenant(T, (s) => agreementPrintable.dataset(s.sys().api(), T.companyId, String(fa.id)), client);
    expect((pd.form as Record<string, string>).op).toBe("123456789");
    expect((pd.form as Record<string, string>).marketing).toBe("ne");
    expect((pd.doc as Record<string, string>).cardNumber).toBe("K-77");
    expect((pd.partner as Record<string, string>).contactAddress).toContain("Brno");

    // „Zobrazit, když“: IČO jen u firemního členství – jinak se nekontroluje ani neukládá
    await fld(15, "ico", "IČO firmy", "text", "subject.regNo", { required: true, showIf: "druh=firemní" });
    expect((await agreementPortalInfo(T.tenantId, String(p.token), client))!.form!.fields.find((x) => x.key === "ico")).toMatchObject({ showIf: "druh=firemní" });
    expect((await sub({ ...ans, email: "a1@example.com" }))!.ok).toBe(true);
    expect(await sub({ ...ans, email: "a2@example.com", druh: "firemní" })).toMatchObject({ ok: false, error: expect.stringContaining("IČO") });
    expect((await agreementPortalInfo(T.tenantId, String(p.token), client))!.form!.fields.find((x) => x.key === "email")!.auto).toBe("email");

    // ARES u firemního člena: pole IČO = tlačítko, pole název / sídlo se doplní
    await fld(16, "firma", "Název firmy", "text", "subject.name", { showIf: "druh=firemní" });
    await fld(17, "dic", "DIČ", "text", "subject.vatId", { showIf: "druh=firemní" });
    const fi2 = (await agreementPortalInfo(T.tenantId, String(p.token), client))!.form!.fields;
    expect([fi2.find((x) => x.key === "ico")!.ares, fi2.find((x) => x.key === "firma")!.ares, fi2.find((x) => x.key === "obec")!.ares]).toEqual(["lookup", "name", "city"]);
    vi.stubGlobal("fetch", async (url: string) => {
      const u = String(url);
      if (u.includes("ekonomicke-subjekty/27082440")) return new Response(JSON.stringify({ ico: "27082440", obchodniJmeno: "Alza.cz a.s.", dic: "CZ27082440", pravniForma: "121", sidlo: { kodStatu: "CZ", nazevObce: "Praha", nazevUlice: "Jankovcova", cisloDomovni: 1522, cisloOrientacni: 53, psc: 17000 } }), { status: 200 });
      return new Response("{}", { status: 404 });
    });
    const { agreementPortalAres } = await import("@/server/agreement-portal");
    const ar1 = await agreementPortalAres(T.tenantId, String(p.token), "27082440", "10.9.9.9", client);
    expect(ar1).toMatchObject({ ok: true, name: "Alza.cz a.s.", vatId: "CZ27082440", city: "Praha" });
    expect(await agreementPortalAres(T.tenantId, String(p.token), "12", "10.9.9.9", client)).toMatchObject({ ok: false });
    expect(await agreementPortalAres(T.tenantId, String(docs.token), "27082440", "10.9.9.9", client)).toBeNull(); // jen portál smluv s polem IČO
    vi.unstubAllGlobals();

    // obchodní podmínky jako PDF a smlouva e-mailem (vyplněná smlouva + podmínky)
    const { agreementTermsPdf, agreementPortalMail } = await import("@/server/agreement-portal");
    const vop = await agreementTermsPdf(T.tenantId, String(p.token), client);
    expect(vop?.subarray(0, 4).toString()).toBe("%PDF");
    await saveRecord(T, "int.connection", null, { code: "TEST-MAIL", name: "Test", kind: "mail", driver: "mailTest", fromEmail: "test@shanon.local", active: true }, undefined, client);
    const rm = (await sub({ ...ans, email: "a3@example.com" }))!;
    expect(rm.ok && rm.agreementId).toBeTruthy();
    expect(await agreementPortalMail(T.tenantId, String(p.token), rm, client)).toBeNull(); // testovací pošta = nikomu skutečnému
    const [mail] = (await listRecords(T, "int.mail", { filter: { sourceId: rm.agreementId } }, client)).rows;
    expect([mail.status, mail.mailTo, String(mail.subject)]).toEqual(["sent", "a3@example.com", expect.stringContaining(String(rm.agreementNum))]);
    const files = await client.sysDocuRef.findMany({ where: { tenantId: T.tenantId, objectId: "int.mail", recordId: String(mail.id), kind: "file" } });
    expect(files.map((f) => f.name).sort()).toEqual(["Obchodni_podminky.pdf", `Smlouva_${String(rm.agreementNum)}.pdf`]);
  }, 120_000);
});

describe("smlouva v režimu Kalendář (bez zálohy)", () => {
  it("výzva = kalendář a VS → první platba aktivuje + faktura → další splátka → blokace → úhrada odblokuje", async () => {
    const T = (await provisionTenant(client, { code: `t-sch-${run}`, name: "SCH", adminEmail: `sch-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar", "bank", "inv"], company: { code: "M", name: "Gym" } })).ctx;
    const acc = async (num: string) => String((await listRecords(T, "gl.account", { filter: { accountNum: num } }, client)).rows[0].id);
    const [prm] = (await listRecords(T, "ar.parameters", {}, client)).rows;
    await saveRecord(T, "ar.parameters", String(prm.id), { agreementMode: "schedule", agreementDueDays: 3, agreementBlockDays: 0 }, prm.version as number, client);
    const g = (await listRecords(T, "inv.itemGroup", {}, client)).rows[0];
    const u = (await listRecords(T, "inv.unit", {}, client)).rows[0];
    const tariff = await saveRecord(T, "inv.item", null, { itemNum: "CLEN1", name: "Členství měsíční", groupId: g.id, unitId: u.id, salesPrice: "1000", priceInclTax: true, agreementMonths: 1 }, undefined, client);
    const subj = await saveRecord(T, "gab.subject", null, { name: "Petr Silný" }, undefined, client);
    const [grp] = (await listRecords(T, "ar.group", {}, client)).rows;
    const cust = await saveRecord(T, "ar.customer", null, { subjectId: subj.id, groupId: grp.id }, undefined, client);
    const start = plus(0);
    const agr = await saveRecord(T, "ar.agreement", null, { customerId: cust.id, itemId: tariff.id, startDate: start, cardNumber: "K-0042" }, undefined, client);
    let a = (await getRecord(T, "ar.agreement", String(agr.id), client))!;
    expect(a.vs).toBe(String(a.agreementNum).replace(/\D/g, ""));
    expect(a.cardNumber).toBe("K-0042");

    // výzva: kalendář na rok (12 měsíčních splátek), žádná objednávka ani záloha
    await runAction(T, "ar.agreement", String(agr.id), "requestPayment", client);
    a = (await getRecord(T, "ar.agreement", String(agr.id), client))!;
    const lines = (await listRecords(T, "ar.agreementLine", { filter: { agreementId: agr.id }, pageSize: 100 }, client)).rows;
    expect([a.status, lines.length, lines[0].periodFrom, lines[0].periodTo, lines[0].amount]).toEqual(["awaiting", 12, start, periodEnd(start, 1), "1000.00"]);
    expect((await listRecords(T, "ar.order", { filter: { agreementId: agr.id } }, client)).total).toBe(0);
    expect((await listRecords(T, "ar.advance", { filter: { agreementId: agr.id } }, client)).total).toBe(0);

    // první platba s VS smlouvy → aktivní, faktura první splátky zaplacená
    const bank = await saveRecord(T, "bank.account", null, { code: "KB", name: "Účet", accountNum: "123456789/0100", glAccountId: await acc("221000") }, undefined, client);
    const pay = async (n: number, amount: string, post = true) => {
      const st = await saveRecord(T, "bank.statement", null, { bankAccountId: bank.id, statementNum: String(n), date: iso(new Date()), openingBalance: "0" }, undefined, client);
      const ln = await saveRecord(T, "bank.statementLine", null, { statementId: st.id, lineNum: 1, date: iso(new Date()), amount, vs: a.vs }, undefined, client);
      await runAction(T, "bank.statement", String(st.id), "match", client);
      const matched = (await getRecord(T, "bank.statementLine", String(ln.id), client))!;
      if (post) await runAction(T, "bank.statement", String(st.id), "post", client);
      return matched;
    };
    expect((await pay(1, "999", false)).matchKind).not.toBe("customerAgreement"); // jiná částka = ručně
    const m = await pay(2, "1000");
    expect(m.matchKind).toBe("customerAgreement");
    a = (await getRecord(T, "ar.agreement", String(agr.id), client))!;
    let inv = (await listRecords(T, "ar.invoice", { filter: { agreementId: agr.id } }, client)).rows;
    expect([a.status, a.paidUntil, inv.length, inv[0].status, inv[0].vs, inv[0].paidAmount]).toEqual(["active", periodEnd(start, 1), 1, "posted", a.vs, "1000.00"]);
    const ls = (await listRecords(T, "ar.agreementLine", { filter: { agreementId: agr.id }, pageSize: 100 }, client)).rows;
    expect(ls.slice(0, 2).map((l) => l.status)).toEqual(["paid", "planned"]);

    // dávka: druhá splátka se vystaví před začátkem období, splatnost 3 dny
    const job = async (today: string) => inTenant(T, (s) => runAgreements(s.sys().api(), regDocs(), today), client);
    const from2 = String(ls[1].periodFrom).slice(0, 10);
    expect(await job(from2)).toEqual({ issued: 1, blocked: 0 });
    inv = (await listRecords(T, "ar.invoice", { filter: { agreementId: agr.id }, sort: "invoiceNum" }, client)).rows;
    const inv2 = inv.find((x) => x.paidAmount !== "1000.00")!;
    const due2 = iso(new Date(new Date(`${from2}T00:00:00Z`).getTime() + 3 * 86400000));
    expect([inv.length, String(inv2.dueDate).slice(0, 10), inv2.vs]).toEqual([2, due2, a.vs]);
    // po splatnosti nezaplaceno → blokovaná, další splátky se nevystavují
    const late = iso(new Date(new Date(`${due2}T00:00:00Z`).getTime() + 86400000));
    expect(await job(late)).toEqual({ issued: 0, blocked: 1 });
    const later = String(ls[3].periodFrom).slice(0, 10);
    expect(await job(later)).toEqual({ issued: 0, blocked: 0 });
    expect((await listRecords(T, "ar.invoice", { filter: { agreementId: agr.id } }, client)).total).toBe(2);
    expect((await getRecord(T, "ar.agreement", String(agr.id), client))!.status).toBe("blocked");
    // úhrada faktury (VS smlouvy) → odblokováno, zaplaceno do konce 2. splátky
    const m2 = await pay(3, "1000");
    expect(m2.matchKind).toBe("customer");
    a = (await getRecord(T, "ar.agreement", String(agr.id), client))!;
    expect([a.status, a.paidUntil]).toEqual(["active", String(ls[1].periodTo).slice(0, 10)]);

    // ruční aktivace (zaplaceno na recepci): faktura první splátky, smlouva aktivní
    const b = await saveRecord(T, "ar.agreement", null, { customerId: cust.id, itemId: tariff.id, startDate: start }, undefined, client);
    await runAction(T, "ar.agreement", String(b.id), "activate", client);
    const bb = (await getRecord(T, "ar.agreement", String(b.id), client))!;
    expect([bb.status, (await listRecords(T, "ar.invoice", { filter: { agreementId: b.id } }, client)).total]).toEqual(["active", 1]);

    // tarif za kartu: cena smlouvy = cena × počet karet, řádek faktury 3 ks × 800
    const firm = await saveRecord(T, "inv.item", null, { itemNum: "FIRMA1", name: "Firemní členství", groupId: g.id, unitId: u.id, salesPrice: "800", priceInclTax: true, agreementMonths: 1, agreementPerUnit: true }, undefined, client);
    const c = await saveRecord(T, "ar.agreement", null, { customerId: cust.id, itemId: firm.id, startDate: start, quantity: 3 }, undefined, client);
    expect([c.amount, c.quantity]).toEqual(["2400.00", 3]);
    // VS jde přepsat, ale jen jedinečný
    const cvs = (await getRecord(T, "ar.agreement", String(c.id), client))!;
    await saveRecord(T, "ar.agreement", String(c.id), { vs: "777123" }, cvs.version as number, client);
    expect((await getRecord(T, "ar.agreement", String(c.id), client))!.vs).toBe("777123");
    await expect(saveRecord(T, "ar.agreement", String(agr.id), { vs: "777123" }, (await getRecord(T, "ar.agreement", String(agr.id), client))!.version as number, client)).rejects.toBeTruthy();
    const cv = (await getRecord(T, "ar.agreement", String(c.id), client))!;
    const c2 = await saveRecord(T, "ar.agreement", String(c.id), { quantity: 5 }, cv.version as number, client);
    expect(c2.amount).toBe("4000.00");
    await runAction(T, "ar.agreement", String(c.id), "activate", client);
    const [ci] = (await listRecords(T, "ar.invoice", { filter: { agreementId: c.id } }, client)).rows;
    const cl = (await listRecords(T, "ar.invoiceLine", { filter: { invoiceId: ci.id } }, client)).rows;
    expect([ci.amountGross, cl[0].qty, cl[0].unitPrice]).toEqual(["4000.00", "5.0000", "800.00"]);
    expect((await getRecord(T, "ar.agreement", String(c.id), client))!.quantity).toBe(5);
  }, 120_000);
});

describe("portál smluv – platba kartou, začátek od platby, PDF", () => {
  it("bez počátku: začátek dnem platby; karta přes testovací bránu aktivuje; PDF smlouvy na více stran", async () => {
    const { agreementPortalInfo, agreementPortalSubmit, agreementPortalPay, agreementPortalPaid } = await import("@/server/agreement-portal");
    const { enableTestEnv } = await import("@/modules/int/test-env");
    const { simDecide } = await import("@/server/gateway-sim");
    const { printJob } = await import("@/server/print");
    const { renderPdf } = await import("@/server/print-pdf");
    const T = (await provisionTenant(client, { code: `t-agc-${run}`, name: "AGC", adminEmail: `agc-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar", "bank", "inv", "int"], company: { code: "M", name: "Gym" } })).ctx;
    const [prm] = (await listRecords(T, "ar.parameters", {}, client)).rows;
    await saveRecord(T, "ar.parameters", String(prm.id), { agreementMode: "schedule", agreementDueDays: 3 }, prm.version as number, client);
    await inTenant(T, (s) => enableTestEnv(s.sys().api(), (x) => x, false), client);
    const g = (await listRecords(T, "inv.itemGroup", {}, client)).rows[0];
    const u = (await listRecords(T, "inv.unit", {}, client)).rows[0];
    await saveRecord(T, "inv.item", null, { itemNum: "CLEN1", name: "Členství měsíční", groupId: g.id, unitId: u.id, salesPrice: "900", priceInclTax: true, agreementMonths: 1 }, undefined, client);
    await saveRecord(T, "bank.account", null, { code: "KB", name: "Účet", accountNum: "123456789/0100", isDefault: true }, undefined, client).catch(() => null);
    const terms = ["SMLUVNÍ PODMÍNKY", ...Array.from({ length: 12 }, (_, i) => `${i + 1}. ČLÁNEK ČÍSLO ${i + 1}\n${"Dlouhý odstavec podmínek, který se musí zalomit na více řádků i stránek. ".repeat(12)}`)].join("\n");
    const fm = await saveRecord(T, "int.form", null, { code: "F", name: "F" }, undefined, client);
    const fld = (sequence: number, key: string, label: string, kind: string, mapping: string, extra: Record<string, unknown> = {}) => saveRecord(T, "int.formField", null, { formId: fm.id, sequence, key, label, kind, mapping, ...extra }, undefined, client);
    await fld(10, "jmeno", "Jméno", "text", "subject.firstName", { required: true });
    await fld(20, "prijmeni", "Příjmení", "text", "subject.lastName", { required: true });
    await fld(30, "email", "E-mail", "email", "subject.email", { required: true });
    await fld(35, "ulice", "Ulice", "text", "address.street");
    await fld(36, "obec", "Obec", "text", "address.city");
    await fld(37, "psc", "PSČ", "text", "address.zipCode");
    await fld(40, "stat", "Stát", "select", "address.country", { options: "Česká republika|Slovensko|Německo" });
    await fld(50, "zacatek", "Počátek členství", "date", "agreement.startDate");
    const p = await saveRecord(T, "int.portal", null, { name: "Členství", purpose: "agreement", title: "Členství", agreementTerms: terms, formId: fm.id, ipHourLimit: 50 }, undefined, client);
    const info = (await agreementPortalInfo(T.tenantId, String(p.token), client))!;
    expect(info.cardPay).toBe(true);
    const r = (await agreementPortalSubmit(T.tenantId, String(p.token), { tariffId: info.tariffs[0].id, firstName: "", lastName: "", email: "", phone: "", street: "", city: "", zipCode: "", startDate: "", consent: true, answers: { jmeno: "Jana", prijmeni: "Nováková", email: "jana@example.test", stat: "Slovensko", zacatek: "", ulice: "Hlavná 1", obec: "Bratislava", psc: "81101" } }, "10.9.0.1", client))!;
    expect(r.ok).toBe(true);
    let agr = (await getRecord(T, "ar.agreement", r.agreementId!, client))!;
    expect([agr.status, agr.startOnPayment]).toEqual(["awaiting", true]);
    const subj = (await listRecords(T, "gab.subject", { filter: { email: "jana@example.test" } }, client)).rows[0];
    expect((await listRecords(T, "gab.address", { filter: { subjectId: subj.id } }, client)).rows.map((a) => a.country)).toContain("SK");

    // PDF: znění od nové stránky, nic se nepřekrývá (aspoň 3 strany)
    const job = await printJob(T, "ar.agreement", r.agreementId!, null, client);
    const pdf = await renderPdf(job.layout, job.data, { locale: "cs-CZ", title: job.title });
    expect((pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBeGreaterThanOrEqual(3);

    // karta: testovací brána → Zaplatit → smlouva aktivní, začátek = dnes, první splátka zaplacená
    const url = (await agreementPortalPay(T.tenantId, String(p.token), r.payRef!, "http://localhost:3100", "http://localhost:3100/x?zaplaceno=1", client))!;
    const m = /\/pay-sim\/[0-9a-f-]{36}\/([0-9a-f-]{36})$/.exec(url);
    expect(m).toBeTruthy();
    await simDecide(T.tenantId, m![1], true, client);
    expect(await agreementPortalPaid(T.tenantId, String(p.token), r.payRef!, client)).toMatchObject({ status: "active" });
    agr = (await getRecord(T, "ar.agreement", r.agreementId!, client))!;
    expect([agr.status, agr.startDate, agr.startOnPayment]).toEqual(["active", iso(new Date()), false]);
    const lines = (await listRecords(T, "ar.agreementLine", { filter: { agreementId: agr.id }, pageSize: 100, sort: "lineNum" }, client)).rows;
    expect([lines[0].status, lines[0].periodFrom]).toEqual(["paid", iso(new Date())]);
    // opakované ověření nic nezmění
    expect(await agreementPortalPaid(T.tenantId, String(p.token), r.payRef!, client)).toMatchObject({ status: "active" });
  }, 120_000);
});
