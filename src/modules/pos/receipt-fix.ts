/**
 * Oprava vystavené účtenky.
 *
 * - Odběratel (známý / jen na účtenku): do uzávěrky směny volně, po ní jen do podání přiznání / KH za období;
 *   uzavřená směna = přepočet daňových transakcí (KH A.4 jednotlivě ↔ A.5 souhrnně, `receiptA4`).
 * - Způsob platby: jen do uzávěrky směny; hotovost se znovu zaokrouhlí. Ne u karty přes terminál, zaplacené QR
 *   platby a u účtenky v EET, kdyby se změnila částka.
 * - Položky a částky se nepřepisují: Stornovat = opravná (záporná) účtenka v otevřené směně pokladny
 *   (zboží zpět na sklad, EET se zápornou tržbou), pak nový prodej (kasa → Otevřít účtenku).
 * - Smazat jde jen poslední účtenku otevřené směny, která nešla do EET, e-mailem ani kartou přes terminál
 *   (souvislá řada POSRCPT: číslo dostane další prodej).
 */
import { fromCents, roundCents, toCents } from "@/core/money";
import { UserError, type DataApi, type ObjectHandlers, type RecordData } from "@/core/module";
import { accountingCurrencyId, currencyRounding } from "@/modules/gl/posting";
import { filedPeriodOf } from "@/modules/tax/vat-return";
import { createReceiptTaxTrans, openShiftOf, qrBankAccount, receiptA4, receiptTaxParts } from "./sale";

const zero = BigInt(0);
const today = () => new Date().toISOString().slice(0, 10);
const day = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? "")).slice(0, 10);
const neg = (v: unknown) => (v === null || v === undefined || v === "" ? null : fromCents(-toCents(v)));
const BUYER = ["buyerName", "buyerStreet", "buyerZip", "buyerCity"] as const;
const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null) || String(a ?? "") === String(b ?? "");

/** Opravná (záporná) účtenka k účtence — v otevřené směně její pokladny. */
export async function stornoReceipt(data: DataApi, r: RecordData): Promise<RecordData> {
  if (r.stornoOfId || r.stornoId) throw new UserError("@POS:ReceiptIsStorno");
  const shift = await openShiftOf(data, String(r.registerId));
  if (!shift) throw new UserError("@POS:StornoNoShift");
  const qrAwaiting = r.paymentMethod === "qr" && r.payStatus === "awaiting";
  const st = await data.create("pos.receipt", {
    registerId: r.registerId,
    shiftId: shift.id,
    date: today(),
    paymentMethod: r.paymentMethod,
    amountNet: neg(r.amountNet),
    taxAmount: neg(r.taxAmount),
    amountGross: neg(r.amountGross),
    rounding: neg(r.rounding),
    amountPaid: neg(r.amountPaid),
    customerId: r.customerId ?? null,
    ...Object.fromEntries(BUYER.map((k) => [k, r[k] ?? null])),
    stornoOfId: r.id,
    // QR platba, na kterou se čekalo: nečeká se ani na jednu
    ...(qrAwaiting ? { payStatus: "cancelled" } : {}),
    // stornovaná účtenka byla v EET → storno se odešle se zápornou tržbou (kasa hned, jinak s dalším prodejem)
    ...(r.eetStatus ? { eetStatus: "pending" } : {}),
  });
  for (const l of await data.find("pos.receiptLine", { receiptId: r.id }, { take: 10000 }))
    await data.create("pos.receiptLine", {
      receiptId: st.id,
      itemId: l.itemId,
      description: l.description,
      qty: (-Number(l.qty)).toFixed(4),
      unitId: l.unitId ?? null,
      unitPrice: l.unitPrice,
      originalPrice: l.originalPrice ?? null,
      discountId: l.discountId ?? null,
      taxCodeId: l.taxCodeId ?? null,
      revenueAccountId: l.revenueAccountId ?? null,
      amountGross: neg(l.amountGross),
      amountNet: neg(l.amountNet),
      taxAmount: neg(l.taxAmount),
    });
  await data.update("pos.receipt", String(r.id), { stornoId: st.id, ...(qrAwaiting ? { payStatus: "cancelled" } : {}) });
  return (await data.get("pos.receipt", String(st.id)))!;
}

