/**
 * Logika skladu: pohyb (whs.trans) + zásoba (whs.onhand) jedním voláním,
 * rezervace, skladové deníky a napojení na doklady jiných modulů.
 *
 * Napojení (jen se zapnutým Skladem, `ctx.modules`):
 * - prodejní objednávka potvrzená → rezervace; zrušená → uvolnění
 * - vydaná faktura zaúčtovaná → výdej (z objednávky uvolní rezervaci)
 * - přijatá faktura bez objednávky zaúčtovaná → příjem
 * - nákupní objednávka → Přijmout na sklad = příjemka (deník) se zbytkem k přijetí
 * - řádek účtenky z pokladny → výdej (sklad pokladny, jinak výchozí)
 * Výdej z prodeje smí jít do mínusu (prodej se nezastaví), deníky ne.
 */
import { fromCents, mulCents, toCents } from "@/core/money";
import { UserError, type DataApi, type EventContext, type ObjectHandlers, type RecordData } from "@/core/module";
import { convertPrice, postVoucher } from "@/modules/gl/posting";

const Q = 10_000; // množství na 4 desetinná místa
const q = (v: unknown) => Math.round(Number(v ?? 0) * Q) / Q;
const qs = (n: number) => (Math.round(n * Q) / Q).toFixed(4);
const today = () => new Date().toISOString().slice(0, 10);
const on = (ctx: EventContext) => !ctx.modules || ctx.modules.has("whs");

/** Skladová položka (ne služba). */
async function stocked(data: DataApi, itemId: unknown): Promise<RecordData | null> {
  if (!itemId) return null;
  const item = await data.get("inv.item", String(itemId));
  return item && item.itemType === "item" ? item : null;
}

export async function defaultWarehouse(data: DataApi): Promise<RecordData> {
  const all = (await data.find("whs.warehouse", { blocked: false }, { take: 100, orderBy: { code: "asc" } })) as RecordData[];
  const w = all.find((x) => x.isDefault) ?? all[0];
  if (!w) throw new UserError("@WHS:NoWarehouse");
  return w;
}

async function onhandRow(data: DataApi, itemId: string, warehouseId: string, locationId: string | null) {
  const [row] = await data.find("whs.onhand", { itemId, warehouseId, locationId }, { take: 1 });
  return row ?? null;
}

/** Zásoba položky ve skladu (všechny lokace) nebo v jedné lokaci. */
export async function stockOf(data: DataApi, itemId: string, warehouseId: string, locationId?: string | null): Promise<number> {
  if (locationId !== undefined) return q((await onhandRow(data, itemId, warehouseId, locationId))?.qty);
  return (await data.find("whs.onhand", { itemId, warehouseId }, { take: 1000 })).reduce((a, r) => a + q(r.qty), 0);
}

export interface Move {
  date: string;
  kind: "receipt" | "issue" | "sale" | "transfer" | "count" | "scrap";
  itemId: string;
  warehouseId: string;
  locationId?: string | null;
  /** + příjem, − výdej */
  qty: number;
  documentNum?: string | null;
  sourceObject?: string | null;
  sourceId?: string | null;
  reason?: string | null;
  allowNegative?: boolean;
  /** příjem: pořizovací hodnota celého pohybu v účetní měně (haléře); bez ní průměrná cena */
  receiptValue?: bigint | null;
}

// ---------------------------------------------------------------------------
// Ocenění: průměrná cena za firmu (klouzavý průměr), hodnota pohybů
// ---------------------------------------------------------------------------

const Z = BigInt(0);
const QS = BigInt(10_000); // množství ×10⁴
const qBig = (v: unknown) => BigInt(Math.round(Number(v ?? 0) * 10_000));
/** a / b zaokrouhleno na celé (b > 0) */
const divRound = (a: bigint, b: bigint) => {
  const neg = a < Z;
  const x = neg ? -a : a;
  const r = (x * BigInt(2) + b) / (b * BigInt(2));
  return neg ? -r : r;
};

export async function whsParams(data: DataApi): Promise<RecordData | null> {
  try {
    return ((await data.find("whs.parameters", {}, { take: 1 })) as RecordData[])[0] ?? null;
  } catch {
    return null;
  }
}

