/**
 * Prodej na pokladně a uzávěrka směny.
 *
 * - Ceny se berou vždy z položek v databázi (cena s DPH), nikdy z terminálu.
 * - DPH na účtence se počítá z ceny s DPH po řádcích (maloobchod).
 * - Hotovost se zaokrouhluje na celé koruny; rozdíl je mimo základ DPH
 *   a účtuje se na účty zaokrouhlení pokladny.
 * - Uzávěrka zaúčtuje směnu jedním dokladem: MD hotovost + MD karty /
 *   D tržby (účty skupin položek) + D DPH po kódech ± zaokrouhlení,
 *   a založí daňové transakce jako zjednodušené doklady (KH oddíl A.5).
 */
import { fromCents, mulCents, roundCents, sumCents, toCents } from "@/core/money";
import { UserError, type DataApi, type ObjectHandlers, type RecordData } from "@/core/module";
import { accountingCurrencyId, currencyRounding, postVoucher, systemAccount, type PostingLine } from "@/modules/gl/posting";
import { bestDiscount, netFromGross } from "@/modules/inv/handlers";
import { addressLine, orgOf } from "@/modules/org";

const zero = BigInt(0);
const today = () => new Date().toISOString().slice(0, 10);

export interface SaleInput {
  registerId: string;
  lines: { itemId: string; qty: string }[];
  payment: "cash" | "card";
  /** přijatá hotovost (jen u platby hotově) */
  cashGiven?: string | null;
  /** platba kartou přes terminál: id transakce (ověřené volajícím) */
  paymentRef?: string | null;
}


export async function openShiftOf(data: DataApi, registerId: string): Promise<RecordData | null> {
  return (await data.find("pos.shift", { registerId, status: "open" }, { take: 1 }))[0] ?? null;
}

/** Řádek účtenky z položky — cena a DPH z databáze. */
async function saleLine(data: DataApi, itemId: string, qtyRaw: string) {
  const item = await data.get("inv.item", itemId);
  if (!item) throw new UserError("@SYS:NotFound");
  if (item.blocked) throw new UserError("@POS:ItemBlocked", { item: String(item.name) });
  if (item.priceGross === null || item.priceGross === undefined) throw new UserError("@POS:NoPrice", { item: String(item.name) });
  const qty = String(qtyRaw).replace(",", ".").trim();
  if (!/^\d+(\.\d{1,4})?$/.test(qty) || Number(qty) <= 0 || Number(qty) > 100000) throw new UserError("@POS:InvalidQty");
  const code = item.taxCodeId ? await data.get("tax.taxCode", String(item.taxCodeId)) : null;
  const group = await data.get("inv.itemGroup", String(item.groupId));
  // akční cena / sleva platná dnes (nejvýhodnější)
  const regular = toCents(item.priceGross);
  const disc = await bestDiscount(data, item, regular, today());
  const unitPrice = disc ? fromCents(disc.price) : String(item.priceGross);
  const gross = mulCents(qty, 4, unitPrice, 2);
  const net = netFromGross(gross, code?.rate ?? 0);
  return {
    itemId,
    description: String(item.name),
    qty,
    unitId: (item.unitId as string) ?? null,
    unitPrice,
    originalPrice: disc ? String(item.priceGross) : null,
    discountId: disc ? String(disc.discount.id) : null,
    taxCodeId: (item.taxCodeId as string) ?? null,
    revenueAccountId: (group?.revenueAccountId as string) ?? null,
    gross,
    net,
    tax: gross - net,
  };
}