/** Smí se účtenka smazat (poslední v otevřené směně, nikam neodešla)? */
export async function canDeleteReceipt(data: DataApi, r: RecordData): Promise<boolean> {
  if (r.stornoOfId || r.stornoId || r.eetStatus || r.emailedAt || r.paymentRef || r.offline || r.payStatus === "paid") return false;
  const shift = await data.get("pos.shift", String(r.shiftId));
  if (shift?.status !== "open") return false;
  // poslední účtenka z řady (offline účtenky mají vlastní čísla kasy)
  const last = (await data.find("pos.receipt", {}, { take: 20, orderBy: { createdAt: "desc" } })).find((x) => !x.offline);
  return !last || last.id === r.id;
}

/** Souhrnná daňová transakce směny (A.5) pro kód: přičíst / odečíst základ a daň. */
async function shiftTaxAdd(data: DataApi, shift: RecordData, aggs: RecordData[], codeId: string, x: { base: bigint; tax: bigint }, sign: 1 | -1) {
  const row = aggs.find((t) => t.taxCodeId === codeId);
  const base = (row ? toCents(row.base) : zero) + BigInt(sign) * x.base;
  const tax = (row ? toCents(row.tax) : zero) + BigInt(sign) * x.tax;
  if (row && base === zero && tax === zero) return data.remove("tax.trans", String(row.id));
  const amounts = { base: fromCents(base), tax: fromCents(tax), baseCur: fromCents(base), taxCur: fromCents(tax) };
  if (row) return data.update("tax.trans", String(row.id), amounts);
  const code = await data.get("tax.taxCode", codeId);
  await data.create("tax.trans", {
    taxDate: day(shift.openDate),
    taxCodeId: codeId,
    direction: code!.direction,
    ...amounts,
    documentNum: String(shift.shiftNum),
    voucherId: shift.voucherId ?? null,
    sourceObject: "pos.shift",
    sourceId: String(shift.id),
    simplified: true,
  });
}

/** Změna odběratele účtenky uzavřené směny: daňové transakce podle nového odběratele (A.4 ↔ A.5). */
async function retaxCustomer(data: DataApi, shift: RecordData, before: RecordData, after: RecordData) {
  const a0 = await receiptA4(data, before);
  const a1 = await receiptA4(data, after);
  if (!a0 && !a1) return;
  for (const d of [before.date, shift.openDate]) {
    const period = await filedPeriodOf(data, d);
    if (period) throw new UserError("@POS:ReceiptTaxFiled", { period });
  }
  const own = await data.find("tax.trans", { sourceObject: "pos.receipt", sourceId: String(before.id) }, { take: 100 });
  if (a0 && a1) {
    for (const t of own) await data.update("tax.trans", String(t.id), { subjectId: a1.subjectId, vatId: a1.vatId });
    return;
  }
  const parts = await receiptTaxParts(data, String(before.id));
  const aggs = await data.find("tax.trans", { sourceObject: "pos.shift", sourceId: String(shift.id) }, { take: 100 });
  if (a0) {
    // už ne jednotlivě: zpět do souhrnu směny
    for (const t of own) await data.remove("tax.trans", String(t.id));
    for (const [codeId, x] of parts) await shiftTaxAdd(data, shift, aggs, codeId, x, 1);
  } else {
    for (const [codeId, x] of parts) await shiftTaxAdd(data, shift, aggs, codeId, x, -1);
    await createReceiptTaxTrans(data, after, a1!, parts, shift.voucherId ?? null, day(shift.openDate));
  }
}

