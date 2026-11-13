/**
 * Pokladní doklady: číslo z řady PPD / VPD, výpočet DPH z částky, zaúčtování
 * (hlavní kniha + daňová transakce u zjednodušeného dokladu) a kontrola, že
 * pokladna nejde do mínusu.
 */
import { fromCents, toCents } from "@/core/money";
import { UserError, type DataApi, type ObjectHandlers, type RecordData } from "@/core/module";
import { postVoucher, type PostingLine } from "@/modules/gl/posting";
import { netFromGross } from "@/modules/inv/handlers";

const zero = BigInt(0);

/** Zůstatek účtu pokladny ke dni (včetně). */
export async function deskBalance(data: DataApi, desk: RecordData, date: string): Promise<bigint> {
  const trans = await data.find("gl.trans", { accountId: desk.accountId, date: { lte: date } }, { take: 500000 });
  return trans.reduce((a, t) => a + toCents(t.amount), zero);
}

async function taxSplit(data: DataApi, d: RecordData) {
  const gross = toCents(d.amount);
  if (!d.taxCodeId) return { gross, net: gross, tax: zero, code: null as RecordData | null };
  const code = await data.get("tax.taxCode", String(d.taxCodeId));
  const net = netFromGross(gross, Number(code?.rate ?? 0));
  return { gross, net, tax: gross - net, code };
}

export async function postCashVoucher(data: DataApi, v: RecordData) {
  if (v.status !== "draft") throw new UserError("@SYS:Locked");
  const desk = await data.get("cash.desk", String(v.deskId));
  if (!desk) throw new UserError("@CASH:NoDesk");
  const { gross, net, tax, code } = await taxSplit(data, v);
  const sign = v.direction === "in" ? BigInt(1) : BigInt(-1);
  const date = String(v.date);
  // výdej: hotovost nesmí jít do mínusu (zůstatek k datu dokladu i k dnešku)
  if (v.direction === "out") {
    const today = new Date().toISOString().slice(0, 10);
    for (const d of [date, today > date ? today : date]) {
      const bal = await deskBalance(data, desk, d);
      if (bal - gross < zero) throw new UserError("@CASH:NegativeBalance", { desk: String(desk.code), date: d, balance: fromCents(bal) });
    }
  }
  // příjem: interní limit hotovosti v pokladně
  if (v.direction === "in" && desk.maxBalance && toCents(desk.maxBalance) > zero) {
    const bal = (await deskBalance(data, desk, date)) + gross;
    if (bal > toCents(desk.maxBalance)) throw new UserError("@CASH:OverLimit", { desk: String(desk.code), balance: fromCents(bal), limit: String(desk.maxBalance) });
  }
  const dims = Object.fromEntries(["dim1", "dim2", "dim3", "dim4", "dim5", "dim6"].map((f) => [f, (v[f] as string) ?? null]));
  const text = String(v.description);
  const lines: PostingLine[] = [
    { accountId: String(desk.accountId), amount: fromCents(sign * gross), text },
    { accountId: String(v.offsetAccountId), amount: fromCents(-sign * net), text, dims },
  ];
  if (tax !== zero && code) lines.push({ accountId: String(code.accountId), amount: fromCents(-sign * tax), text });
  const gv = await postVoucher(data, { date, description: `${v.docNum} · ${text}`, sourceObject: "cash.voucher", sourceId: String(v.id), lines });
  if (tax !== zero && code) {
    await data.create("tax.trans", {
      taxDate: date,
      taxCodeId: code.id,
      direction: code.direction,
      base: fromCents(net),
      tax: fromCents(tax),
      baseCur: fromCents(net),
      taxCur: fromCents(tax),
      subjectId: v.subjectId ?? null,
      documentNum: String(v.docNum),
      voucherId: gv.id,
      sourceObject: "cash.voucher",
      sourceId: String(v.id),
      simplified: true,
    });
  }
  await data.update("cash.voucher", String(v.id), { status: "posted", voucherId: gv.id });
}

export const cashHandlers: Record<string, ObjectHandlers> = {
  "cash.voucher": {
    async beforeSave(ctx, d, isNew) {
      if (!(toCents(d.amount ?? 0) > zero)) return { amount: "@CASH:AmountPositive" };
      // číslo podle směru: PPD (příjem) / VPD (výdej)
      if (isNew && !d.docNum) d.docNum = await ctx.data.nextNumber(d.direction === "in" ? "CASHIN" : "CASHOUT", new Date(String(d.date)));
      const { net, tax } = await taxSplit(ctx.data, d);
      d.amountNet = fromCents(net);
      d.taxAmount = fromCents(tax);
    },
    actions: {
      post: (ctx, rec) => postCashVoucher(ctx.data, rec),
    },
  },
};
