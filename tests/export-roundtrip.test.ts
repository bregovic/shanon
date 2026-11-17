/** Export seznamu do Excelu → úprava → import zpět: záznamy se jen aktualizují, nic nezmizí. */
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { createPrisma } from "@/server/db";
import { getObject, listRecords, saveRecord } from "@/server/data";
import { cellValue, importRecords, readTable } from "@/server/import";
import { provisionTenant } from "@/server/provision";
import { fieldsMeta, hiddenFields } from "@/server/ui";
import { getT } from "@/server/i18n";
import { displayValue } from "@/lib/meta";

const client = createPrisma();
const run = Date.now().toString(36);

describe("export do Excelu a import zpět", () => {
  it("položky: změna V e-shopu na ano, zaškrtnutí „✓“ z exportu", async () => {
    const T = (await provisionTenant(client, { code: `t-xr-${run}`, name: "Xr", adminEmail: `xr-${run}@test.local`, adminPassword: "heslo-12345", modules: ["inv", "shop"], company: { code: "C", name: "C" } })).ctx;
    const g = (await listRecords(T, "inv.itemGroup", { pageSize: 1 }, client)).rows[0];
    const ks = (await listRecords(T, "inv.unit", { filter: { code: "KS" } }, client)).rows[0];
    const cat = await saveRecord(T, "inv.category", null, { code: "UZ", name: "Uzeniny" }, undefined, client);
    for (const [n, w] of [["A1", true], ["A2", false]] as const)
      await saveRecord(T, "inv.item", null, { itemNum: n, name: `Pol ${n}`, groupId: g.id, unitId: ks.id, categoryId: cat.id, salesPrice: "100", purchasePrice: "60", weighed: w, brand: "Značka", vendorId: null }, undefined, client);
    const before = (await listRecords(T, "inv.item", { pageSize: 100 }, client)).rows;

    // export jako v /api/export
    const def = getObject("inv.item");
    const t = await getT("cs", T.tenantId);
    const meta = fieldsMeta(T, def, t);
    const columns = def.list.filter((f) => !hiddenFields(T, def).includes(f)).map((f) => meta[f]);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("x");
    ws.columns = columns.map((c) => ({ header: c.label, key: c.name }));
    for (const r of before) {
      const values: Record<string, unknown> = {};
      for (const c of columns) {
        const v = r[c.name];
        if (v === null || v === undefined || v === "") values[c.name] = null;
        else if (c.kind === "decimal" || c.kind === "int") values[c.name] = Number(v);
        else values[c.name] = displayValue(c, r, "cs");
      }
      ws.addRow(values);
    }
    // uživatel: V e-shopu = ano
    const col = columns.findIndex((c) => c.name === "eshop") + 1;
    for (let i = 2; i <= before.length + 1; i++) ws.getRow(i).getCell(col).value = "ano";
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const table = await readTable("polozky.xlsx", buf);
    const r = await importRecords(T, "inv.item", table, { dryRun: false, lang: "cs" }, client);
    expect([r.errors, r.applied, r.created, r.updated]).toEqual([[], true, 0, 2]);
    const after = (await listRecords(T, "inv.item", { pageSize: 100 }, client)).rows;
    // nic nezmizí, V e-shopu = ano, ostatní (váha „✓“, kategorie, cena) beze změny
    expect(after.map((x) => [x.itemNum, x.eshop, x.weighed, x.categoryId === cat.id, Number(x.salesPrice)])).toEqual([
      ["A1", true, true, true, 100],
      ["A2", true, false, true, 100],
    ]);
  }, 120_000);

  it("výčet: kód, popisek i jeho část bez diakritiky („Zboží / výrobek“ ← ZBOZI, Zboží, výrobek)", () => {
    const f = getObject("inv.item").fields.itemType;
    for (const v of ["item", "ZBOZI", "Zboží", "výrobek", "Zboží / výrobek", "Služba"]) expect(cellValue(f, v, "cs")[0]).toBe(v === "Služba" ? "service" : "item");
    expect(cellValue(f, "nesmysl", "cs")[1]).toBe("@SYS:InvalidValue");
  });
});
