/**
 * Položky: výchozí DPH ze skupiny a dopočet ceny bez DPH / s DPH.
 * Prodejní cena se zadává buď bez DPH, nebo včetně (maloobchod, pokladna);
 * druhá cena se dopočítá ze sazby daňového kódu.
 */
import { fromCents, toCents, toScaled } from "@/core/money";
import type { DataApi, ObjectHandlers, RecordData } from "@/core/module";

/** cena s DPH → bez DPH (zaokrouhleno na haléře) */
export function netFromGross(gross: bigint, rate: unknown): bigint {
  const r = toScaled(rate ?? 0, 4); // 21 % = 210000
  const base = BigInt(1_000_000);
  const num = gross * base;
  const den = base + r;
  const neg = num < BigInt(0);
  const a = neg ? -num : num;
  const q = (a + den / BigInt(2)) / den;
  return neg ? -q : q;
}

export function grossFromNet(net: bigint, rate: unknown): bigint {
  const r = toScaled(rate ?? 0, 4);
  const base = BigInt(1_000_000);
  const num = net * (base + r);
  const neg = num < BigInt(0);
  const a = neg ? -num : num;
  const q = (a + base / BigInt(2)) / base;
  return neg ? -q : q;
}

export async function itemPrices(data: DataApi, item: RecordData) {
  const code = item.taxCodeId ? await data.get("tax.taxCode", String(item.taxCodeId)) : null;
  const rate = code?.rate ?? 0;
  const price = toCents(item.salesPrice);
  return item.priceInclTax
    ? { net: netFromGross(price, rate), gross: price }
    : { net: price, gross: grossFromNet(price, rate) };
}

export const invHandlers: Record<string, ObjectHandlers> = {
  "inv.item": {
    async beforeSave(ctx, data) {
      if (!data.taxCodeId && data.groupId) {
        const g = await ctx.data.get("inv.itemGroup", String(data.groupId));
        data.taxCodeId = g?.taxCodeId ?? null;
      }
      // neplatnou cenu už hlásí validace pole
      if (data.salesPrice === null || data.salesPrice === undefined || !/^-?\d+(\.\d+)?$/.test(String(data.salesPrice))) {
        data.priceNet = null;
        data.priceGross = null;
        return;
      }
      const p = await itemPrices(ctx.data, data);
      data.priceNet = fromCents(p.net);
      data.priceGross = fromCents(p.gross);
    },
  },
};