/** Výpočet nákupu (ceny z položek) bez uložení — pro terminál a platbu kartou. */
export async function quote(data: DataApi, input: SaleInput) {
  const reg = await data.get("pos.register", input.registerId);
  if (!reg) throw new UserError("@SYS:NotFound");
  if (reg.blocked) throw new UserError("@POS:RegisterBlocked");
  const shift = await openShiftOf(data, input.registerId);
  if (!shift) throw new UserError("@POS:ShiftNotOpen");
  if (!input.lines.length) throw new UserError("@POS:EmptySale");
  if (input.lines.length > 500) throw new UserError("@POS:InvalidQty");
  const lines = [];
  for (const l of input.lines) lines.push(await saleLine(data, String(l.itemId), String(l.qty)));
  const gross = sumCents(lines.map((l) => l.gross));
  const net = sumCents(lines.map((l) => l.net));
  // hotovost: zaokrouhlení podle účetní měny (CZK na koruny), mimo základ DPH
  const r = await currencyRounding(data, await accountingCurrencyId(data, data.companyId ?? null));
  const paid = input.payment === "cash" ? roundCents(gross, r.cashUnit, r.cashMethod) : gross;
  return { reg, shift, lines, gross, net, paid };
}

/** Prodej: účtenka s řádky v otevřené směně pokladny. */
export async function sell(data: DataApi, input: SaleInput): Promise<RecordData> {
  const { reg, shift, lines, gross, net, paid } = await quote(data, input);
  const cash = input.payment === "cash";
  let given: bigint | null = null;
  if (cash && input.cashGiven) {
    given = toCents(String(input.cashGiven).replace(",", "."));
    if (given < paid) throw new UserError("@POS:NotEnoughCash");
  }

  const receipt = await data.create("pos.receipt", {
    registerId: reg.id,
    shiftId: shift.id,
    date: today(),
    paymentMethod: input.payment,
    amountNet: fromCents(net),
    taxAmount: fromCents(gross - net),
    amountGross: fromCents(gross),
    rounding: fromCents(paid - gross),
    amountPaid: fromCents(paid),
    cashGiven: given === null ? null : fromCents(given),
    change: given === null ? null : fromCents(given - paid),
    paymentRef: input.payment === "card" ? (input.paymentRef ?? null) : null,
  });
  for (const l of lines) {
    await data.create("pos.receiptLine", {
      receiptId: receipt.id,
      itemId: l.itemId,
      description: l.description,
      qty: l.qty,
      unitId: l.unitId,
      unitPrice: l.unitPrice,
      originalPrice: l.originalPrice,
      discountId: l.discountId,
      taxCodeId: l.taxCodeId,
      revenueAccountId: l.revenueAccountId,
      amountGross: fromCents(l.gross),
      amountNet: fromCents(l.net),
      taxAmount: fromCents(l.tax),
    });
  }
  return receipt;
}

export interface ShiftTotals {
  receiptCount: number;
  gross: bigint;
  tax: bigint;
  cash: bigint;
  card: bigint;
  rounding: bigint;
  /** účet tržeb → základ */
  revenue: Map<string, bigint>;
  /** daňový kód → { základ, daň } */
  taxes: Map<string, { base: bigint; tax: bigint }>;
}

export async function shiftTotals(data: DataApi, shiftId: string): Promise<ShiftTotals> {
  const receipts = await data.find("pos.receipt", { shiftId }, { take: 100000 });
  const t: ShiftTotals = { receiptCount: receipts.length, gross: zero, tax: zero, cash: zero, card: zero, rounding: zero, revenue: new Map(), taxes: new Map() };
  for (const r of receipts) {
    t.gross += toCents(r.amountGross);
    t.tax += toCents(r.taxAmount);
    t.rounding += toCents(r.rounding);
    if (r.paymentMethod === "cash") t.cash += toCents(r.amountPaid);
    else t.card += toCents(r.amountPaid);
    for (const l of await data.find("pos.receiptLine", { receiptId: r.id }, { take: 10000 })) {
      const net = toCents(l.amountNet);
      const acc = String(l.revenueAccountId ?? "");
      t.revenue.set(acc, (t.revenue.get(acc) ?? zero) + net);
      const code = String(l.taxCodeId ?? "");
      const x = t.taxes.get(code) ?? { base: zero, tax: zero };
      x.base += net;
      x.tax += toCents(l.taxAmount);
      t.taxes.set(code, x);
    }
  }
  return t;
}

