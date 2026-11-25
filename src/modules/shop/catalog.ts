/**
 * E-shop — katalog, košík a objednávka (logika nad DataApi, bez webu).
 *
 * Ceny počítá vždy server: cena položky s DPH (v měně obchodu) po nejvýhodnější slevě, řádek =
 * množství × cena s DPH; objednávka má „Ceny včetně DPH“, takže součet sedí na košík. Dostupnost
 * = zásoba − rezervace (sklad obchodu, jinak všechny sklady), jen u skladových položek.
 */
import { isEmail } from "@/core/edt";
import { fromCents, mulCents, toCents } from "@/core/money";
import { UserError, type DataApi, type RecordData } from "@/core/module";
import { accountingCurrencyId, convertPrice } from "@/modules/gl/posting";
import { bestDiscount, itemPrices } from "@/modules/inv/handlers";
import { notify } from "@/modules/sys/notify";
import { slugify } from "@/lib/slug";
import { usable } from "@/modules/int/live-guard";

const zero = BigInt(0);
/** Datum a hodina v Praze (server běží v UTC — kolem půlnoci by „dnes“ byl jiný den). */
const PRAGUE = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
function pragueNow(at = new Date()) {
  const p = Object.fromEntries(PRAGUE.formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
const today = () => pragueNow().date;

export { slugify, pragueNow };

export interface ShopProduct {
  id: string;
  itemNum: string;
  name: string;
  slug: string;
  description: string;
  unit: string;
  weighed: boolean;
  /** cena s DPH po slevě a běžná cena (když je sleva) */
  price: string;
  regularPrice: string | null;
  categoryId: string | null;
  image: string | null;
  /** volná zásoba (null = neskladová položka nebo bez skladu) */
  stock: number | null;
  orderable: boolean;
}

export async function shopCurrency(data: DataApi): Promise<string> {
  const c = await accountingCurrencyId(data, data.companyId ?? null);
  if (!c) throw new UserError("@SYS:InvalidValue");
  return c;
}

/** Cena položky s DPH v měně obchodu: po slevě a běžná. */
async function priceOf(data: DataApi, item: RecordData, currencyId: string, date: string) {
  let regular = (await itemPrices(data, item)).gross;
  if (item.currencyId && item.currencyId !== currencyId) regular = toCents(await convertPrice(data, data.companyId ?? null, fromCents(regular), String(item.currencyId), currencyId, date));
  const d = await bestDiscount(data, item, regular, date);
  return { price: d ? d.price : regular, regular: d ? regular : null };
}

/**
 * Čtení pro výpis zboží: číselníky (sazba DPH, MJ, měna, slevy) jednou za výpis místo dotazu za každou položku.
 * Zásoba a rezervace celého výpisu dvěma dotazy (`stockOf`). Jen čtení — zápisy jdou beze změny.
 */
const LOOKUPS = new Set(["tax.taxCode", "inv.unit", "sys.currency", "inv.discount", "gl.parameters"]);
function catalogReads(data: DataApi): DataApi {
  const memo = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, fn: () => Promise<T>) => {
    if (!memo.has(key)) memo.set(key, fn());
    return memo.get(key) as Promise<T>;
  };
  return {
    ...data,
    get: (o, id) => (LOOKUPS.has(o) ? once(`g:${o}:${id}`, () => data.get(o, id)) : data.get(o, id)),
    find: (o, where, opts) => (LOOKUPS.has(o) ? once(`f:${o}:${JSON.stringify(where)}:${JSON.stringify(opts ?? {})}`, () => data.find(o, where, opts)) : data.find(o, where, opts)),
  };
}

/** Volná zásoba položek výpisu najednou (null = sklad vypnutý). Chybějící položka = 0. */
async function stockOf(data: DataApi, shop: RecordData, items: RecordData[]): Promise<Map<string, number> | null> {
  const ids = items.filter((i) => !i.itemType || i.itemType === "item").map((i) => String(i.id));
  const out = new Map<string, number>();
  try {
    for (let k = 0; k < ids.length; k += 200) {
      const where: RecordData = { itemId: { in: ids.slice(k, k + 200) }, ...(shop.warehouseId ? { warehouseId: shop.warehouseId } : {}) };
      for (const r of await data.find("whs.onhand", where, { take: 100000 })) out.set(String(r.itemId), (out.get(String(r.itemId)) ?? 0) + Number(r.qty ?? 0));
      for (const r of await data.find("whs.reservation", where, { take: 100000 })) out.set(String(r.itemId), (out.get(String(r.itemId)) ?? 0) - Number(r.qty ?? 0));
    }
  } catch {
    return null; // modul Sklad vypnutý
  }
  return out;
}

/** Volná zásoba skladové položky (null = sklad vypnutý nebo neskladová položka). */
async function freeStock(data: DataApi, shop: RecordData, item: RecordData, pre?: Map<string, number> | null): Promise<number | null> {
  if (item.itemType && item.itemType !== "item") return null;
  if (pre !== undefined) return pre === null ? null : Math.max(0, pre.get(String(item.id)) ?? 0);
  try {
    const where: RecordData = { itemId: item.id, ...(shop.warehouseId ? { warehouseId: shop.warehouseId } : {}) };
    const onhand = (await data.find("whs.onhand", where, { take: 1000 })).reduce((a, r) => a + Number(r.qty ?? 0), 0);
    const reserved = (await data.find("whs.reservation", where, { take: 5000 })).reduce((a, r) => a + Number(r.qty ?? 0), 0);
    return Math.max(0, onhand - reserved);
  } catch {
    return null; // modul Sklad vypnutý
  }
}

async function toProduct(data: DataApi, shop: RecordData, item: RecordData, currencyId: string, date: string, units: Map<string, string>, pre?: Map<string, number> | null): Promise<ShopProduct> {
  const p = await priceOf(data, item, currencyId, date);
  const stock = await freeStock(data, shop, item, pre);
  const uid = String(item.unitId ?? "");
  if (uid && !units.has(uid)) units.set(uid, String((await data.get("inv.unit", uid))?.code ?? ""));
  return {
    id: String(item.id),
    itemNum: String(item.itemNum),
    name: String(item.name),
    slug: slugify(String(item.name)),
    description: String(item.description ?? ""),
    unit: units.get(uid) ?? "",
    weighed: !!item.weighed,
    price: fromCents(p.price),
    regularPrice: p.regular !== null ? fromCents(p.regular) : null,
    categoryId: (item.categoryId as string) ?? null,
    image: (item.image as string) || null,
    stock,
    orderable: shop.sellOutOfStock !== false || stock === null || stock > 0,
  };
}

/** Položky obchodu (volitelně kategorie včetně podkategorií a hledání v názvu / čísle). */
export async function listProducts(api: DataApi, shop: RecordData, opts: { categoryId?: string | null; q?: string; take?: number } = {}): Promise<ShopProduct[]> {
  const data = catalogReads(api);
  const currencyId = await shopCurrency(data);
  const date = today();
  let items = await data.find("inv.item", { eshop: true, blocked: false }, { take: 2000, orderBy: { name: "asc" } });
  if (opts.categoryId) {
    const cats = await data.find("inv.category", {}, { take: 2000 });
    const ids = new Set([opts.categoryId]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const c of cats)
        if (c.parentId && ids.has(String(c.parentId)) && !ids.has(String(c.id))) {
          ids.add(String(c.id));
          grew = true;
        }
    }
    items = items.filter((i) => i.categoryId && ids.has(String(i.categoryId)));
  }
  const q = (opts.q ?? "").trim().toLowerCase();
  if (q) items = items.filter((i) => `${i.name} ${i.itemNum} ${i.brand ?? ""}`.toLowerCase().includes(q));
  const units = new Map<string, string>();
  const out: ShopProduct[] = [];
  const page = items.slice(0, opts.take ?? 500);
  const pre = await stockOf(data, shop, page);
  for (const i of page) out.push(await toProduct(data, shop, i, currencyId, date, units, pre));
  return out;
}

