/**
 * DPH přes skupiny (jako v AX): skupina DPH (partner — kde a komu) × položka DPH (položka,
 * skupina položek, účet — co) → daňový kód pro prodej / nákup (`tax.taxGroupCode`).
 * Kód jde zadat i přímo; ručně zadaný kód se při změně skupin nepřepíše.
 *
 * Samovyměření (`reverseCharge`: přenesená povinnost, pořízení z EU, služby ze zahraničí):
 * daň se nefakturuje, ale přizná na výstupu (řádek kódu) a zároveň odečte na vstupu (`deductLine`)
 * — zaúčtování MD 343 / D 343, dvě daňové transakce.
 */
import { percentOf } from "@/core/money";
import type { DataApi, RecordData } from "@/core/module";

export type TaxSide = "sales" | "purchase";

/** Kód z kombinace skupiny a položky DPH (null = kombinace nenastavená). */
export async function taxCodeFor(data: DataApi, taxGroupId: unknown, itemTaxGroupId: unknown, side: TaxSide): Promise<string | null> {
  if (!taxGroupId || !itemTaxGroupId) return null;
  const [row] = await data.find("tax.taxGroupCode", { taxGroupId: String(taxGroupId), itemTaxGroupId: String(itemTaxGroupId) }, { take: 1 });
  const id = row?.[side === "sales" ? "salesCodeId" : "purchaseCodeId"];
  return id ? String(id) : null;
}

/**
 * Kód řádku podle skupin: nový kód z kombinace jen tam, kde uživatel kód nezadal ručně —
 * prázdný kód, nebo kód, který dala předchozí kombinace skupin.
 */
export async function resolveLineCode(
  data: DataApi,
  line: RecordData,
  before: RecordData | null,
  side: TaxSide,
): Promise<void> {
  const now = await taxCodeFor(data, line.taxGroupId, line.itemTaxGroupId, side);
  if (!now) return;
  const prev = before ? await taxCodeFor(data, before.taxGroupId, before.itemTaxGroupId, side) : null;
  if (!line.taxCodeId || line.taxCodeId === prev) line.taxCodeId = now;
}

/** Skupina DPH partnera (partner, jinak jeho skupina partnerů). */
export async function partnerTaxGroup(data: DataApi, partnerObject: string, groupObject: string, partnerId: unknown): Promise<string | null> {
  if (!partnerId) return null;
  const p = await data.get(partnerObject, String(partnerId));
  if (!p) return null;
  if (p.taxGroupId) return String(p.taxGroupId);
  const g = p.groupId ? await data.get(groupObject, String(p.groupId)) : null;
  return g?.taxGroupId ? String(g.taxGroupId) : null;
}

/** Daňové transakce jednoho kódu: běžně jedna, u samovyměření výstup + nárok na vstupu. */
export function taxTransParts(code: RecordData, base: string, tax: string): Record<string, unknown>[] {
  const common = { taxCodeId: code.id, base, tax, khItemCode: code.khItemCode ?? null };
  if (!code.reverseCharge) return [{ ...common, direction: code.direction, reportLine: code.reportLine ?? null, khSection: code.khSection ?? null }];
  return [
    { ...common, direction: "output", reportLine: code.reportLine ?? null, khSection: code.khSection ?? null },
    // nárok na odpočet do KH nepatří (oddíl „-“)
    { ...common, direction: "input", reportLine: code.deductLine ?? null, khSection: "-" },
  ];
}

/**
 * Daň z částky řádku (v haléřích, se znaménkem strany, která nese DPH — účet nákladů / výnosů):
 *   včetně DPH: daň = částka × sazba / (100 + sazba), základ = částka − daň, vyrovnanost beze změny,
 *   bez DPH:    základ = částka, daň = základ × sazba / 100, o daň se doklad navýší (`extra`),
 *   samovyměření: základ = částka, daň se zaúčtuje MD i D 343 — vyrovnanost beze změny.
 */
export function lineTax(code: RecordData, amount: bigint, includeTax: boolean): { base: bigint; tax: bigint; extra: bigint } {
  const zero = BigInt(0);
  const rate = Number(code.rate ?? 0);
  if (!rate) return { base: amount, tax: zero, extra: zero };
  if (code.reverseCharge) return { base: amount, tax: percentOf(amount, rate), extra: zero };
  if (!includeTax) {
    const tax = percentOf(amount, rate);
    return { base: amount, tax, extra: tax };
  }
  // daň z částky včetně DPH, zaokrouhlení na haléře od nuly
  const neg = amount < zero;
  const a = neg ? -amount : amount;
  const scale = BigInt(Math.round(rate * 10000));
  const num = a * scale;
  const den = BigInt(1000000) + scale;
  let tax = num / den;
  if ((num % den) * BigInt(2) >= den) tax += BigInt(1);
  if (neg) tax = -tax;
  return { base: amount - tax, tax, extra: zero };
}

/** Strana řádku deníku, která nese DPH: účet hlavní knihy (účet, jinak protiúčet); bez něj účet řádku. */
export function taxOnMain(l: RecordData): boolean {
  if (String(l.accountType ?? "ledger") === "ledger") return true;
  return !(l.offsetType === "ledger" && l.offsetAccountId);
}
