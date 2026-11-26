/**
 * Vyrovnání v deníku: řádek bez partnera → dialog najde otevřené faktury podle kritérií, výběr doplní
 * odběratele, VS a částku; zaúčtování uhradí přesně vybrané částky; kontroly přeplatku a jiného partnera.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { getRecord, listRecords, runAction, saveRecord, deleteRecord } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { settleSave, settleView } from "@/server/journal-settle";

const client = createPrisma();
const run = Date.now().toString(36);
afterAll(() => client.$disconnect());

describe("vyrovnání řádku deníku", () => {
  it("najít otevřené položky, vyrovnat dvě faktury (jednu částečně), zaúčtovat", async () => {
    const C = (await provisionTenant(client, { code: `t-js-${run}`, name: "JS", adminEmail: `js-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar", "ap", "bank"], company: { code: "J", name: "J" } })).ctx;
    const acc = async (n: string) => String((await listRecords(C, "gl.account", { filter: { accountNum: n } }, client)).rows[0].id);
    const [grp] = (await listRecords(C, "ar.group", {}, client)).rows;
    const cust = async (name: string) => saveRecord(C, "ar.customer", null, { subjectId: (await saveRecord(C, "gab.subject", null, { name }, undefined, client)).id, groupId: grp.id }, undefined, client);
    const eva = await cust("Eva Platná");
    const jan = await cust("Jan Jiný");
    const a602 = await acc("602000");
    const a261 = await acc("261000");
    // faktury: Eva 1000 (VS 11) a 500 (VS 12), Jan 700 (VS 13)
    const j1 = await saveRecord(C, "gl.journal", null, { date: "2026-11-10", description: "Faktury" }, undefined, client);
    for (const [c, amt, vs] of [[eva, "1000", "11"], [eva, "500", "12"], [jan, "700", "13"]] as const)
      await saveRecord(C, "gl.journalLine", null, { journalId: j1.id, accountType: "customer", customerId: c.id, debit: amt, vs, offsetType: "ledger", offsetAccountId: a602 }, undefined, client);
    await runAction(C, "gl.journal", String(j1.id), "post", client);

    // úhrada: řádek bez partnera a bez částky
    const j2 = await saveRecord(C, "gl.journal", null, { date: "2026-11-20", description: "Úhrady" }, undefined, client);
    const ln = await saveRecord(C, "gl.journalLine", null, { journalId: j2.id, accountType: "ledger", offsetType: "ledger", offsetAccountId: a261, text: "Platba Eva" }, undefined, client);
    let v = await settleView(C, String(ln.id), {}, "cs", client);
    expect(v.line.partnerKind).toBeNull();
    expect(v.rows.map((r) => r.vs).sort()).toEqual(["11", "12", "13"]);
    v = await settleView(C, String(ln.id), { text: "platná" }, "cs", client);
    expect(v.rows.map((r) => r.vs).sort()).toEqual(["11", "12"]);
    expect((await settleView(C, String(ln.id), { amount: "700" }, "cs", client)).rows.map((r) => r.vs)).toEqual(["13"]);
    const t11 = v.rows.find((r) => r.vs === "11")!;
    const t12 = v.rows.find((r) => r.vs === "12")!;
    const t13 = (await settleView(C, String(ln.id), { vs: "13" }, "cs", client)).rows[0];

    // dva partneři najednou nejdou; přeplatek nejde
    await expect(settleSave(C, String(ln.id), [{ kind: "customer", transId: t11.transId, amount: "" }, { kind: "customer", transId: t13.transId, amount: "" }], client)).rejects.toMatchObject({ label: "@GL:SettleOnePartner" });
    await expect(settleSave(C, String(ln.id), [{ kind: "customer", transId: t12.transId, amount: "600" }], client)).rejects.toMatchObject({ label: "@GL:SettleTooMuch" });

    await settleSave(C, String(ln.id), [{ kind: "customer", transId: t11.transId, amount: "" }, { kind: "customer", transId: t12.transId, amount: "200" }], client);
    let line = (await getRecord(C, "gl.journalLine", String(ln.id), client))!;
    expect([line.accountType, line.customerId, line.credit, line.debit ?? null, line.settleStatus]).toEqual(["customer", eva.id, "1200.00", null, "full"]);
    v = await settleView(C, String(ln.id), {}, "cs", client);
    expect(v.line.partnerKind).toBe("customer");
    expect(v.rows.filter((r) => r.selected).map((r) => [r.vs, r.selected])).toEqual([["11", "1000.00"], ["12", "200.00"]]);
    expect(v.rows.some((r) => r.vs === "13")).toBe(false); // jen partner řádku

    // vyšší částka řádku → částečně
    line = await saveRecord(C, "gl.journalLine", String(ln.id), { credit: "1500" }, line.version as number, client);
    expect(line.settleStatus).toBe("partial");
    line = await saveRecord(C, "gl.journalLine", String(ln.id), { credit: "1200" }, line.version as number, client);
    expect(line.settleStatus).toBe("full");

    await runAction(C, "gl.journal", String(j2.id), "post", client);
    const trans = (await listRecords(C, "ar.trans", { filter: { kind: "invoice" } }, client)).rows;
    const by = (vs: string) => trans.find((x) => x.vs === vs)!;
    expect([by("11").paidAmount, by("11").closed, by("12").paidAmount, by("12").closed, by("13").paidAmount]).toEqual(["1000.00", true, "200.00", false, "0.00"]);

    // jiný partner na řádku zruší vyrovnání; smazání řádku ho smaže
    const j3 = await saveRecord(C, "gl.journal", null, { date: "2026-11-21", description: "Úhrady 2" }, undefined, client);
    const ln3 = await saveRecord(C, "gl.journalLine", null, { journalId: j3.id, accountType: "customer", customerId: eva.id, credit: "300", offsetType: "ledger", offsetAccountId: a261 }, undefined, client);
    await settleSave(C, String(ln3.id), [{ kind: "customer", transId: t12.transId, amount: "" }], client);
    expect((await getRecord(C, "gl.journalLine", String(ln3.id), client))!).toMatchObject({ settleStatus: "full", vs: "12" });
    const l3 = (await getRecord(C, "gl.journalLine", String(ln3.id), client))!;
    const l3b = await saveRecord(C, "gl.journalLine", String(ln3.id), { customerId: jan.id }, l3.version as number, client);
    expect(l3b.settleStatus).toBe("none");
    await settleSave(C, String(ln3.id), [{ kind: "customer", transId: t13.transId, amount: "300" }], client);
    await deleteRecord(C, "gl.journalLine", String(ln3.id), client);
    expect((await listRecords(C, "gl.journalSettlement", { filter: { journalId: j3.id } }, client).catch(() => ({ total: 0 }))).total).toBe(0);
  }, 120_000);

  it("záloha a smlouva (první platba): úhrada zálohy na 324, aktivace smlouvy a úhrada první splátky", async () => {
    const C = (await provisionTenant(client, { code: `t-js2-${run}`, name: "JS2", adminEmail: `js2-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar", "bank", "inv"], company: { code: "J", name: "J" } })).ctx;
    const acc = async (n: string) => String((await listRecords(C, "gl.account", { filter: { accountNum: n } }, client)).rows[0].id);
    const [grp] = (await listRecords(C, "ar.group", {}, client)).rows;
    const subj = await saveRecord(C, "gab.subject", null, { name: "Karel Záloha" }, undefined, client);
    const cust = await saveRecord(C, "ar.customer", null, { subjectId: subj.id, groupId: grp.id }, undefined, client);
    const a261 = await acc("261000");
    const adv = await saveRecord(C, "ar.advance", null, { customerId: cust.id, amount: "500", issueDate: "2026-11-20", description: "Záloha" }, undefined, client);
    // smlouva v režimu Kalendář čeká na první platbu
    const [prm] = (await listRecords(C, "ar.parameters", {}, client)).rows;
    await saveRecord(C, "ar.parameters", String(prm.id), { agreementMode: "schedule" }, prm.version as number, client);
    const g = (await listRecords(C, "inv.itemGroup", {}, client)).rows[0];
    const u = (await listRecords(C, "inv.unit", {}, client)).rows[0];
    const tariff = await saveRecord(C, "inv.item", null, { itemNum: "M1", name: "Měsíc", groupId: g.id, unitId: u.id, salesPrice: "800", priceInclTax: true, agreementMonths: 1 }, undefined, client);
    const agr = await saveRecord(C, "ar.agreement", null, { customerId: cust.id, itemId: tariff.id, startDate: "2026-11-20" }, undefined, client);
    await runAction(C, "ar.agreement", String(agr.id), "requestPayment", client);

    const j = await saveRecord(C, "gl.journal", null, { date: "2026-11-21", description: "Úhrady" }, undefined, client);
    const l1 = await saveRecord(C, "gl.journalLine", null, { journalId: j.id, accountType: "ledger", offsetType: "ledger", offsetAccountId: a261 }, undefined, client);
    const l2 = await saveRecord(C, "gl.journalLine", null, { journalId: j.id, accountType: "ledger", offsetType: "ledger", offsetAccountId: a261 }, undefined, client);
    const va = await settleView(C, String(l1.id), { type: "advance" }, "cs", client);
    expect(va.rows.map((r) => [r.type, r.remaining])).toEqual([["advance", "500.00"]]);
    await settleSave(C, String(l1.id), [{ kind: "customer", type: "advance", transId: va.rows[0].transId, amount: "" }], client);
    const vg = await settleView(C, String(l2.id), { type: "agreement" }, "cs", client);
    expect(vg.rows.map((r) => [r.type, r.remaining])).toEqual([["agreement", "800.00"]]);
    await settleSave(C, String(l2.id), [{ kind: "customer", type: "agreement", transId: vg.rows[0].transId, amount: "" }], client);
    expect([(await getRecord(C, "gl.journalLine", String(l1.id), client))!.credit, (await getRecord(C, "gl.journalLine", String(l2.id), client))!.credit]).toEqual(["500.00", "800.00"]);

    await runAction(C, "gl.journal", String(j.id), "post", client);
    expect((await getRecord(C, "ar.advance", String(adv.id), client))!.paidAmount).toBe("500.00");
    const a = (await getRecord(C, "ar.agreement", String(agr.id), client))!;
    expect(a.status).toBe("active");
    // aktivace = objednávka K fakturaci, platba smlouvy v saldu; Vyfakturovat ji použije
    expect((await listRecords(C, "ar.trans", { filter: { agreementId: agr.id, kind: "payment" } }, client)).rows.map((x) => [x.amountCur, x.closed])).toEqual([["-800.00", false]]);
    await runAction(C, "ar.agreement", String(agr.id), "invoiceDue", client);
    const invs = (await listRecords(C, "ar.trans", { filter: { kind: "invoice" } }, client)).rows;
    expect(invs.map((x) => [x.amount, x.paidAmount, x.closed])).toEqual([["800.00", "800.00", true]]);
    expect((await getRecord(C, "gl.journalLine", String(l2.id), client))!.settleStatus).toBe("settled");
    // záloha šla na účet záloh (324)
    const a324 = await acc("324000");
    const tr = (await listRecords(C, "gl.trans", { filter: { accountId: a324 } }, client)).rows;
    expect(tr.map((x) => x.amount)).toContain("-500.00"); // + DPH ze zálohy (daňový doklad k přijaté platbě)
  }, 120_000);

  it("výpis → deník: spárovaná smlouva je Označeno k vyrovnání, aktivuje ji až zaúčtování deníku", async () => {
    const C = (await provisionTenant(client, { code: `t-js3-${run}`, name: "JS3", adminEmail: `js3-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar", "bank", "inv"], company: { code: "J", name: "J" } })).ctx;
    const acc = async (n: string) => String((await listRecords(C, "gl.account", { filter: { accountNum: n } }, client)).rows[0].id);
    const [grp] = (await listRecords(C, "ar.group", {}, client)).rows;
    const subj = await saveRecord(C, "gab.subject", null, { name: "Člen Výpis" }, undefined, client);
    const cust = await saveRecord(C, "ar.customer", null, { subjectId: subj.id, groupId: grp.id }, undefined, client);
    const [prm] = (await listRecords(C, "ar.parameters", {}, client)).rows;
    await saveRecord(C, "ar.parameters", String(prm.id), { agreementMode: "schedule" }, prm.version as number, client);
    const g = (await listRecords(C, "inv.itemGroup", {}, client)).rows[0];
    const u = (await listRecords(C, "inv.unit", {}, client)).rows[0];
    const tariff = await saveRecord(C, "inv.item", null, { itemNum: "M1", name: "Měsíc", groupId: g.id, unitId: u.id, salesPrice: "900", priceInclTax: true, agreementMonths: 1 }, undefined, client);
    const agr = await saveRecord(C, "ar.agreement", null, { customerId: cust.id, itemId: tariff.id, startDate: "2026-11-20" }, undefined, client);
    await runAction(C, "ar.agreement", String(agr.id), "requestPayment", client);
    const vs = String((await getRecord(C, "ar.agreement", String(agr.id), client))!.vs);
    const bank = await saveRecord(C, "bank.account", null, { code: "KB", name: "Účet", accountNum: "2000145399/0800", glAccountId: await acc("221000") }, undefined, client);
    const st = await saveRecord(C, "bank.statement", null, { bankAccountId: bank.id, statementNum: "1", date: "2026-11-25", openingBalance: "0" }, undefined, client);
    await saveRecord(C, "bank.statementLine", null, { statementId: st.id, lineNum: 1, date: "2026-11-25", amount: "900", vs }, undefined, client);
    await runAction(C, "bank.statement", String(st.id), "match", client);
    await runAction(C, "bank.statement", String(st.id), "createJournal", client);
    const jId = String((await getRecord(C, "bank.statement", String(st.id), client))!.journalId);
    const [jl] = (await listRecords(C, "gl.journalLine", { filter: { journalId: jId } }, client)).rows;
    expect([jl.accountType, jl.customerId, jl.vs, jl.settleStatus]).toEqual(["customer", cust.id, vs, "full"]);
    expect((await getRecord(C, "ar.agreement", String(agr.id), client))!.status).toBe("awaiting"); // ještě ne
    await runAction(C, "gl.journal", jId, "post", client);
    const a = (await getRecord(C, "ar.agreement", String(agr.id), client))!;
    expect(a.status).toBe("active");
    const [ln] = (await listRecords(C, "ar.agreementLine", { filter: { agreementId: agr.id }, sort: "lineNum" }, client)).rows;
    expect([ln.status, String(ln.paymentDate).slice(0, 10)]).toEqual(["toInvoice", "2026-11-25"]);
    expect((await getRecord(C, "gl.journalLine", String(jl.id), client))!.settleStatus).toBe("settled");
    await runAction(C, "ar.agreement", String(agr.id), "invoiceDue", client);
    const [it] = (await listRecords(C, "ar.trans", { filter: { kind: "invoice" } }, client)).rows;
    expect([it.amount, it.closed]).toEqual(["900.00", true]);
  }, 120_000);

  it("Označit k vyrovnání z faktury: volná platba v deníku → po zaúčtování uhrazená faktura", async () => {
    const { markSettleSave, markSettleView } = await import("@/server/journal-settle");
    const C = (await provisionTenant(client, { code: `t-js4-${run}`, name: "JS4", adminEmail: `js4-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar", "bank"], company: { code: "J", name: "J" } })).ctx;
    const acc = async (n: string) => String((await listRecords(C, "gl.account", { filter: { accountNum: n } }, client)).rows[0].id);
    const [grp] = (await listRecords(C, "ar.group", {}, client)).rows;
    const subj = await saveRecord(C, "gab.subject", null, { name: "Fakturovaný" }, undefined, client);
    const cust = await saveRecord(C, "ar.customer", null, { subjectId: subj.id, groupId: grp.id }, undefined, client);
    const j1 = await saveRecord(C, "gl.journal", null, { date: "2026-11-10", description: "Faktura" }, undefined, client);
    await saveRecord(C, "gl.journalLine", null, { journalId: j1.id, accountType: "customer", customerId: cust.id, debit: "650", vs: "55", offsetType: "ledger", offsetAccountId: await acc("602000") }, undefined, client);
    await runAction(C, "gl.journal", String(j1.id), "post", client);
    // faktura jako doklad: položka salda z deníku nemá ar.invoice – vytvořím fakturu přímo
    const inv = await saveRecord(C, "ar.invoice", null, { customerId: cust.id, invoiceDate: "2026-11-12" }, undefined, client);
    await saveRecord(C, "ar.invoiceLine", null, { invoiceId: inv.id, description: "Služba", qty: "1", unitPrice: "1000" }, undefined, client);
    await runAction(C, "ar.invoice", String(inv.id), "post", client);
    const j2 = await saveRecord(C, "gl.journal", null, { date: "2026-11-20", description: "Výpis" }, undefined, client);
    const free = await saveRecord(C, "gl.journalLine", null, { journalId: j2.id, accountType: "ledger", credit: "1210", offsetType: "ledger", offsetAccountId: await acc("261000"), text: "Neznámá platba" }, undefined, client);
    const v = await markSettleView(C, "ar.invoice", String(inv.id), {}, "cs", client);
    expect(v.rows.map((r) => r.lineId)).toContain(String(free.id));
    await markSettleSave(C, "ar.invoice", String(inv.id), String(free.id), "", client);
    const l = (await getRecord(C, "gl.journalLine", String(free.id), client))!;
    expect([l.accountType, l.customerId, l.settleStatus]).toEqual(["customer", cust.id, "full"]);
    await runAction(C, "gl.journal", String(j2.id), "post", client);
    const it = (await listRecords(C, "ar.trans", { filter: { invoiceId: inv.id, kind: "invoice" } }, client)).rows[0];
    expect([it.paidAmount, it.closed]).toEqual([it.amountCur, true]);
  }, 120_000);
});
