/**
 * Platba DPH (Přiznání a podání → druh „Platba DPH“): z daňových transakcí období vypočte vlastní daňovou
 * povinnost (celé koruny jako přiznání), zúčtuje účty DPH proti dodavateli Finanční úřad (Daňové parametry)
 * a založí otevřenou položku jeho salda — VS = DIČ (číslice), splatnost 25. den po skončení období.
 * Uhrazeno = položku salda uzavře spárovaná platba z výpisu (VS = DIČ, účet FÚ) jako u kterékoli faktury.
 * Nadměrný odpočet = záporná položka (pohledávka za FÚ).
 */
import { fromCents, toCents } from "@/core/money";
import { UserError, type DataApi, type ObjectHandlers, type RecordData } from "@/core/module";
import { accountingCurrencyId, postVoucher, systemAccount, type PostingLine } from "@/modules/gl/posting";
import { DEDUCT_LINES, OUTPUT_LINES, computeVat, periodRange } from "./vat-return";

const pad = (n: number) => String(n).padStart(2, "0");

/** Splatnost DPH: 25. den měsíce po skončení období. */
export function vatDueDate(to: string): string {
  const [y, m] = to.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${pad(nm)}-25`;
}

/** Celé koruny jako v přiznání (zaokrouhlení na celé Kč nahoru od 50 haléřů). */
const kc = (cents: bigint) => {
  const neg = cents < BigInt(0);
  const a = neg ? -cents : cents;
  const r = (a + BigInt(50)) / BigInt(100);
  return neg ? -r : r;
};

export async function postVatPayment(data: DataApi, companyId: string | null, ret: RecordData, t: (ref: string, p?: Record<string, string>) => string): Promise<void> {
  if (ret.kind !== "vatPayment") throw new UserError("@TAX:OnlyVatPayment");
  if (ret.voucherId) throw new UserError("@SYS:Locked");
  const [params] = await data.find("tax.parameters", {}, { take: 1 });
  if (!params?.taxOfficeVendorId) throw new UserError("@TAX:NoTaxOfficeVendor");
  const vendor = await data.get("ap.vendor", String(params.taxOfficeVendorId));
  if (!vendor) throw new UserError("@TAX:NoTaxOfficeVendor");
  const group = await data.get("ap.group", String(vendor.groupId));
  if (!group?.payableAccountId) throw new UserError("@TAX:NoTaxOfficeVendor");
  const company = companyId ? await data.get("sys.company", companyId) : null;

  const period = periodRange(ret);
  // vlastní daňová povinnost jako v přiznání (řádky v celých Kč)
  const c = await computeVat(data, ret, t);
  const sumKc = (lines: string[]) => lines.reduce((a, l) => a + kc(c.lines.get(l)?.[1] ?? BigInt(0)), BigInt(0));
  const result = (sumKc(OUTPUT_LINES) - sumKc(DEDUCT_LINES)) * BigInt(100);

  // zúčtování účtů DPH: výstup MD (vyrovná dal), vstup D (vyrovná má dáti)
  const byAccount = new Map<string, bigint>();
  const codes = new Map<string, RecordData | null>();
  for (const tr of await data.find("tax.trans", { taxDate: { gte: period.from, lte: period.to } }, { take: 100000 })) {
    const id = String(tr.taxCodeId);
    if (!codes.has(id)) codes.set(id, await data.get("tax.taxCode", id));
    const code = codes.get(id);
    if (!code) continue;
    const out = tr.direction === "output";
    const account = String(out ? (code.outputAccountId ?? code.accountId) : code.accountId);
    const tax = toCents(tr.tax ?? "0");
    byAccount.set(account, (byAccount.get(account) ?? BigInt(0)) + (out ? tax : -tax));
  }
  const lines: PostingLine[] = [...byAccount].filter(([, v]) => v !== BigInt(0)).map(([accountId, v]) => ({ accountId, amount: fromCents(v), text: t("@TAX:VatPaymentText", { period: period.code }) }));
  const raw = [...byAccount.values()].reduce((a, v) => a + v, BigInt(0));
  // závazek vůči FÚ (D), nadměrný odpočet = pohledávka (MD)
  lines.push({ accountId: String(group.payableAccountId), amount: fromCents(-result), viaSubledger: true, text: t("@TAX:VatPaymentText", { period: period.code }) });
  // zaokrouhlení na celé koruny
  const diff = result - raw;
  if (diff !== BigInt(0)) lines.push({ accountId: await systemAccount(data, diff > BigInt(0) ? "roundingLoss" : "roundingGain"), amount: fromCents(diff), text: null });
  if (!lines.some((l) => toCents(l.amount) !== BigInt(0))) throw new UserError("@TAX:VatPaymentZero");

  const voucher = await postVoucher(data, {
    date: period.to,
    description: t("@TAX:VatPaymentText", { period: period.code }),
    sourceObject: "tax.return",
    sourceId: String(ret.id),
    lines,
  });
  const vs = String(company?.vatId ?? "").replace(/\D/g, "").slice(-10) || null;
  const dueDate = vatDueDate(period.to);
  if (result !== BigInt(0))
    await data.create("ap.trans", {
      vendorId: vendor.id,
      voucherId: voucher.id,
      date: period.to,
      dueDate,
      kind: "invoice",
      documentNum: t("@TAX:VatPaymentText", { period: period.code }).slice(0, 40),
      vs,
      currencyId: await accountingCurrencyId(data, companyId),
      amount: fromCents(result),
      amountCur: fromCents(result),
      paidAmount: "0",
      closed: false,
    });
  await data.update("tax.return", String(ret.id), { voucherId: voucher.id, dueDate, paymentVs: vs, paymentAmount: fromCents(result) });
}

/** Akce Zaúčtovat závazek na Přiznání a podání (vlastní soubor kvůli importům: vat-payment → vat-return). */
export const vatPaymentHandlers: Record<string, ObjectHandlers> = {
  "tax.return": {
    actions: {
      async postPayment(ctx, ret) {
        await postVatPayment(ctx.data, ctx.companyId, ret, ctx.t);
      },
    },
  },
};
