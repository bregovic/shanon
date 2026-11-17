/**
 * Vychystávání objednávek e-shopu (zboží na váhu): přehled podle dne vyzvednutí, souhrn stejných položek napříč
 * objednávkami (příprava, krájení), zadání skutečného množství (váha / ručně) nebo Chybí, a Dokončit = řádky objednávky
 * podle skutečnosti → vydaná faktura (zaúčtovaná, s uhrazenou zálohou) → Připraveno k vyzvednutí.
 */
import { UserError, type DataApi, type RecordData } from "@/core/module";
import { ar } from "@/modules/ar";
import { postInvoice } from "@/modules/tax/document";
import { notify } from "@/modules/sys/notify";

/** Stavy objednávky, které čekají na vychystání. */
export const OPEN_PICK = ["paid", "toPick", "picking"];

export interface PickRow {
  id: string;
  shopOrderId: string;
  orderNum: string;
  itemId: string | null;
  name: string;
  unit: string;
  weighed: boolean;
  orderedQty: string;
  maxQty: string;
  pickedQty: string | null;
  status: string;
}
export interface PickOrder {
  id: string;
  orderNum: string;
  status: string;
  buyerName: string;
  phone: string;
  note: string;
  pickupDate: string | null;
  pickupHour: number | null;
  pickupAsap: boolean;
  payment: string;
  estimated: boolean;
  picks: PickRow[];
}
export interface PickItem {
  key: string;
  name: string;
  unit: string;
  weighed: boolean;
  ordered: string;
  picked: string;
  rows: PickRow[];
}
export interface PickBoard {
  date: string | null;
  /** dny s otevřenými objednávkami (null = bez termínu) a jejich počet */
  days: { date: string | null; count: number }[];
  orders: PickOrder[];
  items: PickItem[];
}

const qtyStr = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(Number(v)));
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Přehled pro den vyzvednutí (`null` = nejbližší den s objednávkami). */
export async function pickBoard(data: DataApi, date: string | null): Promise<PickBoard> {
  const open = await data.find("shop.order", { status: { in: OPEN_PICK } }, { take: 1000, orderBy: { orderedAt: "asc" } });
  const dayOf = (o: RecordData) => (o.pickupDate ? String(o.pickupDate).slice(0, 10) : null);
  const counts = new Map<string | null, number>();
  for (const o of open) counts.set(dayOf(o), (counts.get(dayOf(o)) ?? 0) + 1);
  const days = [...counts.entries()].map(([d, count]) => ({ date: d, count })).sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
  const sel = date && counts.has(date) ? date : date === "none" ? null : (days[0]?.date ?? null);
  const orders: PickOrder[] = [];
  const pms = new Map<string, string>();
  // co nejdřív první, pak podle hodiny, bez hodiny na konec
  for (const o of open.filter((x) => dayOf(x) === sel).sort((a, b) => Number(!a.pickupAsap) - Number(!b.pickupAsap) || Number(a.pickupHour ?? 99) - Number(b.pickupHour ?? 99))) {
    const pmId = String(o.paymentMethodId ?? "");
    if (pmId && !pms.has(pmId)) pms.set(pmId, String((await data.get("bank.paymentMethod", pmId))?.name ?? ""));
    const picks = await data.find("shop.pick", { shopOrderId: o.id }, { take: 200, orderBy: { createdAt: "asc" } });
    orders.push({
      id: String(o.id),
      orderNum: String(o.orderNum),
      status: String(o.status),
      buyerName: String(o.buyerName ?? ""),
      phone: String(o.phone ?? ""),
      note: String(o.note ?? ""),
      pickupDate: dayOf(o),
      pickupHour: o.pickupHour === null || o.pickupHour === undefined ? null : Number(o.pickupHour),
      pickupAsap: !!o.pickupAsap,
      payment: pms.get(pmId) ?? "",
      estimated: !!o.estimated,
      picks: picks.map((p) => ({
        id: String(p.id),
        shopOrderId: String(o.id),
        orderNum: String(o.orderNum),
        itemId: (p.itemId as string) ?? null,
        name: String(p.name ?? ""),
        unit: String(p.unit ?? ""),
        weighed: !!p.weighed,
        orderedQty: qtyStr(p.orderedQty) ?? "0",
        maxQty: qtyStr(p.maxQty) ?? "0",
        pickedQty: qtyStr(p.pickedQty),
        status: String(p.status),
      })),
    });
  }
  // souhrn stejných položek napříč objednávkami dne (příprava najednou)
  const byItem = new Map<string, PickItem>();
  for (const r of orders.flatMap((o) => o.picks)) {
    const key = r.itemId ?? `n:${r.name}`;
    const it = byItem.get(key) ?? { key, name: r.name, unit: r.unit, weighed: r.weighed, ordered: "0", picked: "0", rows: [] };
    it.ordered = String(round3(Number(it.ordered) + Number(r.orderedQty)));
    if (r.status === "picked") it.picked = String(round3(Number(it.picked) + Number(r.pickedQty ?? 0)));
    it.rows.push(r);
    byItem.set(key, it);
  }
  const items = [...byItem.values()].sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name, "cs"));
  return { date: sel, days, orders, items };
}

