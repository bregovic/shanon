/** Položka s cenou v EUR: faktura v CZK i v EUR, pokladna v účetní měně. */
import { describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { inTenant, listRecords, saveRecord } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { quote } from "@/modules/pos/sale";

const client = createPrisma();
const run = Date.now().toString(36);
const today = new Date().toISOString().slice(0, 10);

describe("měna ceny na položce", () => {
  it("EUR položka: řádek faktury v CZK přepočtený kurzem, v EUR beze změny, kasa v CZK", async () => {
    const T = (await provisionTenant(client, { code: `t-cur-${run}`, name: "CUR", adminEmail: `cur-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar", "inv", "pos"], company: { code: "C", name: "C" } })).ctx;
    const eur = (await listRecords(T, "sys.currency", { filters: { code: "EUR" } }, client)).rows[0];
    await saveRecord(T, "sys.exchangeRate", null, { currencyId: eur.id, date: today, amount: 1, rate: "25", base: "CZK", source: "manual" }, undefined, client);
    const [grp] = (await listRecords(T, "inv.itemGroup", {}, client)).rows;
    const [unit] = (await listRecords(T, "inv.unit", {}, client)).rows;
    const [tc] = (await listRecords(T, "tax.taxCode", { filters: { code: "V21" } }, client)).rows;
    const item = await saveRecord(T, "inv.item", null, { itemNum: "E1", name: "Dovozová šunka", groupId: grp.id, unitId: unit.id, salesPrice: "10", currencyId: eur.id, taxCodeId: tc.id }, undefined, client);
    expect([item.priceNet, item.priceGross]).toEqual(["10.00", "12.10"]);

    const subj = await saveRecord(T, "gab.subject", null, { name: "Odběratel" }, undefined, client);
    const [cg] = (await listRecords(T, "ar.group", {}, client)).rows;
    const cust = await saveRecord(T, "ar.customer", null, { subjectId: subj.id, groupId: cg.id }, undefined, client);
    // faktura v CZK: 10 EUR × 25 = 250 Kč
    const invCzk = await saveRecord(T, "ar.invoice", null, { customerId: cust.id, invoiceDate: today }, undefined, client);
    const l1 = await saveRecord(T, "ar.invoiceLine", null, { invoiceId: invCzk.id, itemId: item.id, qty: "2" }, undefined, client);
    expect([l1.unitPrice, l1.amountNet]).toEqual(["250.00", "500.00"]);
    // faktura v EUR: cena zůstane 10 EUR
    const invEur = await saveRecord(T, "ar.invoice", null, { customerId: cust.id, invoiceDate: today, currencyId: eur.id }, undefined, client);
    const l2 = await saveRecord(T, "ar.invoiceLine", null, { invoiceId: invEur.id, itemId: item.id, qty: "1" }, undefined, client);
    expect(l2.unitPrice).toBe("10.00");
    // CZK položka na EUR faktuře: 500 Kč / 25 = 20 EUR
    const czkItem = await saveRecord(T, "inv.item", null, { itemNum: "C1", name: "Klobása", groupId: grp.id, unitId: unit.id, salesPrice: "500", taxCodeId: tc.id }, undefined, client);
    const l3 = await saveRecord(T, "ar.invoiceLine", null, { invoiceId: invEur.id, itemId: czkItem.id, qty: "1" }, undefined, client);
    expect(l3.unitPrice).toBe("20.00");

    // pokladna účtuje v CZK: 12,10 EUR × 25 = 302,50 Kč
    const [reg] = (await listRecords(T, "pos.register", {}, client)).rows;
    await saveRecord(T, "pos.shift", null, { registerId: reg.id, openingCash: "0" }, undefined, client);
    const q = await inTenant(T, (s) => quote(s.sys().api(), { registerId: String(reg.id), lines: [{ itemId: String(item.id), qty: "1" }], payment: "card" }), client);
    expect(JSON.stringify(q, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).toMatch(/"unitPrice":"302.50"|30250/);
  });
});
