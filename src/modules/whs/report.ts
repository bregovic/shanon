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

/** Ocenění zásob: množství, průměrná cena, hodnota; porovnání s účtem zboží na skladě. */
export const valuationReport = defineReport({
  id: "valuation",
  label: "@WHS:ValuationReport",
  description: "@WHS:ValuationDesc",
  requires: ["whs.itemCost", "inv.item"],
  params: [],
  async run(data, _params, ctx) {
    const items = new Map((await data.find("inv.item", {}, { take: 50000 })).map((i) => [String(i.id), i]));
    const rows = (await data.find("whs.itemCost", {}, { take: 50000 }))
      .filter((r) => Number(r.qty) !== 0 || Number(r.value) !== 0)
      .map((r) => {
        const it = items.get(String(r.itemId));
        return { item: it ? `${it.itemNum} · ${it.name}` : String(r.itemId), qty: Number(r.qty ?? 0).toFixed(2), avgCost: String(r.avgCost ?? ""), value: String(r.value ?? "0.00") };
      })
      .sort((a, b) => a.item.localeCompare(b.item));
    const total = rows.reduce((s, r) => s + Math.round(Number(r.value) * 100), 0);
    // zůstatek účtu skladu (132) pro kontrolu
    const [p] = await data.find("whs.parameters", {}, { take: 1 });
    let ledger = 0;
    if (p?.stockAccountId) for (const t of await data.find("gl.trans", { accountId: p.stockAccountId }, { take: 100000 })) ledger += Math.round(Number(t.amount) * 100);
    const out: Record<string, unknown>[] = [...rows];
    out.push({ item: ctx.t("@WHS:TotalValue"), qty: "", avgCost: "", value: (total / 100).toFixed(2), _level: 1 });
    out.push({ item: ctx.t("@WHS:LedgerBalance"), qty: "", avgCost: "", value: (ledger / 100).toFixed(2), _level: 1 });
    out.push({ item: ctx.t("@WHS:Difference"), qty: "", avgCost: "", value: ((total - ledger) / 100).toFixed(2), _level: 1 });
    return {
      columns: [
        { name: "item", label: "@WHS:ItemName", kind: "string" },
        { name: "qty", label: "@WHS:Qty", kind: "amount" },
        { name: "avgCost", label: "@WHS:AvgCost", kind: "amount" },
        { name: "value", label: "@WHS:Value", kind: "amount" },
      ],
      rows: out,
    };
  },
});
