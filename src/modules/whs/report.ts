/** Dostupnost zásob: zásoba, rezervace a dostupné množství po položkách a skladech. */
import type { RecordData } from "@/core/module";
import { defineReport } from "@/core/report";

export const availability = defineReport({
  id: "availability",
  label: "@WHS:Availability",
  description: "@WHS:AvailabilityDesc",
  requires: ["whs.onhand", "whs.reservation", "inv.item"],
  params: [{ name: "warehouseId", label: "@WHS:Warehouse", kind: "ref", refObject: "whs.warehouse" }],
  async run(data, params) {
    const where = params.warehouseId ? { warehouseId: params.warehouseId } : {};
    const rows = new Map<string, { itemId: string; warehouseId: string; onhand: number; reserved: number }>();
    const key = (r: RecordData) => `${r.itemId}|${r.warehouseId}`;
    const get = (r: RecordData) => {
      const k = key(r);
      if (!rows.has(k)) rows.set(k, { itemId: String(r.itemId), warehouseId: String(r.warehouseId), onhand: 0, reserved: 0 });
      return rows.get(k)!;
    };
    for (const r of await data.find("whs.onhand", where, { take: 50000 })) get(r).onhand += Number(r.qty ?? 0);
    for (const r of await data.find("whs.reservation", where, { take: 50000 })) get(r).reserved += Number(r.qty ?? 0);
    const items = new Map((await data.find("inv.item", {}, { take: 50000 })).map((i) => [String(i.id), i]));
    const whs = new Map((await data.find("whs.warehouse", {}, { take: 1000 })).map((w) => [String(w.id), w]));
    const out = [...rows.values()]
      .map((r) => {
        const it = items.get(r.itemId);
        return {
          item: it ? `${it.itemNum} · ${it.name}` : r.itemId,
          warehouse: String(whs.get(r.warehouseId)?.code ?? ""),
          onhand: r.onhand.toFixed(2),
          reserved: r.reserved.toFixed(2),
          available: (r.onhand - r.reserved).toFixed(2),
        };
      })
      .sort((a, b) => a.item.localeCompare(b.item) || a.warehouse.localeCompare(b.warehouse));
    return {
      columns: [
        { name: "item", label: "@WHS:ItemName", kind: "string" },
        { name: "warehouse", label: "@WHS:Warehouse", kind: "string" },
        { name: "onhand", label: "@WHS:Onhand", kind: "amount" },
        { name: "reserved", label: "@WHS:Reserved", kind: "amount" },
        { name: "available", label: "@WHS:Available", kind: "amount" },
      ],
      rows: out,
    };
  },
});