async function openOrder(data: DataApi, shopOrderId: string): Promise<RecordData> {
  const so = await data.get("shop.order", shopOrderId);
  if (!so) throw new UserError("@SYS:NotFound");
  if (!OPEN_PICK.includes(String(so.status))) throw new UserError("@GL:Locked");
  return so;
}

/** Skutečné množství řádku (zvážené / spočítané), nebo Chybí. Překročení rezervy jen varuje. */
export async function setPick(data: DataApi, pickId: string, qty: string | null, missing: boolean): Promise<void> {
  const p = await data.get("shop.pick", pickId);
  if (!p) throw new UserError("@SYS:NotFound");
  const so = await openOrder(data, String(p.shopOrderId));
  if (missing) {
    await data.update("shop.pick", pickId, { status: "missing", pickedQty: "0", pickedAt: new Date().toISOString() });
  } else if (qty === null || qty.trim() === "") {
    await data.update("shop.pick", pickId, { status: "pending", pickedQty: null, pickedAt: null });
  } else {
    const n = Number(qty.replace(",", ".").trim());
    if (!Number.isFinite(n) || n <= 0) throw new UserError("@SYS:InvalidValue");
    const v = p.weighed ? round3(n) : Math.round(n);
    if (v > Number(p.maxQty ?? v) + 1e-9) data.warn?.("@SHOP:PickTooMuch", { max: `${Number(p.maxQty).toLocaleString("cs-CZ", { maximumFractionDigits: 3 })} ${p.unit ?? ""}`.trim() });
    await data.update("shop.pick", pickId, { status: "picked", pickedQty: String(v), pickedAt: new Date().toISOString() });
  }
  if (so.status !== "picking") await data.update("shop.order", String(so.id), { status: "picking" });
}

/**
 * Dokončit: řádky objednávky podle skutečnosti (chybějící pryč), vydaná faktura se zálohou (uhrazená převodem
 * předem), zaúčtovat, objednávka Připraveno k vyzvednutí. Vrací id faktury.
 */
export async function completePick(data: DataApi, shopOrderId: string): Promise<string> {
  const so = await openOrder(data, shopOrderId);
  const picks = await data.find("shop.pick", { shopOrderId }, { take: 200 });
  if (picks.some((p) => p.status === "pending")) throw new UserError("@SHOP:PickNotDone");
  const order = so.arOrderId ? await data.get("ar.order", String(so.arOrderId)) : null;
  if (!order || order.status === "invoiced" || order.status === "cancelled") throw new UserError("@GL:Locked");
  for (const p of picks) {
    if (!p.orderLineId) continue;
    if (p.status === "missing") {
      await data.update("shop.pick", String(p.id), { orderLineId: null });
      await data.remove("ar.orderLine", String(p.orderLineId));
    }
    else if (String(Number(p.pickedQty)) !== String(Number(p.orderedQty))) await data.update("ar.orderLine", String(p.orderLineId), { qty: String(p.pickedQty) });
  }
  const lines = await data.find("ar.orderLine", { orderId: order.id }, { take: 500, orderBy: { createdAt: "asc" } });
  if (!lines.some((l) => l.itemId)) throw new UserError("@GL:NoLines");
  const [adv] = await data.find("ar.advance", { orderId: order.id, status: "paid" }, { take: 1 });
  const inv = await data.create("ar.invoice", {
    customerId: order.customerId,
    currencyId: order.currencyId ?? null,
    taxGroupId: order.taxGroupId ?? null,
    pricesInclTax: !!order.pricesInclTax,
    description: order.description ?? null,
    orderId: order.id,
    advanceId: adv?.id ?? null,
  });
  const FIELDS = ["itemId", "description", "qty", "unitId", "unitPrice", "taxGroupId", "itemTaxGroupId", "taxCodeId", "revenueAccountId", "dim1", "dim2", "dim3", "dim4", "dim5", "dim6"];
  for (const l of lines) {
    const row: RecordData = { invoiceId: inv.id };
    for (const f of FIELDS) if (l[f] !== undefined && l[f] !== null) row[f] = l[f];
    await data.create("ar.invoiceLine", row);
  }
  await data.update("ar.order", String(order.id), { status: "invoiced", invoiceId: inv.id });
  await postInvoice(data, data.companyId ?? null, ar.cfg, (await data.get("ar.invoice", String(inv.id)))!);
  const posted = (await data.get("ar.invoice", String(inv.id)))!;
  await data.update("shop.order", shopOrderId, { status: "ready", amountGross: posted.amountGross, estimated: false });
  await notify(data, { kind: "info", title: "@SHOP:NotifyReady", params: { num: String(so.orderNum) }, href: `/shop/order?focus=${so.id}`, key: `shop-ready-${so.id}` });
  return String(inv.id);
}