/** Položka obchodu podle čísla (null = není v e-shopu). */
export async function productByNum(data: DataApi, shop: RecordData, itemNum: string): Promise<ShopProduct | null> {
  const [item] = await data.find("inv.item", { itemNum, eshop: true, blocked: false }, { take: 1 });
  return item ? toProduct(data, shop, item, await shopCurrency(data), today(), new Map()) : null;
}

// ---------------------------------------------------------------------------
// Košík
// ---------------------------------------------------------------------------

export interface CartLineInput {
  itemId: string;
  qty: string | number;
}
export interface QuoteInput {
  lines: CartLineInput[];
  deliveryId?: string | null;
  paymentMethodId?: string | null;
  /** den vyzvednutí RRRR-MM-DD a požadovaná hodina (volitelná) */
  pickupDate?: string | null;
  pickupHour?: number | null;
  /** dnes, co nejdřív (den = dnes, bez hodiny) */
  pickupAsap?: boolean;
}
export interface QuoteLine {
  itemId: string;
  itemNum: string;
  name: string;
  unit: string;
  weighed: boolean;
  qty: string;
  price: string;
  amount: string;
  image: string | null;
  /** vážené zboží: rezerva v % a cena nejvýše */
  bufferPct?: string;
  maxAmount?: string;
  error?: string;
}
export interface Quote {
  currency: string;
  lines: QuoteLine[];
  itemsTotal: string;
  deliveries: { id: string; name: string; kind: string; price: string; description: string }[];
  payments: { id: string; name: string; kind: string }[];
  deliveryId: string | null;
  paymentMethodId: string | null;
  deliveryPrice: string;
  total: string;
  /** obsahuje vážené zboží: částka se upřesní po zvážení, nejvýše `totalMax` */
  estimated: boolean;
  totalMax: string;
  /** vyzvednutí: nabízené dny a hodiny */
  pickup: { today: string; minDate: string; maxDate: string; fromHour: number | null; toHour: number | null };
  /** chyby celé objednávky (minimální objednávka, nedostupná platba…) jako labely */
  errors: string[];
}

