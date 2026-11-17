/** Šablona CSV s daty: export záznamů v tvaru pro import, úprava a import zpět aktualizuje záznamy. */
import { describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { getObject, getRecord, listRecords, saveRecord } from "@/server/data";
import { importRecords, importTemplate, readTable } from "@/server/import";
import { provisionTenant } from "@/server/provision";

const client = createPrisma();
const run = Date.now().toString(36);

describe("šablona s daty", () => {
  it("položky: odkazy, výčty, ano/ne, částky — beze změny projde, upravená cena se naimportuje", async () => {
    const T = (await provisionTenant(client, { code: `t-tpl-${run}`, name: "Tpl", adminEmail: `tpl-${run}@test.local`, adminPassword: "heslo-12345", modules: ["inv"], company: { code: "C", name: "C" } })).ctx;
    const g = (await listRecords(T, "inv.itemGroup", { pageSize: 1 }, client)).rows[0];
    const ks = (await listRecords(T, "inv.unit", { filter: { code: "KS" } }, client)).rows[0];
    const cat = await saveRecord(T, "inv.category", null, { code: "UZ", name: "Uzeniny; maso" }, undefined, client);
    const a = await saveRecord(T, "inv.item", null, { itemNum: "A1", name: 'Klobása "domácí"', groupId: g.id, unitId: ks.id, categoryId: cat.id, salesPrice: "123.5", weighed: true, description: "řádek 1\nřádek 2" }, undefined, client);
    await saveRecord(T, "inv.item", null, { itemNum: "A2", name: "Párek", groupId: g.id, unitId: ks.id, salesPrice: "20" }, undefined, client);

    const rows = (await listRecords(T, "inv.item", { pageSize: 100, sort: "itemNum" }, client)).rows;
    const csv = importTemplate(getObject("inv.item"), "cs", [], rows);
    // beze změny: vše se přiřadí a nic se nezmění
    const same = await importRecords(T, "inv.item", await readTable("p.csv", Buffer.from(csv)), { dryRun: false, lang: "cs" }, client);
    expect([same.errors, same.created]).toEqual([[], 0]);
    expect(same.columns.filter((c) => c.status === "ignored")).toEqual([]);
    const a1 = (await getRecord(T, "inv.item", String(a.id), client))!;
    expect([a1.name, a1.categoryId, a1.groupId, Number(a1.salesPrice), a1.weighed, a1.description]).toEqual(['Klobása "domácí"', cat.id, g.id, 123.5, true, "řádek 1\nřádek 2"]);
    // úprava ceny v souboru → import zpět
    const edited = csv.replace(/123,50*/, "130");
    expect(edited).not.toBe(csv);
    const r = await importRecords(T, "inv.item", await readTable("p.csv", Buffer.from(edited)), { dryRun: false, lang: "cs" }, client);
    expect([r.errors, r.created]).toEqual([[], 0]);
    expect(Number((await getRecord(T, "inv.item", String(a.id), client))!.salesPrice)).toBe(130);
  }, 120_000);
});
