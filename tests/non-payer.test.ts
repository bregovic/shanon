/**
 * Neplátce DPH: výchozí nastavení jen s kódy BEZ / P0 (skupiny položek, odběratelů, dodavatelů a doprava na ně),
 * účtenka „Účtenka“ bez rekapitulace DPH, faktura „Faktura“; jednotka Neurčeno ve výchozích jednotkách.
 */
import { describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { inTenant, listRecords, saveRecord } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { receiptPrint, sell } from "@/modules/pos/sale";
import { receiptData } from "@/lib/receipt-data";
import { printJob } from "@/server/print";

const client = createPrisma();
const run = Date.now().toString(36);

describe("neplátce DPH", () => {
  it("výchozí nastavení bez sazeb DPH, tisk bez daňového dokladu", async () => {
    const r = await provisionTenant(client, { code: `t-np-${run}`, name: "Np", adminEmail: `np-${run}@test.local`, adminPassword: "heslo-12345", modules: ["pos", "ar", "ap", "shop"], company: { code: "N", name: "Neplátce", vatPayer: false } });
    const T = r.ctx;
    const codes = (await listRecords(T, "tax.taxCode", {}, client)).rows.map((c) => c.code).sort();
    expect(codes).toEqual(["BEZ", "P0"]);
    const byId = new Map((await listRecords(T, "tax.taxCode", {}, client)).rows.map((c) => [c.id, c.code]));
    const groups = (await listRecords(T, "inv.itemGroup", {}, client)).rows;
    expect(groups.map((g) => `${g.code}:${byId.get(g.taxCodeId)}/${byId.get(g.purchaseTaxCodeId)}`).sort()).toEqual(["SLUZBY:BEZ/P0", "ZBOZI:BEZ/P0"]);
    const [arg] = (await listRecords(T, "ar.group", {}, client)).rows;
    const [apg] = (await listRecords(T, "ap.group", {}, client)).rows;
    expect([byId.get(arg.taxCodeId), byId.get(apg.taxCodeId)]).toEqual(["BEZ", "P0"]);
    const deliveries = (await listRecords(T, "shop.delivery", {}, client)).rows;
    expect(deliveries.every((d) => byId.get(d.taxCodeId) === "BEZ")).toBe(true);
    expect((await listRecords(T, "inv.unit", { filter: { code: "NEURC" } }, client)).rows[0]?.name).toBe("neurčeno");

    // účtenka bez daňového dokladu
    const regId = String((await listRecords(T, "pos.register", {}, client)).rows[0].id);
    const ks = (await listRecords(T, "inv.unit", { filter: { code: "KS" } }, client)).rows[0];
    const item = await saveRecord(T, "inv.item", null, { itemNum: "V1", name: "Výkon", groupId: groups.find((g) => g.code === "SLUZBY")!.id, unitId: ks.id, salesPrice: "400", priceInclTax: true }, undefined, client);
    await saveRecord(T, "pos.shift", null, { registerId: regId, openingCash: "0" }, undefined, client);
    const rc = await inTenant(T, (s) => sell(s.sys().api(), { registerId: regId, payment: "cash", lines: [{ itemId: String(item.id), qty: "1" }] }), client);
    const pr = await inTenant(T, (s) => receiptPrint(s.sys().api(), T.companyId, String(rc.id)), client);
    expect([pr.vatPayer, pr.gross]).toEqual([false, "400.00"]);
    const d = receiptData(pr);
    expect([d.doc.title, d.doc.vatPayer, d.doc.nonPayerNote]).toEqual(["Účtenka", "", "Nejsme plátci DPH."]);

    // faktura bez „daňový doklad“
    const subj = await saveRecord(T, "gab.subject", null, { name: "Pacient" }, undefined, client);
    const c = await saveRecord(T, "ar.customer", null, { subjectId: subj.id, groupId: arg.id }, undefined, client);
    const inv = await saveRecord(T, "ar.invoice", null, { customerId: c.id }, undefined, client);
    await saveRecord(T, "ar.invoiceLine", null, { invoiceId: inv.id, description: "Výkon", qty: "1", unitPrice: "400" }, undefined, client);
    const job = await printJob(T, "ar.invoice", String(inv.id), null, client);
    expect((job.data as { doc: { title: string } }).doc.title).toBe("FAKTURA");
  }, 180_000);
});