export const receiptFixHandlers: Record<string, ObjectHandlers> = {
  "pos.receipt": {
    async beforeSave(ctx, d, isNew) {
      if (isNew || !d.id) return;
      const before = await ctx.data.get("pos.receipt", String(d.id));
      if (!before) return;
      // známý odběratel = údaje z adresáře (odběratel jen na účtenku se maže)
      if (d.customerId && !same(before.customerId, d.customerId)) for (const k of BUYER) d[k] = null;
      const custChanged = !same(before.customerId, d.customerId) || BUYER.some((k) => !same(before[k], d[k]));
      const payChanged = !same(before.paymentMethod, d.paymentMethod);
      if (!custChanged && !payChanged) return;
      if (before.stornoOfId || before.stornoId) throw new UserError("@POS:ReceiptIsStorno");
      const shift = await ctx.data.get("pos.shift", String(before.shiftId));
      const open = shift?.status === "open";
      if (custChanged && d.customerId) {
        const c = await ctx.data.get("ar.customer", String(d.customerId)).catch(() => null);
        if (c?.blocked) throw new UserError("@SYS:PartnerBlocked");
      }
      if (payChanged) {
        if (!open) throw new UserError("@POS:ReceiptShiftClosed");
        if (!["cash", "card", "qr"].includes(String(d.paymentMethod))) throw new UserError("@SYS:InvalidValue");
        if (before.paymentRef) throw new UserError("@POS:ReceiptCardTerminal");
        if (before.paymentMethod === "qr" && before.payStatus === "paid") throw new UserError("@POS:ReceiptQrPaid");
        const gross = toCents(before.amountGross);
        const r = await currencyRounding(ctx.data, await accountingCurrencyId(ctx.data, ctx.data.companyId ?? null));
        const paid = d.paymentMethod === "cash" ? roundCents(gross, r.cashUnit, r.cashMethod) : gross;
        if (before.eetStatus && paid !== toCents(before.amountPaid)) throw new UserError("@POS:ReceiptEetAmount");
        if (d.paymentMethod === "qr") {
          const reg = await ctx.data.get("pos.register", String(before.registerId));
          if (!reg || !(await qrBankAccount(ctx.data, reg))) throw new UserError("@POS:QrNoAccount");
        }
        Object.assign(d, {
          rounding: fromCents(paid - gross),
          amountPaid: fromCents(paid),
          cashGiven: null,
          change: null,
          payStatus: d.paymentMethod === "qr" ? "awaiting" : null,
          vs: d.paymentMethod === "qr" ? String(before.receiptNum ?? "").replace(/\D/g, "").slice(-10) : null,
          paidDate: null,
        });
      }
      if (custChanged && !open && shift) await retaxCustomer(ctx.data, shift, before, d);
    },
    async beforeDelete(ctx, r) {
      if (!(await canDeleteReceipt(ctx.data, r))) return "@POS:ReceiptDeleteRule";
      // řádky (sklad se vrátí obsluhou skladu), odložený nákup ztratí odkaz
      for (const l of await ctx.data.find("pos.receiptLine", { receiptId: r.id }, { take: 10000 })) await ctx.data.remove("pos.receiptLine", String(l.id));
      for (const b of await ctx.data.find("pos.basket", { receiptId: r.id }, { take: 10 })) await ctx.data.update("pos.basket", String(b.id), { receiptId: null });
    },
    actions: {
      async storno(ctx, r) {
        const st = await stornoReceipt(ctx.data, r);
        return { open: { object: "pos.receipt", id: String(st.id) } };
      },
      async markPaid(ctx, r, _file, input) {
        if (r.payStatus !== "awaiting") throw new UserError("@POS:NotAwaiting");
        const date = day(input?.paidDate) || today();
        await ctx.data.update("pos.receipt", String(r.id), { payStatus: "paid", paidDate: date });
      },
    },
  },
};
