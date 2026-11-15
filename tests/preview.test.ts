/**
 * Náhled před uložením (cena z položky, číslo deníku, číslo dokladu) nic nezapíše ani
 * nespotřebuje; výběr omezený jiným polem (název deníku podle druhu); hledání s hvězdičkou.
 */
import { describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { listRecords, previewRecord, refOptions, saveRecord } from "@/server/data";
import { provisionTenant } from "@/server/provision";

const client = createPrisma();
const run = Date.now().toString(36);

describe("náhled před uložením", () => {
  it("doplní hodnoty a předběžná čísla bez zápisu; lookup podle druhu a s hvězdičkou", async () => {
    const T = (await provisionTenant(client, { code: `t-pv-${run}`, name: "PV", adminEmail: `pv-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar", "ap", "inv", "bank", "cash"], company: { code: "P", name: "P" } })).ctx;
    const first = async (o: string, filter: Record<string, string> = {}) => (await listRecords(T, o, { filter, pageSize: 1 }, client)).rows[0];

    // nový deník: číslo deníku předběžně, řada se neposune
    const p1 = await previewRecord(T, "gl.journal", null, { journalType: "daily", description: "" }, client);
    const p2 = await previewRecord(T, "gl.journal", null, { journalType: "daily" }, client);
    expect(p1.journalNum).toBeTruthy();
    expect(p2.journalNum).toBe(p1.journalNum);
    expect(p1._provisional).toContain("journalNum");
    expect((await listRecords(T, "gl.journal", {}, client)).total).toBe(0);
    const j = await saveRecord(T, "gl.journal", null, { journalType: "daily", description: "Mzdy" }, undefined, client);
    expect(j.journalNum).toBe(p1.journalNum);

    // řádek deníku: číslo dokladu a datum předem, uložení dá stejné číslo
    const pl = await previewRecord(T, "gl.journalLine", null, { journalId: j.id }, client);
    expect([pl.date, pl._provisional]).toEqual([j.date, ["voucherNum"]]);
    const l1 = await saveRecord(T, "gl.journalLine", null, { journalId: j.id, accountId: (await first("gl.account", { accountNum: "521000" })).id, debit: "100" }, undefined, client);
    expect(l1.voucherNum).toBe(pl.voucherNum);
    // nevyrovnaný doklad: další řádek má stejné číslo (není předběžné)
    const pl2 = await previewRecord(T, "gl.journalLine", null, { journalId: j.id }, client);
    expect([pl2.voucherNum, pl2._provisional]).toEqual([l1.voucherNum, []]);

    // řádek faktury: cena, jednotka a DPH z položky ještě před uložením
    const grp = await first("inv.itemGroup");
    const unit = await first("inv.unit", { code: "KG" });
    const item = await saveRecord(T, "inv.item", null, { itemNum: "SUN", name: "Šunka", groupId: grp.id, unitId: unit.id, salesPrice: "289" }, undefined, client);
    const subj = await saveRecord(T, "gab.subject", null, { name: "Restaurace U Lípy" }, undefined, client);
    const cust = await saveRecord(T, "ar.customer", null, { subjectId: subj.id, groupId: (await first("ar.group")).id }, undefined, client);
    const inv = await saveRecord(T, "ar.invoice", null, { customerId: cust.id }, undefined, client);
    const pv = await previewRecord(T, "ar.invoiceLine", null, { invoiceId: inv.id, itemId: item.id, qty: "2" }, client);
    expect([pv.unitPrice, pv.unitId, pv.description, !!pv.taxCodeId, !!pv.revenueAccountId]).toEqual(["289.00", unit.id, "Šunka", true, true]);
    expect((pv._titles as Record<string, string>).unitId).toMatch(/KG/);
    expect((await listRecords(T, "ar.invoiceLine", {}, client)).total).toBe(0);

    // výběr názvu deníku podle druhu: obecný nenabízí banku ani pokladnu
    const all = (await refOptions(T, "gl.journalName", "", client)).map((o) => o.title);
    const daily = (await refOptions(T, "gl.journalName", "", client, { journalType: "daily" })).map((o) => o.title);
    expect(all).toEqual(expect.arrayContaining(["GEN", "BANKA", "POKL"]));
    expect(daily).toEqual(["GEN"]);

    // odběratel: v nabídce jméno, hledání jménem i číslem s hvězdičkou
    const byName = await refOptions(T, "ar.customer", "lípy", client);
    expect([byName.length, byName[0].nameOnly, byName[0].subtitle]).toEqual([1, true, "Restaurace U Lípy"]);
    const num = String(cust.accountNum);
    expect((await refOptions(T, "ar.customer", `*${num.slice(-3)}`, client)).map((o) => o.id)).toEqual([cust.id]);
    expect((await refOptions(T, "ar.customer", "*neni*", client)).length).toBe(0);
  }, 120_000);
});