/** Uzávěrka: zaúčtování směny, daňové transakce, uzavření. */
export async function closeShift(data: DataApi, shift: RecordData) {
  if (shift.status !== "open") throw new UserError("@SYS:Locked");
  const reg = await data.get("pos.register", String(shift.registerId));
  if (!reg) throw new UserError("@SYS:NotFound");
  const t = await shiftTotals(data, String(shift.id));
  const date = String(shift.openDate);
  let voucherId: unknown = null;
  if (t.receiptCount) {
    const lines: PostingLine[] = [];
    if (t.cash) lines.push({ accountId: String(reg.cashAccountId), amount: fromCents(t.cash), text: String(reg.name) });
    if (t.card) lines.push({ accountId: String(reg.cardAccountId), amount: fromCents(t.card), text: String(reg.name) });
    for (const [acc, net] of t.revenue) {
      if (!acc) throw new UserError("@SYS:FixErrors", {}, { revenueAccountId: "@SYS:Required" });
      if (net) lines.push({ accountId: acc, amount: fromCents(-net) });
    }
    for (const [codeId, x] of t.taxes) {
      if (!codeId || !x.tax) continue;
      const code = await data.get("tax.taxCode", codeId);
      lines.push({ accountId: String(code!.accountId), amount: fromCents(-x.tax) });
    }
    if (t.rounding > zero) lines.push({ accountId: await systemAccount(data, "roundingGain"), amount: fromCents(-t.rounding) });
    if (t.rounding < zero) lines.push({ accountId: await systemAccount(data, "roundingLoss"), amount: fromCents(-t.rounding) });
    const voucher = await postVoucher(data, {
      date,
      description: `${shift.shiftNum} · ${reg.name}`,
      sourceObject: "pos.shift",
      sourceId: String(shift.id),
      lines,
    });
    voucherId = voucher.id;
    for (const [codeId, x] of t.taxes) {
      if (!codeId) continue;
      const code = await data.get("tax.taxCode", codeId);
      await data.create("tax.trans", {
        taxDate: date,
        taxCodeId: codeId,
        direction: code!.direction,
        base: fromCents(x.base),
        tax: fromCents(x.tax),
        baseCur: fromCents(x.base),
        taxCur: fromCents(x.tax),
        documentNum: String(shift.shiftNum),
        voucherId,
        sourceObject: "pos.shift",
        sourceId: String(shift.id),
        simplified: true,
      });
    }
  }
  await data.update("pos.shift", String(shift.id), {
    status: "closed",
    receiptCount: t.receiptCount,
    salesGross: fromCents(t.gross),
    taxAmount: fromCents(t.tax),
    cashTotal: fromCents(t.cash),
    cardTotal: fromCents(t.card),
    roundingTotal: fromCents(t.rounding),
    expectedCash: fromCents(toCents(shift.openingCash) + t.cash),
    voucherId,
  });
}

export const posHandlers: Record<string, ObjectHandlers> = {
  "pos.shift": {
    async beforeSave(ctx, data, isNew) {
      if (!isNew) return;
      const reg = await ctx.data.get("pos.register", String(data.registerId));
      if (reg?.blocked) throw new UserError("@POS:RegisterBlocked");
      const open = await openShiftOf(ctx.data, String(data.registerId));
      if (open) throw new UserError("@POS:ShiftAlreadyOpen", { shift: String(open.shiftNum) });
    },
    actions: {
      async close(ctx, shift) {
        await closeShift(ctx.data, shift);
      },
    },
  },
};

