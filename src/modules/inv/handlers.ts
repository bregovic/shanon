/**
 * Položky: výchozí DPH ze skupiny a dopočet ceny bez DPH / s DPH.
 * Prodejní cena se zadává buď bez DPH, nebo včetně (maloobchod, pokladna);
 * druhá cena se dopočítá ze sazby daňového kódu.
 */
import { fromCents, percentOf, toCents, toScaled } from "@/core/money";
import { slugify } from "@/lib/slug";

import { UserError, type DataApi, type ObjectHandlers, type RecordData, type ValidationErrors } from "@/core/module";

/** „Klobása (Antoni)“ → „Klobása“ — dodavatel v závorce na konci názvu. */
const baseName = (n: unknown) => String(n ?? "").replace(/\s*\([^()]*\)\s*$/, "").trim();

/**
 * Sloučit položky (stejný výrobek od více dodavatelů): stejná jednotka a zadání ceny, prodejní cena vyšší z cen,
 * dodavatel jen když je u všech stejný, název bez „(dodavatel)“, když se jinak shoduje; obrázek / kategorie / popis
 * z první položky, která je má; v e-shopu, když je v něm kterákoli.
 */
const itemMergeHandler: ObjectHandlers = {
  merge(_ctx, t, others) {
    const all = [t, ...others];
    const one = (f: string) => new Set(all.map((r) => String(r[f] ?? ""))).size === 1;
    if (!one("unitId")) throw new UserError("@INV:MergeUnit");
    if (!one("priceInclTax") || !one("currencyId")) throw new UserError("@INV:MergePriceMode");
    const p: RecordData = {};
    const price = all.map((r) => r.salesPrice).filter((v) => v !== null && v !== undefined && v !== "").sort((a, b) => Number(b) - Number(a))[0];
    if (price !== undefined && String(price) !== String(t.salesPrice)) p.salesPrice = price;
    if (!one("vendorId")) {
      p.vendorId = null;
      p.vendorItemName = null;
    }
    const base = baseName(t.name);
    if (base && base !== t.name && all.every((r) => baseName(r.name).toLowerCase() === base.toLowerCase())) p.name = base;
    for (const f of ["image", "categoryId", "description", "brand", "ean"]) if (!t[f]) {
      const v = others.find((r) => r[f])?.[f];
      if (v) p[f] = v;
    }
    if (!t.eshop && others.some((r) => r.eshop)) p.eshop = true;
    return p;
  },
};

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
    ...itemMergeHandler,
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
  "inv.category": {
    async beforeSave(ctx, d): Promise<ValidationErrors | void> {
      // zákaz cyklu ve stromu (A → B → A)
      let p = d.parentId ? String(d.parentId) : null;
      for (let i = 0; p && i < 20; i++) {
        if (p === d.id) return { parentId: "@INV:CategoryLoop" };
        p = ((await ctx.data.get("inv.category", p))?.parentId as string) ?? null;
      }
      // adresa v e-shopu: prázdná = z názvu, jedinečná ve firmě
      if (!d.slug || ("name" in d && !d.slug)) {
        const base = slugify(String(d.name ?? d.code ?? ""), "kategorie");
        let slug = base;
        for (let n = 2; (await ctx.data.find("inv.category", { slug }, { take: 2 })).some((c) => c.id !== d.id); n++) slug = `${base.slice(0, 55)}-${n}`;
        d.slug = slug;
      } else if ((await ctx.data.find("inv.category", { slug: d.slug }, { take: 2 })).some((c) => c.id !== d.id)) return { slug: "@SYS:Duplicate" };
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