/** Platby pro e-shop povolené u dopravy: převod vždy, dobírka jen u dopravy s dobírkou, hotově jen při odběru, karta jen s bránou. */
function paymentAllowed(pm: RecordData, delivery: RecordData | null, gateway: boolean, estimated = false): boolean {
  if (pm.kind === "transfer") return true;
  if (pm.kind === "cod") return !!delivery?.allowCod;
  if (pm.kind === "cash") return delivery?.kind === "pickup";
  // vážené zboží zatím bez platby kartou předem (cena se upřesní po zvážení)
  return pm.kind === "card" && gateway && !estimated;
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Nabídka vyzvednutí podle obchodu: dny od–do, hodiny od–do (bez hodin = jen den). Po zavírací hodině už ne dnes. */
export function pickupWindow(shop: RecordData, date = today(), hour = pragueNow().hour) {
  const lead = Math.max(0, Number(shop.pickupLeadDays ?? 0));
  const span = Math.max(lead, Number(shop.pickupMaxDays ?? 14));
  const from = shop.pickupFrom === null || shop.pickupFrom === undefined || shop.pickupFrom === "" ? null : Number(shop.pickupFrom);
  const to = shop.pickupTo === null || shop.pickupTo === undefined || shop.pickupTo === "" ? null : Number(shop.pickupTo);
  const closed = lead === 0 && to !== null && Number.isFinite(to) && hour >= to;
  return { today: date, minDate: addDays(date, closed ? 1 : lead), maxDate: addDays(date, span), fromHour: from, toHour: to };
}

/** Rezerva ceny váženého zboží v %: položka, jinak obchod (výchozí 10). */
export function bufferOf(item: RecordData, shop: RecordData): number {
  const own = item.weighBufferPct;
  const v = own !== null && own !== undefined && own !== "" ? Number(own) : Number(shop.weighBufferPct ?? 10);
  return Number.isFinite(v) && v >= 0 ? Math.min(v, 100) : 10;
}

/** Aktivní platební brána pro e-shop (Comgate), nebo null. */
export async function gatewayConnection(data: DataApi): Promise<RecordData | null> {
  try {
    const list = usable(await data.find("int.connection", { kind: "payment", active: true }, { take: 50, orderBy: { code: "asc" } })).filter((c) => c.driver === "comgate" || c.driver === "gatewaySim");
    // testovací prostředí: testovací kopie Comgate, pak simulátor brány, pak ostrá brána
    return list.find((c) => c.code === "TEST-COMGATE") ?? list.find((c) => String(c.code).startsWith("TEST-")) ?? list[0] ?? null;
  } catch {
    return null; // modul Integrace vypnutý
  }
}

const QTY_MAX = 9999;

/** Košík → ceny, doprava, platby a součet (vše ze serveru). */
export async function quote(data: DataApi, shop: RecordData, input: QuoteInput): Promise<Quote> {
  const currencyId = await shopCurrency(data);
  const cur = await data.get("sys.currency", currencyId);
  const date = today();
  const errors: string[] = [];
  const lines: QuoteLine[] = [];
  const units = new Map<string, string>();
  let itemsTotal = zero;
  let itemsMax = zero;
  const seen = new Map<string, QuoteLine>();
  for (const l of input.lines.slice(0, 100)) {
    const item = l.itemId && /^[0-9a-f-]{36}$/i.test(String(l.itemId)) ? await data.get("inv.item", String(l.itemId)) : null;
    if (!item || !item.eshop || item.blocked) continue; // položka mezitím z obchodu zmizela
    const p = await toProduct(data, shop, item, currencyId, date, units);
    // množství: kladné, kusové zboží celé, vážené na 3 desetinná místa
    const raw = String(l.qty ?? "").replace(",", ".").trim();
    let qty = Number(raw);
    if (!Number.isFinite(qty) || qty <= 0) qty = 1;
    qty = Math.min(QTY_MAX, item.weighed ? Math.round(qty * 1000) / 1000 : Math.max(1, Math.round(qty)));
    const prev = seen.get(p.id);
    if (prev) qty = Math.min(QTY_MAX, Number(prev.qty) + qty);
    const amount = mulCents(String(qty), 4, p.price, 2);
    const line: QuoteLine = { itemId: p.id, itemNum: p.itemNum, name: p.name, unit: p.unit, weighed: p.weighed, qty: String(qty), price: p.price, amount: fromCents(amount), image: p.image };
    if (p.weighed) {
      const buf = bufferOf(item, shop);
      line.bufferPct = String(buf);
      line.maxAmount = fromCents(mulCents(String(Math.round(qty * (1 + buf / 100) * 1000) / 1000), 4, p.price, 2));
    }
    if (shop.sellOutOfStock === false && p.stock !== null && qty > p.stock) line.error = "@SHOP:ErrStock";
    if (prev) {
      itemsTotal -= toCents(prev.amount);
      itemsMax -= toCents(prev.maxAmount ?? prev.amount);
      Object.assign(prev, line);
    } else {
      lines.push(line);
      seen.set(p.id, line);
    }
    itemsTotal += amount;
    itemsMax += toCents(line.maxAmount ?? line.amount);
  }
  const estimated = lines.some((l) => l.weighed);
  const deliveries = await data.find("shop.delivery", { active: true }, { take: 50, orderBy: { position: "asc" } });
  const delivery = deliveries.find((d) => d.id === input.deliveryId) ?? deliveries[0] ?? null;
  const free = shop.freeShippingFrom !== null && shop.freeShippingFrom !== undefined && shop.freeShippingFrom !== "" && itemsTotal >= toCents(shop.freeShippingFrom);
  const deliveryPrice = delivery && !free ? toCents(delivery.price ?? 0) : zero;
  const gateway = !!(await gatewayConnection(data));
  const allPm = (await data.find("bank.paymentMethod", { eshop: true, blocked: false }, { take: 50, orderBy: { code: "asc" } })).filter((pm) => paymentAllowed(pm, delivery, gateway, estimated));
  const pm = allPm.find((x) => x.id === input.paymentMethodId) ?? allPm[0] ?? null;
  if (!lines.length) errors.push("@SHOP:ErrEmpty");
  if (!delivery) errors.push("@SHOP:ErrNoDelivery");
  if (!pm) errors.push("@SHOP:ErrNoPayment");
  if (shop.minOrder && itemsTotal < toCents(shop.minOrder)) errors.push("@SHOP:ErrMinOrder");
  if (lines.some((l) => l.error)) errors.push("@SHOP:ErrStock");
  return {
    currency: String(cur?.code ?? "CZK"),
    lines,
    itemsTotal: fromCents(itemsTotal),
    deliveries: deliveries.map((d) => ({
      id: String(d.id),
      name: String(d.name),
      kind: String(d.kind),
      price: fromCents(free ? zero : toCents(d.price ?? 0)),
      description: String(d.description ?? ""),
    })),
    payments: allPm.map((x) => ({ id: String(x.id), name: String(x.name), kind: String(x.kind) })),
    deliveryId: delivery ? String(delivery.id) : null,
    paymentMethodId: pm ? String(pm.id) : null,
    deliveryPrice: fromCents(deliveryPrice),
    total: fromCents(itemsTotal + deliveryPrice),
    estimated,
    totalMax: fromCents(itemsMax + deliveryPrice),
    pickup: pickupWindow(shop, date),
    errors,
  };
}

// ---------------------------------------------------------------------------
// Objednávka
// ---------------------------------------------------------------------------

export interface BuyerInput {
  name: string;
  email: string;
  phone?: string;
  companyName?: string;
  regNo?: string;
  vatId?: string;
  street?: string;
  city?: string;
  zip?: string;
  country?: string;
  note?: string;
}
export interface OrderInput extends QuoteInput {
  buyer: BuyerInput;
  /** souhlas s obchodními podmínkami (povinný) */
  terms: boolean;
}
export interface OrderResult {
  ok: boolean;
  errors?: Record<string, string>;
  orderNum?: string;
  token?: string;
  /** platba bránou — po uložení se založí platba a kupující jde na platební stránku */
  card?: boolean;
}

const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

/** Údaje kupujícího → chyby polí (labely). */
function checkBuyer(b: BuyerInput, address: boolean): Record<string, string> {
  const e: Record<string, string> = {};
  if (!clip(b.name, 120)) e.name = "@SYS:Required";
  if (!isEmail(clip(b.email, 254))) e.email = "@SYS:InvalidEmail";
  if (b.regNo && !/^\d{8}$/.test(clip(b.regNo, 20).replace(/\s/g, ""))) e.regNo = "@SHOP:ErrRegNo";
  if (address) {
    if (!clip(b.street, 255)) e.street = "@SYS:Required";
    if (!clip(b.city, 255)) e.city = "@SYS:Required";
    if (!clip(b.zip, 10)) e.zip = "@SYS:Required";
  }
  return e;
}

/**
 * Objednávka z webu: objednávka obchodu (kupující, doprava, platba) + prodejní objednávka s řádky
 * (ceny s DPH) potvrzená = rezervace skladu; převod → záloha s VS (QR platba). Limit objednávek
 * z jedné adresy za hodinu (`ipHash`).
 */
export async function placeOrder(data: DataApi, shop: RecordData, input: OrderInput, ipHash: string, token: string): Promise<OrderResult> {
  const q = await quote(data, shop, input);
  if (q.errors.length) return { ok: false, errors: { _: q.errors[0] } };
  const delivery = (await data.get("shop.delivery", String(q.deliveryId)))!;
  const pm = (await data.get("bank.paymentMethod", String(q.paymentMethodId)))!;
  const fieldErrors = checkBuyer(input.buyer, delivery.kind === "address");
  if (!input.terms) fieldErrors.terms = "@SHOP:ErrTerms";
  // vyzvednutí: den v nabízeném rozmezí, hodina v otevírací době (volitelná)
  const win = q.pickup;
  const asap = !!input.pickupAsap && win.minDate === today();
  const pickupDate = asap ? today() : /^\d{4}-\d{2}-\d{2}$/.test(String(input.pickupDate ?? "")) ? String(input.pickupDate) : null;
  if (delivery.kind === "pickup" && (!pickupDate || pickupDate < win.minDate || pickupDate > win.maxDate)) fieldErrors.pickupDate = "@SHOP:ErrPickupDate";
  const hour = asap || input.pickupHour === null || input.pickupHour === undefined || String(input.pickupHour) === "" ? null : Math.trunc(Number(input.pickupHour));
  if (hour !== null && (!Number.isFinite(hour) || (win.fromHour !== null && hour < win.fromHour) || (win.toHour !== null && hour > win.toHour))) fieldErrors.pickupHour = "@SHOP:ErrPickupHour";
  if (q.estimated && pm.kind === "card") fieldErrors._ = "@SHOP:ErrCardWeighed";
  if (Object.keys(fieldErrors).length) return { ok: false, errors: fieldErrors };
  // limit z jedné adresy
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const recent = (await data.find("shop.order", { ipHash, orderedAt: { gte: hourAgo } }, { take: 100 })).length;
  if (recent >= Math.max(1, Number(shop.orderHourLimit ?? 5))) return { ok: false, errors: { _: "@SHOP:ErrLimit" } };

  const b = input.buyer;
  const currencyId = await shopCurrency(data);
  const so = await data.create("shop.order", {
    status: "new",
    orderedAt: new Date().toISOString(),
    buyerName: clip(b.name, 120),
    email: clip(b.email, 254),
    phone: clip(b.phone, 30) || null,
    companyName: clip(b.companyName, 120) || null,
    regNo: clip(b.regNo, 20).replace(/\s/g, "") || null,
    vatId: clip(b.vatId, 255).replace(/\s/g, "").toUpperCase() || null,
    street: clip(b.street, 255) || null,
    city: clip(b.city, 255) || null,
    zip: clip(b.zip, 10) || null,
    country: /^[A-Za-z]{2}$/.test(clip(b.country, 2)) ? clip(b.country, 2).toUpperCase() : "CZ",
    note: clip(b.note, 2000) || null,
    pickupDate: delivery.kind === "pickup" ? pickupDate : null,
    pickupHour: delivery.kind === "pickup" ? hour : null,
    pickupAsap: delivery.kind === "pickup" && asap,
    estimated: q.estimated,
    amountMax: q.estimated ? q.totalMax : null,
    deliveryId: delivery.id,
    paymentMethodId: pm.id,
    currencyId,
    token,
    ipHash,
  });
  const num = String(so.orderNum);
  // prodejní objednávka (ceny s DPH) s řádky položek a dopravou
  const o = await data.create("ar.order", {
    customerId: shop.customerId,
    externalRef: num,
    orderDate: today(),
    currencyId,
    pricesInclTax: true,
    ...(shop.warehouseId ? { warehouseId: shop.warehouseId } : {}),
    description: clip(`${num} · ${so.buyerName}${so.companyName ? ` (${so.companyName})` : ""}`, 255),
  });
  for (const l of q.lines) {
    const ol = await data.create("ar.orderLine", { orderId: o.id, itemId: l.itemId, description: l.name, qty: l.qty, unitPrice: l.price });
    // řádek vychystání: objednáno, nejvýše (rezerva váženého zboží)
    const max = l.weighed ? Math.round(Number(l.qty) * (1 + Number(l.bufferPct ?? 0) / 100) * 1000) / 1000 : Number(l.qty);
    await data.create("shop.pick", { shopOrderId: so.id, orderLineId: ol.id, itemId: l.itemId, name: clip(l.name, 255), unit: l.unit || null, weighed: l.weighed, orderedQty: l.qty, maxQty: String(max) });
  }
  if (toCents(q.deliveryPrice) > zero || q.lines.length)
    await data.create("ar.orderLine", { orderId: o.id, description: String(delivery.name), qty: "1", unitPrice: q.deliveryPrice, taxCodeId: delivery.taxCodeId ?? null });
  // potvrzení = rezervace zásoby (modul Sklad)
  await data.update("ar.order", String(o.id), { status: "confirmed" });
  const order = (await data.get("ar.order", String(o.id)))!;
  let advanceId: string | null = null;
  // převod: záloha s QR; vážené zboží se platí až fakturou po zvážení
  if (pm.kind === "transfer" && !q.estimated) {
    const adv = await data.create("ar.advance", { customerId: shop.customerId, orderId: o.id, currencyId, amount: order.amountGross, description: clip(`E-shop ${num}`, 255) });
    advanceId = String(adv.id);
  }
  await data.update("shop.order", String(so.id), {
    arOrderId: o.id,
    advanceId,
    amountGross: order.amountGross,
    // převod a karta čekají na platbu (záloha / brána), dobírka a hotově jdou rovnou k vyřízení;
    // vážené zboží převodem: k vychystání, zaplatí se faktura po zvážení
    status: q.estimated && pm.kind === "transfer" ? "toPick" : pm.kind === "transfer" || pm.kind === "card" ? "awaitingPayment" : "paid",
  });
  await notify(data, {
    kind: "info",
    title: "@SHOP:NotifyOrder",
    params: { num, amount: `${Number(order.amountGross).toLocaleString("cs-CZ", { minimumFractionDigits: 2 })} ${q.currency}` },
    href: `/shop/order?focus=${so.id}`,
    key: `shop-order-${so.id}`,
  });
  return { ok: true, orderNum: num, token, card: pm.kind === "card" };
}

/** Zaplaceno bránou (ověřený stav u brány): objednávka k vyřízení + upozornění. Opakované volání nic nemění. */
export async function markGatewayPaid(data: DataApi, logId: string): Promise<boolean> {
  const [so] = await data.find("shop.order", { paymentLogId: logId }, { take: 1 });
  if (!so || so.status !== "awaitingPayment") return false;
  await data.update("shop.order", String(so.id), { status: "paid" });
  await notify(data, { kind: "info", title: "@SHOP:NotifyPaid", params: { num: String(so.orderNum) }, href: `/shop/order?focus=${so.id}`, key: `shop-paid-${so.id}` });
  return true;
}

export interface OrderView {
  orderNum: string;
  status: string;
  orderedAt: string;
  buyerName: string;
  email: string;
  delivery: string;
  payment: string;
  paymentKind: string;
  currency: string;
  lines: { name: string; qty: string; amount: string }[];
  total: string;
  /** platba převodem, dokud není uhrazená */
  transfer: { account: string; iban: string; vs: string; amount: string; dueDate: string | null } | null;
  /** platba bránou čeká (tlačítko Zaplatit) */
  cardPending: boolean;
  pickupDate: string | null;
  pickupHour: number | null;
  pickupAsap: boolean;
  /** cena se upřesní po zvážení (nejvýše `totalMax`) */
  estimated: boolean;
  totalMax: string | null;
}

/** Stav objednávky pro kupujícího (odkaz s tajným klíčem). */
export async function orderView(data: DataApi, token: string): Promise<OrderView | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [so] = await data.find("shop.order", { token }, { take: 1 });
  if (!so) return null;
  const order = so.arOrderId ? await data.get("ar.order", String(so.arOrderId)) : null;
  const lines = order ? await data.find("ar.orderLine", { orderId: order.id }, { take: 200, orderBy: { createdAt: "asc" } }) : [];
  const delivery = so.deliveryId ? await data.get("shop.delivery", String(so.deliveryId)) : null;
  const pm = so.paymentMethodId ? await data.get("bank.paymentMethod", String(so.paymentMethodId)) : null;
  const cur = so.currencyId ? await data.get("sys.currency", String(so.currencyId)) : null;
  let transfer: OrderView["transfer"] = null;
  const adv = so.advanceId ? await data.get("ar.advance", String(so.advanceId)) : null;
  if (adv && so.status === "awaitingPayment" && toCents(adv.paidAmount ?? 0) < toCents(adv.amount)) {
    const acc = pm?.bankAccountId ? await data.get("bank.account", String(pm.bankAccountId)) : ((await data.find("bank.account", { blocked: false, isDefault: true }, { take: 1 }).catch(() => []))[0] ?? null);
    const [org] = await data.find("org.entity", {}, { take: 1 }).catch(() => [] as RecordData[]);
    transfer = {
      account: String(acc?.accountNum ?? org?.bankAccount ?? ""),
      iban: String(acc?.iban ?? org?.iban ?? ""),
      vs: String(adv.vs ?? ""),
      amount: fromCents(toCents(adv.amount) - toCents(adv.paidAmount ?? 0)),
      dueDate: adv.dueDate ? String(adv.dueDate).slice(0, 10) : null,
    };
  }
  return {
    orderNum: String(so.orderNum),
    status: String(so.status),
    orderedAt: String(so.orderedAt ?? ""),
    buyerName: String(so.buyerName),
    email: String(so.email),
    delivery: String(delivery?.name ?? ""),
    payment: String(pm?.name ?? ""),
    paymentKind: String(pm?.kind ?? ""),
    currency: String(cur?.code ?? "CZK"),
    lines: lines.map((l) => ({ name: String(l.description ?? ""), qty: String(Number(l.qty ?? 0)), amount: fromCents(toCents(l.amountNet ?? 0) + toCents(l.taxAmount ?? 0)) })),
    total: String(so.amountGross ?? "0"),
    transfer,
    cardPending: pm?.kind === "card" && so.status === "awaitingPayment",
    pickupDate: so.pickupDate ? String(so.pickupDate).slice(0, 10) : null,
    pickupHour: so.pickupHour === null || so.pickupHour === undefined ? null : Number(so.pickupHour),
    pickupAsap: !!so.pickupAsap,
    estimated: !!so.estimated && !["ready", "shipped"].includes(String(so.status)),
    totalMax: so.amountMax ? String(so.amountMax) : null,
  };
}

/** Zrušení objednávky obchodu: prodejní objednávka zrušena (uvolní rezervace), neuhrazená záloha zrušena. */
export async function cancelShopOrder(data: DataApi, so: RecordData) {
  if (so.status === "shipped") throw new UserError("@SHOP:CancelShipped");
  if (so.status === "cancelled") return;
  const adv = so.advanceId ? await data.get("ar.advance", String(so.advanceId)) : null;
  if (adv && toCents(adv.paidAmount ?? 0) > zero) throw new UserError("@SHOP:CancelPaid");
  // zaplaceno bránou (stav K vyřízení u platby kartou) — vrácení peněz jde přes portál brány
  if (so.paymentLogId && so.status === "paid") throw new UserError("@SHOP:CancelGatewayPaid");
  if (adv && adv.status === "open") await data.update("ar.advance", String(adv.id), { status: "cancelled" });
  const o = so.arOrderId ? await data.get("ar.order", String(so.arOrderId)) : null;
  if (o && o.status !== "invoiced" && o.status !== "cancelled") await data.update("ar.order", String(o.id), { status: "cancelled" });
  await data.update("shop.order", String(so.id), { status: "cancelled" });
}