export interface ReceiptPrint {
  receiptNum: string;
  issuedAt: string;
  register: string;
  /** tradeName = název provozovny/značka nad obchodním jménem (jen když se liší) */
  company: { name: string; tradeName?: string | null; regNo: string | null; vatId: string | null; address: string | null };
  lines: { description: string; qty: string; unit: string; unitPrice: string; amount: string; rate: string; originalPrice?: string | null }[];
  vat: { rate: string; base: string; tax: string }[];
  gross: string;
  rounding: string;
  paid: string;
  payment: string;
  cashGiven: string | null;
  change: string | null;
  footer: string | null;
  eet: { status: string | null; pok: string | null } | null;
  /** počet neodeslaných tržeb EET pokladny (vyplní akce prodeje) */
  eetQueue?: number;
}

/** Podklady pro tisk účtenky (zjednodušený daňový doklad). */
export async function receiptPrint(data: DataApi, companyId: string | null, receiptId: string): Promise<ReceiptPrint> {
  const r = await data.get("pos.receipt", receiptId);
  if (!r) throw new UserError("@SYS:NotFound");
  const reg = await data.get("pos.register", String(r.registerId));
  const company = companyId ? await data.get("sys.company", companyId) : null;
  const org = await orgOf(data);
  const [tp] = org ? [] : await data.find("tax.parameters", {}, { take: 1 }).catch(() => [] as RecordData[]);
  const addr = addressLine(org ?? tp);
  const lines = await data.find("pos.receiptLine", { receiptId }, { take: 10000 });
  const rates = new Map<string, string>();
  const units = new Map<string, string>();
  const vat = new Map<string, { base: bigint; tax: bigint }>();
  const out: ReceiptPrint["lines"] = [];
  for (const l of lines) {
    const codeId = String(l.taxCodeId ?? "");
    if (codeId && !rates.has(codeId)) rates.set(codeId, String(Number((await data.get("tax.taxCode", codeId))?.rate ?? 0)));
    const unitId = String(l.unitId ?? "");
    if (unitId && !units.has(unitId)) units.set(unitId, String((await data.get("inv.unit", unitId))?.code ?? ""));
    const rate = rates.get(codeId) ?? "0";
    const v = vat.get(rate) ?? { base: zero, tax: zero };
    v.base += toCents(l.amountNet);
    v.tax += toCents(l.taxAmount);
    vat.set(rate, v);
    out.push({
      description: String(l.description),
      qty: String(Number(l.qty)),
      unit: units.get(unitId) ?? "",
      unitPrice: String(l.unitPrice),
      amount: String(l.amountGross),
      rate,
      originalPrice: (l.originalPrice as string) ?? null,
    });
  }
  return {
    receiptNum: String(r.receiptNum),
    issuedAt: String(r.createdAt ?? r.date),
    register: String(reg?.name ?? ""),
    company: {
      name: String(org?.legalName ?? company?.name ?? ""),
      tradeName: org?.tradeName && org.tradeName !== org.legalName ? String(org.tradeName) : null,
      regNo: ((org?.regNo ?? company?.regNo) as string) ?? null,
      vatId: ((org?.vatId ?? company?.vatId) as string) ?? null,
      address: addr,
    },
    lines: out,
    vat: [...vat].map(([rate, v]) => ({ rate, base: fromCents(v.base), tax: fromCents(v.tax) })),
    gross: String(r.amountGross),
    rounding: String(r.rounding),
    paid: String(r.amountPaid),
    payment: String(r.paymentMethod),
    cashGiven: (r.cashGiven as string) ?? null,
    change: (r.change as string) ?? null,
    footer: (reg?.receiptFooter as string) ?? null,
    eet: r.eetStatus ? { status: String(r.eetStatus), pok: (r.eetPok as string) ?? null } : null,
  };
}

/** Nejčastěji prodávané položky pokladny za posledních `days` dní (počet řádků účtenek). */
export async function topItems(data: DataApi, registerId: string, days = 30, limit = 24): Promise<string[]> {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const counts = new Map<string, number>();
  for (const r of await data.find("pos.receipt", { registerId, date: { gte: since } }, { take: 2000 })) {
    for (const l of await data.find("pos.receiptLine", { receiptId: r.id }, { take: 200 })) counts.set(String(l.itemId), (counts.get(String(l.itemId)) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
}