/** Náhradní cena, když položka nemá průměr: nákupní cena položky v účetní měně. */
async function fallbackCost(data: DataApi, itemId: string, date: string): Promise<string> {
  const item = await data.get("inv.item", itemId);
  if (!item?.purchasePrice) return "0";
  return convertPrice(data, data.companyId ?? null, item.purchasePrice, item.currencyId as string, null, date);
}

/** Hodnota pohybu (haléře, se znaménkem) a nový stav průměrné ceny položky. */
async function valueMove(data: DataApi, m: Move): Promise<{ value: bigint; unitCost: string } | null> {
  if (m.kind === "transfer") return null; // přesun hodnotu firmy nemění
  const p = await whsParams(data);
  if (!p?.valuation) return null;
  const [row] = (await data.find("whs.itemCost", { itemId: m.itemId }, { take: 1 })) as RecordData[];
  const qty0 = qBig(row?.qty);
  const val0 = toCents(row?.value ?? 0);
  const mq = qBig(m.qty);
  const avgCents = async () => (qty0 > Z ? null : toCents(row?.avgCost ?? (await fallbackCost(data, m.itemId, m.date))));
  let value: bigint;
  if (mq > Z && m.receiptValue !== undefined && m.receiptValue !== null) value = m.receiptValue;
  else if (qty0 > Z) value = divRound(val0 * mq, qty0); // průměr ze zásoby
  else value = divRound((await avgCents())! * mq, QS); // bez zásoby: poslední průměr / nákupní cena
  const qty1 = qty0 + mq;
  // vyprodáno: zbytek hodnoty (haléřové rozdíly) odejde s posledním výdejem
  if (qty1 === Z && mq < Z) value = -val0;
  const val1 = val0 + value;
  const avg = qty1 > Z ? fromCents(divRound(val1 * QS, qty1)) : (row?.avgCost as string) ?? fromCents(value < Z ? -divRound(value * QS, mq) : divRound(value * QS, mq));
  const values = { qty: (Number(qty1) / 10_000).toFixed(4), value: fromCents(val1), avgCost: avg };
  if (row) await data.update("whs.itemCost", String(row.id), values);
  else await data.create("whs.itemCost", { itemId: m.itemId, ...values });
  const unit = mq !== Z ? fromCents(divRound((value < Z ? -value : value) * QS, mq < Z ? -mq : mq)) : "0";
  return { value, unitCost: unit };
}

/**
 * Zaúčtování ocenění pohybů (způsob A): jeden doklad za zdrojový doklad a den.
 *   příjem 132/131 · výdej a prodej 504/132 · vyřazení 549/132 · inventura manko 549/132, přebytek 132/648
 */
