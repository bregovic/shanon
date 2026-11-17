/**
 * E-shop — katalog, košík a objednávka (logika nad DataApi, bez webu).
 *
 * Ceny počítá vždy server: cena položky s DPH (v měně obchodu) po nejvýhodnější slevě, řádek =
 * množství × cena s DPH; objednávka má „Ceny včetně DPH“, takže součet sedí na košík. Dostupnost
 * = zásoba − rezervace (sklad obchodu, jinak všechny sklady), jen u skladových položek.
 */
import { fromCents, mulCents, toCents } from "@/core/money";
import { UserError, type DataApi, type RecordData } from "@/core/module";
import { accountingCurrencyId, convertPrice } from "@/modules/gl/posting";
import { bestDiscount, itemPrices } from "@/modules/inv/handlers";
import { notify } from "@/modules/sys/notify";
import { slugify } from "@/lib/slug";

const zero = BigInt(0);
const today = () => new Date().toISOString().slice(0, 10);

export { slugify };

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

/** Volná zásoba skladové položky (null = sklad vypnutý nebo neskladová položka). */
async function freeStock(data: DataApi, shop: RecordData, item: RecordData): Promise<number | null> {
  if (item.itemType && item.itemType !== "item") return null;
  try {
    const where: RecordData = { itemId: item.id, ...(shop.warehouseId ? { warehouseId: shop.warehouseId } : {}) };
    const onhand = (await data.find("whs.onhand", where, { take: 1000 })).reduce((a, r) => a + Number(r.qty ?? 0), 0);
    const reserved = (await data.find("whs.reservation", where, { take: 5000 })).reduce((a, r) => a + Number(r.qty ?? 0), 0);
    return Math.max(0, onhand - reserved);
  } catch {
    return null; // modul Sklad vypnutý
  }
}

async function toProduct(data: DataApi, shop: RecordData, item: RecordData, currencyId: string, date: string, units: Map<string, string>): Promise<ShopProduct> {
  const p = await priceOf(data, item, currencyId, date);
  const stock = await freeStock(data, shop, item);
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
export async function listProducts(data: DataApi, shop: RecordData, opts: { categoryId?: string | null; q?: string; take?: number } = {}): Promise<ShopProduct[]> {
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
  for (const i of items.slice(0, opts.take ?? 500)) out.push(await toProduct(data, shop, i, currencyId, date, units));
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
  /** chyby celé objednávky (minimální objednávka, nedostupná platba…) jako labely */
  errors: string[];
}

/** Platby pro e-shop povolené u dopravy: převod vždy, dobírka jen u dopravy s dobírkou, hotově jen při odběru, karta jen s bránou. */
function paymentAllowed(pm: RecordData, delivery: RecordData | null, gateway: boolean): boolean {
  if (pm.kind === "transfer") return true;
  if (pm.kind === "cod") return !!delivery?.allowCod;
  if (pm.kind === "cash") return delivery?.kind === "pickup";
  return pm.kind === "card" && gateway;
}

/** Aktivní platební brána pro e-shop (Comgate), nebo null. */
export async function gatewayConnection(data: DataApi): Promise<RecordData | null> {
  try {
    const list = (await data.find("int.connection", { kind: "payment", active: true }, { take: 50, orderBy: { code: "asc" } })).filter((c) => c.driver === "comgate" || c.driver === "gatewaySim");
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
    if (shop.sellOutOfStock === false && p.stock !== null && qty > p.stock) line.error = "@SHOP:ErrStock";
    if (prev) {
      itemsTotal -= toCents(prev.amount);
      Object.assign(prev, line);
    } else {
      lines.push(line);
      seen.set(p.id, line);
    }
    itemsTotal += amount;
  }
  const deliveries = await data.find("shop.delivery", { active: true }, { take: 50, orderBy: { position: "asc" } });
  const delivery = deliveries.find((d) => d.id === input.deliveryId) ?? deliveries[0] ?? null;
  const free = shop.freeShippingFrom !== null && shop.freeShippingFrom !== undefined && shop.freeShippingFrom !== "" && itemsTotal >= toCents(shop.freeShippingFrom);
  const deliveryPrice = delivery && !free ? toCents(delivery.price ?? 0) : zero;
  const gateway = !!(await gatewayConnection(data));
  const allPm = (await data.find("bank.paymentMethod", { eshop: true, blocked: false }, { take: 50, orderBy: { code: "asc" } })).filter((pm) => paymentAllowed(pm, delivery, gateway));
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
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clip(b.email, 254))) e.email = "@SYS:InvalidEmail";
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
  for (const l of q.lines) await data.create("ar.orderLine", { orderId: o.id, itemId: l.itemId, description: l.name, qty: l.qty, unitPrice: l.price });
  if (toCents(q.deliveryPrice) > zero || q.lines.length)
    await data.create("ar.orderLine", { orderId: o.id, description: String(delivery.name), qty: "1", unitPrice: q.deliveryPrice, taxCodeId: delivery.taxCodeId ?? null });
  // potvrzení = rezervace zásoby (modul Sklad)
  await data.update("ar.order", String(o.id), { status: "confirmed" });
  const order = (await data.get("ar.order", String(o.id)))!;
  let advanceId: string | null = null;
  if (pm.kind === "transfer") {
    const adv = await data.create("ar.advance", { customerId: shop.customerId, orderId: o.id, currencyId, amount: order.amountGross, description: clip(`E-shop ${num}`, 255) });
    advanceId = String(adv.id);
  }
  await data.update("shop.order", String(so.id), {
    arOrderId: o.id,
    advanceId,
    amountGross: order.amountGross,
    // převod a karta čekají na platbu (záloha / brána), dobírka a hotově jdou rovnou k vyřízení
    status: pm.kind === "transfer" || pm.kind === "card" ? "awaitingPayment" : "paid",
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

