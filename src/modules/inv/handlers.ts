/**
 * Položky: výchozí DPH ze skupiny a dopočet ceny bez DPH / s DPH.
 * Prodejní cena se zadává buď bez DPH, nebo včetně (maloobchod, pokladna);
 * druhá cena se dopočítá ze sazby daňového kódu.
 */
import { fromCents, percentOf, toCents, toScaled } from "@/core/money";
import type { DataApi, ObjectHandlers, RecordData, ValidationErrors } from "@/core/module";

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
      // marže z prodejní ceny bez DPH
      const buy = data.purchasePrice !== null && data.purchasePrice !== undefined && data.purchasePrice !== "" ? toCents(data.purchasePrice) : null;
      data.marginPct = buy !== null && p.net > BigInt(0) ? (Number(((p.net - buy) * BigInt(1000000)) / p.net) / 10000).toFixed(2) : null;
    },
  },
  "inv.discount": {
    beforeSave(_ctx, d): ValidationErrors | void {
      if (d.itemId && d.groupId) return { groupId: "@INV:DiscountTarget" };
      if (d.kind === "percent" && !(Number(d.percent) > 0 && Number(d.percent) <= 100)) return { percent: "@INV:DiscountValue" };
      if (d.kind === "price" && !(Number(d.price) >= 0 && d.price !== null && d.price !== "")) return { price: "@INV:DiscountValue" };
      if (d.validFrom && d.validTo && String(d.validTo) < String(d.validFrom)) return { validTo: "@SYS:InvalidDate" };
    },
  },
};

/**
 * Nejvýhodnější platná sleva pro položku k datu: cena s DPH po slevě
 * (v haléřích) a sleva, nebo null. Akční cena dražší než běžná se nepoužije.
 */
export async function bestDiscount(data: DataApi, item: RecordData, gross: bigint, date: string) {
  let all: RecordData[];
  try {
    all = await data.find("inv.discount", { active: true }, { take: 1000 });
  } catch {
    return null;
  }
  let best: { price: bigint; discount: RecordData } | null = null;
  for (const d of all) {
    if (d.itemId && d.itemId !== item.id) continue;
    if (d.groupId && d.groupId !== item.groupId) continue;
    if ((d.validFrom && String(d.validFrom) > date) || (d.validTo && String(d.validTo) < date)) continue;
    const price = d.kind === "price" ? toCents(d.price) : gross - percentOf(gross, d.percent);
    if (price < gross && (!best || price < best.price)) best = { price, discount: d };
  }
  return best;
}
