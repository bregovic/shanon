/**
 * Platební podmínky (splatnost): číselník `tax.paymentTerm` s počtem dní.
 * Doklad (faktura, záloha) bere podmínku partnera, jinak jeho skupiny; bez podmínky je splatnost
 * rovna datu vystavení (0 dní).
 */
import type { DataApi, RecordData } from "@/core/module";

/** výchozí sada pro firmu, která ještě žádnou podmínku nemá: [kód, název, dní] */
export const DEFAULT_PAYMENT_TERMS: [string, string, number][] = [
  ["0", "Ihned", 0],
  ["14", "14 dní", 14],
  ["30", "30 dní", 30],
];

/** id platební podmínky dokladu: partner → skupina partnera */
export const paymentTermIdOf = (partner: RecordData | null, group: RecordData | null): string | null =>
  (partner?.paymentTermId as string) || (group?.paymentTermId as string) || null;

/** počet dní splatnosti podle podmínky (bez podmínky 0) */
export async function paymentDaysOf(data: DataApi, partner: RecordData | null, group: RecordData | null): Promise<number> {
  const id = paymentTermIdOf(partner, group);
  if (!id) return 0;
  const term = await data.get("tax.paymentTerm", id);
  return Math.max(0, Number(term?.days ?? 0) || 0);
}

/** výchozí nastavení: založí sadu 0 / 14 / 30 dní, jen když firma nemá žádnou podmínku */
export async function paymentTermSetup(data: DataApi) {
  if ((await data.find("tax.paymentTerm", {}, { take: 1 })).length) return;
  for (const [code, name, days] of DEFAULT_PAYMENT_TERMS) await data.create("tax.paymentTerm", { code, name, days });
}