export async function postStockValue(data: DataApi, filter: { sourceObject?: string; sourceId?: string }): Promise<number> {
  const p = await whsParams(data);
  if (!p?.valuation) return 0;
  const rows = ((await data.find("whs.trans", { ...filter, voucherId: null }, { take: 10_000, orderBy: { date: "asc" } })) as RecordData[]).filter((t) => t.value && toCents(t.value) !== Z);
  const groups = new Map<string, RecordData[]>();
  for (const t of rows) {
    // pokladna: jeden doklad za den, ostatní za zdrojový doklad
    const k = t.sourceObject === "pos.receipt" ? `pos|${t.date}` : `${t.sourceObject}|${t.sourceId}|${t.date}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  let n = 0;
  for (const [k, list] of groups) {
    const acc = new Map<string, bigint>();
    const add = (a: unknown, c: bigint) => acc.set(String(a), (acc.get(String(a)) ?? Z) + c);
    for (const t of list) {
      const v = toCents(t.value);
      add(p.stockAccountId, v);
      const other = t.kind === "receipt" ? p.inTransitAccountId : t.kind === "scrap" ? p.scrapAccountId : t.kind === "count" ? (v > Z ? p.gainAccountId : p.lossAccountId) : p.cogsAccountId;
      add(other, -v);
    }
    const lines = [...acc].filter(([, c]) => c !== Z).map(([accountId, c]) => ({ accountId, amount: fromCents(c), text: String(list[0].documentNum ?? "") }));
    if (!lines.length) continue;
    const doc = k.startsWith("pos|") ? `POS ${list[0].date}` : String(list[0].documentNum ?? "");
    const v = await postVoucher(data, { date: String(list[0].date), description: doc.slice(0, 255), sourceObject: "whs.trans", sourceId: String(list[0].sourceId ?? list[0].id), lines });
    for (const t of list) await data.update("whs.trans", String(t.id), { voucherId: v.id });
    n++;
  }
  return n;
}

/** Pohyb + zásoba. Výdej pod nulu jen s `allowNegative`. */
export async function move(data: DataApi, m: Move) {
  if (!m.qty) return;
  const loc = m.locationId ?? null;
  const row = await onhandRow(data, m.itemId, m.warehouseId, loc);
  const next = q(row?.qty) + m.qty;
  if (next < 0 && !m.allowNegative) {
    const [item, wh] = [await data.get("inv.item", m.itemId), await data.get("whs.warehouse", m.warehouseId)];
    throw new UserError("@WHS:NotEnough", { item: String(item?.name ?? ""), wh: String(wh?.code ?? ""), qty: String(q(row?.qty)) });
  }
  const val = await valueMove(data, m);
  await data.create("whs.trans", {
    date: m.date,
    kind: m.kind,
    itemId: m.itemId,
    warehouseId: m.warehouseId,
    locationId: loc,
    qty: qs(m.qty),
    documentNum: m.documentNum ?? null,
    sourceObject: m.sourceObject ?? null,
    sourceId: m.sourceId ?? null,
    reason: m.reason ?? null,
    unitCost: val?.unitCost ?? null,
    value: val ? fromCents(val.value) : null,
  });
  if (row) await data.update("whs.onhand", String(row.id), { qty: qs(next) });
  else await data.create("whs.onhand", { itemId: m.itemId, warehouseId: m.warehouseId, locationId: loc, qty: qs(next) });
}

async function release(data: DataApi, sourceObject: string, sourceId: string) {
  for (const r of await data.find("whs.reservation", { sourceObject, sourceId }, { take: 1000 })) await data.remove("whs.reservation", String(r.id));
}

/** Řádky dokladu (faktura, objednávka) → pohyb skladových položek. */
async function moveDocLines(data: DataApi, lines: RecordData[], sign: 1 | -1, p: { kind: Move["kind"]; date: string; warehouseId: string; documentNum: string; sourceObject: string; sourceId: string; currencyId?: string | null }) {
  for (const l of lines) {
    if (!(await stocked(data, l.itemId))) continue;
    // příjem z faktury: hodnota = základ řádku v účetní měně
    const receiptValue = sign > 0 && l.amountNet ? toCents(await convertPrice(data, data.companyId ?? null, l.amountNet, p.currencyId ?? null, null, p.date)) : null;
    await move(data, { ...p, itemId: String(l.itemId), qty: sign * q(l.qty), allowNegative: true, receiptValue });
  }
  await postStockValue(data, { sourceObject: p.sourceObject, sourceId: p.sourceId });
}

const already = async (data: DataApi, sourceObject: string, sourceId: string) => (await data.find("whs.trans", { sourceObject, sourceId }, { take: 1 })).length > 0;

// ---------------------------------------------------------------------------
// Skladový deník
// ---------------------------------------------------------------------------

async function assertDraftJournal(data: DataApi, journalId: unknown) {
  const j = journalId ? await data.get("whs.journal", String(journalId)) : null;
  if (j?.status === "posted") throw new UserError("@GL:Locked");
  return j;
}

async function assertLocation(data: DataApi, locationId: unknown, warehouseId: unknown): Promise<string | null> {
  if (!locationId) return null;
  const l = await data.get("whs.location", String(locationId));
  return l && l.warehouseId === warehouseId ? null : "@WHS:LocationOtherWarehouse";
}

export async function postJournal(data: DataApi, j: RecordData) {
  if (j.status !== "draft") throw new UserError("@GL:Locked");
  const lines = await data.find("whs.journalLine", { journalId: j.id }, { take: 5000 });
  if (!lines.length) throw new UserError("@GL:NoLines");
  const base = { date: String(j.date), documentNum: String(j.journalNum), sourceObject: "whs.journal", sourceId: String(j.id) };
  for (const l of lines) {
    const itemId = String(l.itemId);
    const wh = String(j.warehouseId);
    const loc = (l.locationId as string) ?? null;
    const reason = (l.reason as string) ?? null;
    switch (j.kind) {
      case "receipt":
        await move(data, { ...base, kind: "receipt", itemId, warehouseId: wh, locationId: loc, qty: q(l.qty), reason, receiptValue: l.unitCost !== null && l.unitCost !== undefined && l.unitCost !== "" ? mulCents(qs(q(l.qty)), 4, l.unitCost, 2) : null });
        if (l.orderLineId) {
          const ol = await data.get("ap.orderLine", String(l.orderLineId));
          if (ol) await data.update("ap.orderLine", String(ol.id), { deliveredQty: qs(q(ol.deliveredQty) + q(l.qty)) });
        }
        break;
      case "scrap":
        await move(data, { ...base, kind: "scrap", itemId, warehouseId: wh, locationId: loc, qty: -q(l.qty), reason });
        break;
      case "transfer":
        await move(data, { ...base, kind: "transfer", itemId, warehouseId: wh, locationId: loc, qty: -q(l.qty), reason });
        await move(data, { ...base, kind: "transfer", itemId, warehouseId: String(j.toWarehouseId ?? wh), locationId: (l.toLocationId as string) ?? null, qty: q(l.qty), reason });
        break;
      case "count": {
        // rozdíl proti stavu v okamžiku zaúčtování
        const diff = q(l.countedQty) - (await stockOf(data, itemId, wh, loc));
        await move(data, { ...base, kind: "count", itemId, warehouseId: wh, locationId: loc, qty: diff, reason, allowNegative: true });
        break;
      }
    }
  }
  await data.update("whs.journal", String(j.id), { status: "posted" });
  await postStockValue(data, { sourceObject: "whs.journal", sourceId: String(j.id) });
}

/** Inventura: řádky se stavem v evidenci pro všechny zásoby skladu. */
async function loadOnhand(data: DataApi, j: RecordData) {
  const have = new Set((await data.find("whs.journalLine", { journalId: j.id }, { take: 5000 })).map((l) => `${l.itemId}|${l.locationId ?? ""}`));
  for (const r of await data.find("whs.onhand", { warehouseId: j.warehouseId }, { take: 5000 })) {
    if (have.has(`${r.itemId}|${r.locationId ?? ""}`) || (j.kind === "count" ? false : q(r.qty) <= 0)) continue;
    await data.create("whs.journalLine", { journalId: j.id, itemId: r.itemId, locationId: r.locationId ?? null, onhandQty: r.qty, ...(j.kind === "count" ? { countedQty: r.qty } : { qty: r.qty }) });
  }
}

/** Příjemka nad nákupní objednávkou: zbytek k přijetí skladových položek. */
async function receiveOrder(data: DataApi, order: RecordData) {
  const wh = order.warehouseId ? await data.get("whs.warehouse", String(order.warehouseId)) : await defaultWarehouse(data);
  const j = await data.create("whs.journal", { kind: "receipt", warehouseId: wh!.id, date: today(), description: String(order.orderNum ?? ""), purchaseOrderId: order.id });
  let n = 0;
  for (const l of await data.find("ap.orderLine", { orderId: order.id }, { take: 5000 })) {
    if (!(await stocked(data, l.itemId))) continue;
    const rest = q(l.qty) - q(l.deliveredQty);
    if (rest <= 0) continue;
    const unitCost = l.unitPrice ? await convertPrice(data, data.companyId ?? null, l.unitPrice, order.currencyId as string, null, today()) : null;
    await data.create("whs.journalLine", { journalId: j.id, itemId: l.itemId, qty: qs(rest), orderLineId: l.id, unitCost });
    n++;
  }
  if (!n) {
    await data.remove("whs.journal", String(j.id));
    throw new UserError("@WHS:NothingToReceive");
  }
}

// ---------------------------------------------------------------------------
// Obsluhy
// ---------------------------------------------------------------------------

async function purchaseAccount(ctx: EventContext, d: RecordData, isNew: boolean): Promise<void> {
  if (!on(ctx) || !isNew || !d.itemId) return;
  const p = await whsParams(ctx.data);
  if (p?.valuation && p.inTransitAccountId && (await stocked(ctx.data, d.itemId))) d.expenseAccountId = p.inTransitAccountId;
}

export const whsHandlers: Record<string, ObjectHandlers> = {
  "whs.location": {
    async beforeSave(ctx, d) {
      const levels = (await ctx.data.find("whs.locationLevel", {}, { take: 10, orderBy: { position: "asc" } })) as RecordData[];
      const parent = d.parentId ? await ctx.data.get("whs.location", String(d.parentId)) : null;
      if (parent && parent.warehouseId !== d.warehouseId) return { parentId: "@WHS:LocationOtherWarehouse" };
      if (parent && parent.id === d.id) return { parentId: "@SYS:InvalidValue" };
      const level = parent ? Number(parent.level ?? 1) + 1 : 1;
      const max = Math.min(6, levels.length || 6);
      if (level > max) return { parentId: ctx.t("@WHS:TooDeep", { n: String(max) }) };
      d.level = level;
      d.levelName = levels.find((l) => Number(l.position) === level)?.name ?? null;
      d.path = parent ? `${parent.path}.${d.code}` : String(d.code);
    },
    async afterSave(ctx, d) {
      // přejmenování: cesty podřízených lokací
      for (const c of await ctx.data.find("whs.location", { parentId: d.id }, { take: 1000 })) {
        if (c.path !== `${d.path}.${c.code}`) await ctx.data.update("whs.location", String(c.id), { path: `${d.path}.${c.code}` });
      }
    },
  },
  "whs.warehouse": {
    async afterSave(ctx, d) {
      // výchozí může být jen jeden sklad
      if (!d.isDefault) return;
      for (const w of await ctx.data.find("whs.warehouse", { isDefault: true }, { take: 100 })) if (w.id !== d.id) await ctx.data.update("whs.warehouse", String(w.id), { isDefault: false });
    },
  },
  "whs.journal": {
    async beforeSave(_ctx, d) {
      if (d.kind === "transfer" && !d.toWarehouseId) d.toWarehouseId = d.warehouseId;
    },
    actions: {
      async post(ctx, j) {
        await postJournal(ctx.data, j);
      },
      async loadOnhand(ctx, j) {
        await loadOnhand(ctx.data, j);
      },
    },
  },
  "whs.journalLine": {
    async beforeSave(ctx, d, isNew) {
      const j = await assertDraftJournal(ctx.data, d.journalId);
      if (!j) return;
      const e: Record<string, string> = {};
      const bad = await assertLocation(ctx.data, d.locationId, j.warehouseId);
      if (bad) e.locationId = bad;
      if (j.kind === "transfer") {
        const bad2 = await assertLocation(ctx.data, d.toLocationId, j.toWarehouseId ?? j.warehouseId);
        if (bad2) e.toLocationId = bad2;
        if (j.toWarehouseId === j.warehouseId && (d.toLocationId ?? null) === (d.locationId ?? null)) e.toLocationId = "@WHS:TransferTarget";
      }
      if (j.kind === "count") {
        if (d.countedQty === null || d.countedQty === undefined || d.countedQty === "") e.countedQty = "@WHS:CountedRequired";
        if (isNew || d.onhandQty === null || d.onhandQty === undefined) d.onhandQty = qs(await stockOf(ctx.data, String(d.itemId), String(j.warehouseId), (d.locationId as string) ?? null));
      } else if (!(q(d.qty) > 0)) e.qty = "@WHS:QtyRequired";
      if (Object.keys(e).length) return e;
    },
    beforeDelete: async (ctx, d) => void (await assertDraftJournal(ctx.data, d.journalId)),
  },

  // --- napojení na doklady jiných modulů -----------------------------------
  // ocenění zapnuté: nákup skladové položky na účet pořízení (131) místo nákladů
  "ap.invoiceLine": { beforeSave: (ctx, d, isNew) => purchaseAccount(ctx, d, isNew) },
  "ap.orderLine": { beforeSave: (ctx, d, isNew) => purchaseAccount(ctx, d, isNew) },
  "ap.order": {
    actions: {
      async receive(ctx, order) {
        await receiveOrder(ctx.data, order);
      },
    },
  },
  "ar.order": {
    async afterSave(ctx, o) {
      if (!on(ctx)) return;
      if (o.status === "cancelled") return release(ctx.data, "ar.order", String(o.id));
      if (o.status !== "confirmed") return;
      if ((await ctx.data.find("whs.reservation", { sourceObject: "ar.order", sourceId: String(o.id) }, { take: 1 })).length) return;
      const wh = o.warehouseId ? String(o.warehouseId) : String((await defaultWarehouse(ctx.data)).id);
      for (const l of await ctx.data.find("ar.orderLine", { orderId: o.id }, { take: 5000 })) {
        if (!(await stocked(ctx.data, l.itemId))) continue;
        await ctx.data.create("whs.reservation", { itemId: l.itemId, warehouseId: wh, qty: l.qty, documentNum: String(o.orderNum ?? ""), sourceObject: "ar.order", sourceId: String(o.id) });
      }
    },
  },
  "ar.invoice": {
    async afterSave(ctx, inv) {
      if (!on(ctx) || inv.status !== "posted" || (await already(ctx.data, "ar.invoice", String(inv.id)))) return;
      const order = inv.orderId ? await ctx.data.get("ar.order", String(inv.orderId)) : null;
      const wh = order?.warehouseId ? String(order.warehouseId) : String((await defaultWarehouse(ctx.data)).id);
      const lines = await ctx.data.find("ar.invoiceLine", { invoiceId: inv.id }, { take: 5000 });
      await moveDocLines(ctx.data, lines, -1, { kind: "issue", date: String(inv.invoiceDate), warehouseId: wh, documentNum: String(inv.invoiceNum), sourceObject: "ar.invoice", sourceId: String(inv.id) });
      if (order) await release(ctx.data, "ar.order", String(order.id));
    },
  },
  "ap.invoice": {
    async afterSave(ctx, inv) {
      // faktura z objednávky: zboží přišlo příjemkou
      if (!on(ctx) || inv.status !== "posted" || inv.orderId || (await already(ctx.data, "ap.invoice", String(inv.id)))) return;
      const wh = String((await defaultWarehouse(ctx.data)).id);
      const lines = await ctx.data.find("ap.invoiceLine", { invoiceId: inv.id }, { take: 5000 });
      await moveDocLines(ctx.data, lines, 1, { kind: "receipt", date: String(inv.invoiceDate), warehouseId: wh, documentNum: String(inv.externalNum ?? inv.invoiceNum), sourceObject: "ap.invoice", sourceId: String(inv.id), currencyId: (inv.currencyId as string) ?? null });
    },
  },
  "pos.receiptLine": {
    async afterSave(ctx, l, isNew) {
      if (!on(ctx) || !isNew || !(await stocked(ctx.data, l.itemId))) return;
      const r = await ctx.data.get("pos.receipt", String(l.receiptId));
      const reg = r?.registerId ? await ctx.data.get("pos.register", String(r.registerId)) : null;
      const wh = reg?.warehouseId ? String(reg.warehouseId) : String((await defaultWarehouse(ctx.data)).id);
      await move(ctx.data, { kind: "sale", date: String(r?.createdAt ?? today()).slice(0, 10), itemId: String(l.itemId), warehouseId: wh, qty: -q(l.qty), documentNum: String(r?.receiptNum ?? ""), sourceObject: "pos.receipt", sourceId: String(l.receiptId), allowNegative: true });
    },
    // smazaná účtenka (poslední v otevřené směně): zboží zpět na sklad
    async beforeDelete(ctx, l) {
      if (!on(ctx) || !(await stocked(ctx.data, l.itemId))) return;
      const r = await ctx.data.get("pos.receipt", String(l.receiptId));
      const reg = r?.registerId ? await ctx.data.get("pos.register", String(r.registerId)) : null;
      const wh = reg?.warehouseId ? String(reg.warehouseId) : String((await defaultWarehouse(ctx.data)).id);
      await move(ctx.data, { kind: "sale", date: today(), itemId: String(l.itemId), warehouseId: wh, qty: q(l.qty), documentNum: String(r?.receiptNum ?? ""), sourceObject: "pos.receipt", sourceId: String(l.receiptId), allowNegative: true });
    },
  },
};
