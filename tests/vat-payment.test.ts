/**
 * Platba DPH: dodavatel Finanční úřad v Daňových parametrech, druh „Platba DPH“ → Spočítat → Zaúčtovat závazek
 * (zúčtování účtů DPH proti saldu FÚ, VS = DIČ, splatnost 25. den), tisk s QR platbou; Daň z příjmů zatím jen druh.
 */
import { describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { getRecord, listRecords, runAction, saveRecord } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { printJob } from "@/server/print";

const client = createPrisma();
const run = Date.now().toString(36);

describe("platba DPH", () => {
  it("závazek vůči FÚ z přiznání, položka salda s VS = DIČ, QR platba", async () => {
    const T = (await provisionTenant(client, { code: `t-vp-${run}`, name: "VP", adminEmail: `vp-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar", "ap", "bank", "prt"], company: { code: "V", name: "V" } })).ctx;
    await saveRecord(T, "sys.company", String(T.companyId), { ...(await getRecord(T, "sys.company", String(T.companyId), client))!, vatId: "CZ12345678" }, undefined, client);
    // prodej 10 000 + 21 %, nákup 2 000 + 21 % → povinnost 2 100 − 420 = 1 680 Kč
    const sale = await saveRecord(T, "ar.customer", null, { subjectId: (await saveRecord(T, "gab.subject", null, { name: "Odběratel" }, undefined, client)).id, groupId: (await listRecords(T, "ar.group", {}, client)).rows[0].id }, undefined, client);
    const inv = await saveRecord(T, "ar.invoice", null, { customerId: sale.id, invoiceDate: "2026-10-10" }, undefined, client);
    await saveRecord(T, "ar.invoiceLine", null, { invoiceId: inv.id, description: "Služby", qty: "1", unitPrice: "10000" }, undefined, client);
    await runAction(T, "ar.invoice", String(inv.id), "post", client);
    const apGroup = (await listRecords(T, "ap.group", {}, client)).rows[0];
    const sup = await saveRecord(T, "ap.vendor", null, { subjectId: (await saveRecord(T, "gab.subject", null, { name: "Dodavatel" }, undefined, client)).id, groupId: apGroup.id }, undefined, client);
    const pinv = await saveRecord(T, "ap.invoice", null, { vendorId: sup.id, externalNum: "D-1", invoiceDate: "2026-10-12" }, undefined, client);
    await saveRecord(T, "ap.invoiceLine", null, { invoiceId: pinv.id, description: "Materiál", qty: "1", unitPrice: "2000" }, undefined, client);
    await runAction(T, "ap.invoice", String(pinv.id), "post", client);

    // oddíl KH podle dokladu: přijatá 2 420 Kč → B.3, vydaná bez DIČ odběratele → A.5
    const sec = async (obj: string, id: unknown) => (await listRecords(T, "tax.trans", { filter: { voucherId: String((await getRecord(T, obj, String(id), client))!.voucherId) } }, client)).rows.map((t) => t.khSection);
    expect(await sec("ap.invoice", pinv.id)).toEqual(["B3"]);
    expect(await sec("ar.invoice", inv.id)).toEqual(["A5"]);

    // Finanční úřad jako dodavatel s účtem pro DPH
    const fuSubj = await saveRecord(T, "gab.subject", null, { name: "Finanční úřad pro hl. m. Prahu" }, undefined, client);
    await saveRecord(T, "gab.bankAccount", null, { subjectId: fuSubj.id, accountNum: "705-77628031/0710" }, undefined, client);
    const fu = await saveRecord(T, "ap.vendor", null, { subjectId: fuSubj.id, groupId: apGroup.id }, undefined, client);
    const ret = await saveRecord(T, "tax.return", null, { kind: "vatPayment", year: 2026, month: 10 }, undefined, client);
    await expect(runAction(T, "tax.return", String(ret.id), "postPayment", client)).rejects.toMatchObject({ label: "@TAX:NoTaxOfficeVendor" });
    await saveRecord(T, "tax.parameters", null, { taxOfficeCode: "451", subjectType: "P", filingPeriod: "month", taxOfficeVendorId: fu.id }, undefined, client);
    await runAction(T, "tax.return", String(ret.id), "calculate", client);
    // tisk už před zaúčtováním: částka z výpočtu, QR
    const pre = (await printJob(T, "tax.return", String(ret.id), null, client)).data as { doc: Record<string, unknown>; qr: string };
    expect([pre.doc.amount, pre.qr.includes("AM:1680.00")]).toEqual(["1680.00", true]);
    await runAction(T, "tax.return", String(ret.id), "postPayment", client);
    const r = (await getRecord(T, "tax.return", String(ret.id), client))!;
    expect([r.paymentAmount, r.dueDate, r.paymentVs]).toEqual(["1680.00", "2026-11-25", "12345678"]);
    // zúčtování: účet DPH (výstup − vstup) MD 1 680, závazek FÚ D 1 680
    const tr = (await listRecords(T, "gl.trans", { filter: { voucherId: String(r.voucherId) } }, client)).rows;
    expect(tr.map((t) => t.amount).sort()).toEqual(["-1680.00", "1680.00"]);
    const [open] = (await listRecords(T, "ap.trans", { filter: { vendorId: String(fu.id) } }, client)).rows;
    expect([open.amount, open.vs, open.closed, open.kind]).toEqual(["1680.00", "12345678", false, "invoice"]);
    // podruhé zaúčtovat nejde
    await expect(runAction(T, "tax.return", String(ret.id), "postPayment", client)).rejects.toBeTruthy();
    // tisk: částka, účet FÚ, QR platba
    const job = await printJob(T, "tax.return", String(ret.id), null, client);
    const d = job.data as { doc: Record<string, unknown>; partner: Record<string, unknown>; qr: string };
    expect([d.doc.amount, d.partner.bankAccount, d.qr.includes("AM:1680.00"), d.qr.includes("X-VS:12345678")]).toEqual(["1680.00", "705-77628031/0710", true, true]);
    // platební metoda QR
    expect((await listRecords(T, "bank.paymentMethod", { filter: { code: "QR" } }, client)).total).toBe(1);
    // daň z příjmů: druh existuje, výpočet zatím ne
    const it = await saveRecord(T, "tax.return", null, { kind: "incomeTax", year: 2026, month: 12 }, undefined, client);
    await expect(runAction(T, "tax.return", String(it.id), "calculate", client)).rejects.toMatchObject({ label: "@TAX:IncomeTaxSoon" });
  }, 180_000);
});
