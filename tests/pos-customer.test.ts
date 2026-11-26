/**
 * Pokladna a známý odběratel: účtenka s odběratelem (faktura – daňový doklad, KH jednotlivě od 10 000 Kč
 * s DIČ), prodej na fakturu (zaúčtovaná faktura s cenami s DPH, saldo), odeslání účtenky a faktury e-mailem.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { getRecord, inTenant, listRecords, runAction, saveRecord, type Ctx } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { receiptPrint, sell, sellOnInvoice } from "@/modules/pos/sale";
import { receiptData } from "@/lib/receipt-data";
import { sendDocumentNow } from "@/server/mail";
import type { DataApi } from "@/core/module";

const client = createPrisma();
const run = Date.now().toString(36);

describe("pokladna se známým odběratelem", () => {
  let P: Ctx;
  let regId: string;
  const ids: Record<string, string> = {};
  const api = <T>(fn: (a: DataApi) => Promise<T>) => inTenant(P, (s) => fn(s.sys().api()), client);

  beforeAll(async () => {
    P = (await provisionTenant(client, { code: `t-posc-${run}`, name: "Posc", adminEmail: `posc-${run}@test.local`, adminPassword: "heslo-12345", modules: ["pos", "ar", "int"], company: { code: "PC", name: "Pokladna s.r.o.", regNo: "12345678", vatId: "CZ12345678" } })).ctx;
    regId = String((await listRecords(P, "pos.register", {}, client)).rows[0].id);
    const g = (await listRecords(P, "inv.itemGroup", { filter: { code: "ZBOZI" } }, client)).rows[0];
    const ks = (await listRecords(P, "inv.unit", { filter: { code: "KS" } }, client)).rows[0];
    ids.item = String((await saveRecord(P, "inv.item", null, { itemNum: "D1", name: "Dárkový koš", groupId: g.id, unitId: ks.id, salesPrice: "1210", priceInclTax: true }, undefined, client)).id);
    const subj = await saveRecord(P, "gab.subject", null, { name: "Restaurace U Lípy s.r.o.", regNo: "87654321", vatId: "CZ87654321", email: "ucetni@lipa.test" }, undefined, client);
    await saveRecord(P, "gab.address", null, { subjectId: subj.id, street: "Lipová 3", city: "Brno", zipCode: "60200" }, undefined, client);
    const grp = (await listRecords(P, "ar.group", {}, client)).rows[0];
    ids.cust = String((await saveRecord(P, "ar.customer", null, { subjectId: subj.id, groupId: grp.id }, undefined, client)).id);
    await saveRecord(P, "pos.shift", null, { registerId: regId, openingCash: "0" }, undefined, client);
    await saveRecord(P, "int.connection", null, { code: "TEST-MAIL", name: "Test", kind: "mail", driver: "mailTest", fromEmail: "pokladna@test.local" }, undefined, client);
  }, 120_000);

  it("účtenka s odběratelem = faktura – daňový doklad; KH jednotlivě od 10 000 Kč s DIČ", async () => {
    const r = await api((a) => sell(a, { registerId: regId, payment: "card", customerId: ids.cust, lines: [{ itemId: ids.item, qty: "10" }] }));
    expect(r.customerId).toBe(ids.cust);
    const pr = await api((a) => receiptPrint(a, P.companyId, String(r.id)));
    expect(pr.customer).toMatchObject({ name: "Restaurace U Lípy s.r.o.", regNo: "87654321", vatId: "CZ87654321", address: "Lipová 3, 60200 Brno", email: "ucetni@lipa.test" });
    const d = receiptData(pr);
    expect([d.doc.title, d.customer.ids]).toEqual(["Faktura – daňový doklad", "IČO 87654321   DIČ CZ87654321"]);
    // ISDOC účtenky s odběratelem: odběratel s IČO/DIČ, zaplaceno kartou
    const { downloadFile } = await import("@/server/data");
    const x1 = String((await downloadFile(P, "pos.receipt", String(r.id), "isdoc", client)).data);
    expect(x1).toContain("<Name>Restaurace U Lípy s.r.o.</Name>");
    expect(x1).toContain("<CompanyID>CZ87654321</CompanyID>");
    expect(x1).toContain("<PaymentMeansCode>48</PaymentMeansCode>");
    expect(x1).toContain("<PayableAmount>0.00</PayableAmount>");
    expect(x1).toContain("<PaidAmount>12100.00</PaidAmount>");
    // malá účtenka bez odběratele dál souhrnně
    const r2 = await api((a) => sell(a, { registerId: regId, payment: "cash", lines: [{ itemId: ids.item, qty: "1" }] }));
    const x2 = String((await downloadFile(P, "pos.receipt", String(r2.id), "isdoc", client)).data);
    expect(x2).toContain("<Name>Konečný spotřebitel</Name>");
    expect(x2).toContain("<PaymentMeansCode>10</PaymentMeansCode>");
    expect(x2).toMatch(/<TaxSubTotal>[\s\S]*<Percent>21<\/Percent>/);
    const [shift] = (await listRecords(P, "pos.shift", { filter: { status: "open" } }, client)).rows;
    await runAction(P, "pos.shift", String(shift.id), "close", client);
    const closed = (await getRecord(P, "pos.shift", String(shift.id), client))!;
    const tt = (await listRecords(P, "tax.trans", { filter: { voucherId: String(closed.voucherId) } }, client)).rows;
    const own = tt.filter((t) => t.sourceObject === "pos.receipt");
    const agg = tt.filter((t) => t.sourceObject === "pos.shift");
    // 10 × 1 210 = 12 100 s DPH 21 % → základ 10 000, daň 2 100 jednotlivě; 1 210 souhrnně
    expect(own.map((t) => [t.khSection, t.vatId, t.base, t.tax, t.simplified])).toEqual([["A4", "CZ87654321", "10000.00", "2100.00", false]]);
    expect(agg.map((t) => [t.base, t.tax, t.simplified])).toEqual([["1000.00", "210.00", true]]);
    await saveRecord(P, "pos.shift", null, { registerId: regId, openingCash: "0" }, undefined, client);
  }, 120_000);

  it("prodej na fakturu: zaúčtovaná faktura s cenami s DPH a splatností, v saldu odběratele", async () => {
    await expect(api((a) => sellOnInvoice(a, { registerId: regId, payment: "invoice", lines: [{ itemId: ids.item, qty: "1" }] }))).rejects.toMatchObject({ label: "@POS:CustomerRequired" });
    const inv = await api((a) => sellOnInvoice(a, { registerId: regId, payment: "invoice", customerId: ids.cust, lines: [{ itemId: ids.item, qty: "2" }] }));
    expect([inv.status, inv.pricesInclTax, inv.amountGross, !!inv.dueDate]).toEqual(["posted", true, "2420.00", true]);
    const [tr] = (await listRecords(P, "ar.trans", { filter: { invoiceId: String(inv.id) } }, client)).rows;
    expect([tr.amount, tr.closed]).toEqual(["2420.00", false]);
    // účtenka nevznikla
    expect((await listRecords(P, "pos.receipt", { filter: { customerId: ids.cust } }, client)).total).toBe(1);
    ids.inv = String(inv.id);
  }, 120_000);

  it("odeslání účtenky a faktury e-mailem z pokladny (PDF v příloze, protokol pošty)", async () => {
    const [rc] = (await listRecords(P, "pos.receipt", { filter: { customerId: ids.cust } }, client)).rows;
    await sendDocumentNow(P, "pos.receipt", String(rc.id), "ucetni@lipa.test", client);
    await sendDocumentNow(P, "ar.invoice", ids.inv, "ucetni@lipa.test", client);
    const mails = (await listRecords(P, "int.mail", {}, client)).rows;
    expect(mails.map((m) => [m.sourceObject, m.status, m.mailTo]).sort()).toEqual([
      ["ar.invoice", "sent", "ucetni@lipa.test"],
      ["pos.receipt", "sent", "ucetni@lipa.test"],
    ]);
    expect((await getRecord(P, "ar.invoice", ids.inv, client))!.emailedAt).toBeTruthy();
  }, 120_000);
});
