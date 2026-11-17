/** Sloučit položky: odkazy se přepojí, ostatní se smažou, název bez „(dodavatel)“, vyšší cena, různý dodavatel → bez dodavatele. */
import { describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { getRecord, inTenant, listRecords, saveRecord } from "@/server/data";
import { mergeRecords } from "@/server/merge";
import { provisionTenant } from "@/server/provision";

const client = createPrisma();
const run = Date.now().toString(36);

describe("sloučit záznamy", () => {
  it("položky stejného výrobku od dvou dodavatelů", async () => {
    const T = (await provisionTenant(client, { code: `t-mg-${run}`, name: "Mg", adminEmail: `mg-${run}@test.local`, adminPassword: "heslo-12345", modules: ["inv", "ap"], company: { code: "C", name: "C" } })).ctx;
    const g = (await listRecords(T, "inv.itemGroup", { pageSize: 1 }, client)).rows[0];
    const kg = (await listRecords(T, "inv.unit", { filter: { code: "KG" } }, client)).rows[0];
    const ks = (await listRecords(T, "inv.unit", { filter: { code: "KS" } }, client)).rows[0];
    const vg = (await listRecords(T, "ap.group", { pageSize: 1 }, client)).rows[0];
    const vendor = async (name: string, regNo: string) => {
      const subj = await saveRecord(T, "gab.subject", null, { name }, undefined, client);
      return (await saveRecord(T, "ap.vendor", null, { subjectId: subj.id, groupId: vg.id, regNo }, undefined, client)).id;
    };
    const v1 = await vendor("JMS", "11111111");
    const v2 = await vendor("Kratochvíl", "22222222");
    const base = { groupId: g.id, unitId: kg.id, weighed: true, priceInclTax: true };
    const a = await saveRecord(T, "inv.item", null, { ...base, itemNum: "UZ065", name: "Slanina bez kůže (JMS)", salesPrice: "179", purchasePrice: "87", vendorId: v1 }, undefined, client);
    const b = await saveRecord(T, "inv.item", null, { ...base, itemNum: "UZ077", name: "Slanina bez kůže (Kratochvíl)", salesPrice: "199", purchasePrice: "109", vendorId: v2, eshop: true }, undefined, client);
    const disc = await saveRecord(T, "inv.discount", null, { code: "AKCE", name: "Akce", kind: "percent", itemId: b.id, percent: "10" }, undefined, client);

    const kept = await inTenant(T, (s) => mergeRecords(s, "inv.item", [String(b.id), String(a.id)]), client);
    expect([kept.id, kept.name, Number(kept.salesPrice), kept.vendorId, kept.eshop, Number(kept.purchasePrice)]).toEqual([a.id, "Slanina bez kůže", 199, null, true, 87]);
    expect(await getRecord(T, "inv.item", String(b.id), client)).toBeNull();
    expect((await getRecord(T, "inv.discount", String(disc.id), client))!.itemId).toBe(a.id);

    // jiná jednotka → odmítnout, nic se nezmění
    const c = await saveRecord(T, "inv.item", null, { ...base, unitId: ks.id, itemNum: "UZ200", name: "Slanina bez kůže (Skaličan)", salesPrice: "179" }, undefined, client);
    await expect(inTenant(T, (s) => mergeRecords(s, "inv.item", [String(a.id), String(c.id)]), client)).rejects.toThrow();
    expect(await getRecord(T, "inv.item", String(c.id), client)).not.toBeNull();
    // jeden záznam / objekt bez sloučení
    await expect(inTenant(T, (s) => mergeRecords(s, "inv.item", [String(a.id)]), client)).rejects.toThrow();
    await expect(inTenant(T, (s) => mergeRecords(s, "inv.unit", [String(kg.id), String(ks.id)]), client)).rejects.toThrow();
  }, 120_000);

  it("filtr odkazu podle kódu i názvu (kategorie, dodavatel podle názvu subjektu)", async () => {
    const T = (await provisionTenant(client, { code: `t-rf-${run}`, name: "Rf", adminEmail: `rf-${run}@test.local`, adminPassword: "heslo-12345", modules: ["inv", "ap"], company: { code: "C", name: "C" } })).ctx;
    const g = (await listRecords(T, "inv.itemGroup", { pageSize: 1 }, client)).rows[0];
    const ks = (await listRecords(T, "inv.unit", { filter: { code: "KS" } }, client)).rows[0];
    const vg = (await listRecords(T, "ap.group", { pageSize: 1 }, client)).rows[0];
    const subj = await saveRecord(T, "gab.subject", null, { name: "Masna Novák" }, undefined, client);
    const ven = await saveRecord(T, "ap.vendor", null, { subjectId: subj.id, groupId: vg.id, regNo: "33333333" }, undefined, client);
    const cat = await saveRecord(T, "inv.category", null, { code: "UZ", name: "Uzeniny" }, undefined, client);
    await saveRecord(T, "inv.item", null, { itemNum: "P1", name: "S kategorií", groupId: g.id, unitId: ks.id, categoryId: cat.id, vendorId: ven.id }, undefined, client);
    await saveRecord(T, "inv.item", null, { itemNum: "P2", name: "Bez", groupId: g.id, unitId: ks.id }, undefined, client);
    const nums = async (filters: Record<string, string>) => (await listRecords(T, "inv.item", { filters, sort: "itemNum" }, client)).rows.map((r) => r.itemNum);
    expect(await nums({ categoryId: "UZ" })).toEqual(["P1"]);
    expect(await nums({ categoryId: "uzen*" })).toEqual(["P1"]);
    expect(await nums({ vendorId: "*novák*" })).toEqual(["P1"]);
    expect(await nums({ vendorId: String((await getRecord(T, "ap.vendor", String(ven.id), client))!.accountNum ?? "x") })).toEqual(["P1"]);
    expect(await nums({ categoryId: '""' })).toEqual(["P2"]);
  }, 120_000);
});
