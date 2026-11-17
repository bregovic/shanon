/**
 * E-shop — veřejná část (bez přihlášení).
 *
 * Adresa /<zkratka organizace> (proxy přepíše na /eshop/<zkratka>/…) → organizace podle zkratky
 * (registr jedinečných klíčů, jmenný prostor „entity“) → její firma → zveřejněný obchod. Data čte
 * systémová relace tenanta (jako dodavatelský portál); ceny, dostupnost a součty počítá
 * `src/modules/shop/catalog.ts`. Obrázky jen těch záznamů, které obchod ukazuje.
 */
import "server-only";
import { randomBytes, createHash } from "node:crypto";
import QRCode from "qrcode";
import type { PrismaClient } from "@/generated/prisma/client";
import { UserError, dependencyClosure, type DataApi, type RecordData } from "@/core/module";
import { ADMIN } from "@/core/security";
import { czIban, spayd } from "@/core/print";
import { registry } from "@/registry";
import { gatewayConnection, listProducts, markGatewayPaid, orderView, placeOrder, productByNum, quote, type OrderInput, type OrderResult, type OrderView, type Quote, type QuoteInput, type ShopProduct } from "@/modules/shop/catalog";
import { comgateCreate, comgateStatus } from "@/modules/int/comgate";
import { paymentRedirectOf, writeLog } from "@/modules/int/drivers";
import { toCents } from "@/core/money";
import { prisma, withTenant } from "./db";
import { inTenant, type Ctx } from "./data";
import { readFile } from "./docuref";
import { getT } from "./i18n";
import { sendMail } from "./mail";

const SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;

interface Loaded {
  ctx: Ctx;
  shop: RecordData;
  entity: RecordData | null;
}

async function load(org: string, client: PrismaClient): Promise<Loaded | null> {
  if (!SLUG.test(org)) return null;
  const k = await client.sysGlobalKey.findUnique({ where: { namespace_key: { namespace: "entity", key: org } } });
  if (!k) return null;
  const tenant = await client.sysTenant.findUnique({ where: { id: k.tenantId }, include: { modules: true, users: { where: { role: "admin" }, take: 1 } } });
  if (!tenant || !tenant.modules.some((m) => m.moduleId === "shop")) return null;
  const ent = await withTenant(k.tenantId, (tx) => tx.orgEntity.findFirst({ where: { tenantId: k.tenantId, id: k.ownerId } }), client);
  if (!ent?.companyId) return null;
  const modules = new Set([...dependencyClosure(registry, ["sys", ...tenant.modules.map((m) => m.moduleId)])].filter((x) => registry.modules.has(x)));
  const ctx: Ctx = {
    tenantId: k.tenantId,
    companyId: String(ent.companyId),
    userId: String(tenant.users[0]?.id ?? k.tenantId),
    userName: "E-shop",
    role: "admin",
    perms: ADMIN,
    modules,
    extensions: new Set(),
    lang: "cs",
  };
  const found = await inTenant(
    ctx,
    async (s) => {
      const api = s.sys().api();
      const [shop] = await api.find("shop.shop", { active: true }, { take: 1 });
      return shop ? { shop, entity: await api.get("org.entity", String(ent.id)) } : null;
    },
    client,
  );
  return found ? { ctx, ...found } : null;
}

const run = <T>(l: Loaded, fn: (api: DataApi) => Promise<T>, client: PrismaClient) => inTenant(l.ctx, (s) => fn(s.sys().api()), client);

export interface ShopMeta {
  base: string;
  name: string;
  layout: string;
  accent: string;
  headline: string;
  intro: string;
  logo: boolean;
  hero: boolean;
  contactEmail: string;
  contactPhone: string;
  company: { name: string; regNo: string; vatId: string; address: string; registration: string };
  categories: { id: string; name: string; slug: string; parentId: string | null; description: string; image: boolean }[];
  pages: { title: string; slug: string }[];
  currency: string;
}

async function meta(l: Loaded, org: string, api: DataApi): Promise<ShopMeta> {
  const s = l.shop;
  const e = l.entity;
  const cats = await api.find("shop.category", { active: true }, { take: 500, orderBy: { position: "asc" } });
  const pages = await api.find("shop.page", { active: true, inFooter: true }, { take: 50, orderBy: { position: "asc" } });
  const cur = await api.find("gl.parameters", {}, { take: 1 }).then(async ([p]) => (p?.accountingCurrencyId ? await api.get("sys.currency", String(p.accountingCurrencyId)) : null));
  const street = [e?.street, [e?.houseNo, e?.orientNo].filter(Boolean).join("/")].filter(Boolean).join(" ");
  return {
    base: `/${org}`,
    name: String(s.name),
    layout: String(s.layout ?? "classic"),
    accent: /^#[0-9a-f]{6}$/i.test(String(s.accentColor ?? "")) ? String(s.accentColor) : "#1f6f5c",
    headline: String(s.headline ?? ""),
    intro: String(s.intro ?? ""),
    logo: !!(s.logo || e?.logo),
    hero: !!s.heroImage,
    contactEmail: String(s.contactEmail ?? e?.email ?? ""),
    contactPhone: String(s.contactPhone ?? e?.phone ?? ""),
    company: {
      name: String(e?.legalName ?? s.name),
      regNo: String(e?.regNo ?? ""),
      vatId: String(e?.vatId ?? ""),
      address: [street, [e?.zipCode, e?.city].filter(Boolean).join(" ")].filter(Boolean).join(", "),
      registration: String(e?.registration ?? ""),
    },
    categories: cats.map((c) => ({ id: String(c.id), name: String(c.name), slug: String(c.slug), parentId: (c.parentId as string) ?? null, description: String(c.description ?? ""), image: !!c.image })),
    pages: pages.map((p) => ({ title: String(p.title), slug: String(p.slug) })),
    currency: String(cur?.code ?? "CZK"),
  };
}

export type ShopView =
  | { kind: "home"; products: ShopProduct[]; q: string }
  | { kind: "category"; category: ShopMeta["categories"][number]; products: ShopProduct[] }
  | { kind: "product"; product: ShopProduct; category: ShopMeta["categories"][number] | null }
  | { kind: "page"; title: string; body: string }
  | { kind: "cart" }
  | { kind: "order"; order: OrderView; qr: string | null };

/** Stránka obchodu podle adresy (null = neexistuje / obchod není zveřejněný). */
export async function shopPage(org: string, path: string[], q = "", client: PrismaClient = prisma): Promise<{ meta: ShopMeta; view: ShopView } | null> {
  const l = await load(org, client);
  if (!l) return null;
  return run(
    l,
    async (api) => {
      const m = await meta(l, org, api);
      const [a, b] = path;
      let view: ShopView | null = null;
      if (!a) view = { kind: "home", products: await listProducts(api, l.shop, { q, take: q ? 200 : 60 }), q };
      else if (a === "k" && b) {
        const category = m.categories.find((c) => c.slug === b);
        if (category) view = { kind: "category", category, products: await listProducts(api, l.shop, { categoryId: category.id }) };
      } else if (a === "p" && b) {
        const product = await productByNum(api, l.shop, decodeURIComponent(b));
        if (product) view = { kind: "product", product, category: m.categories.find((c) => c.id === product.categoryId) ?? null };
      } else if (a === "info" && b) {
        const [p] = await api.find("shop.page", { slug: b, active: true }, { take: 1 });
        if (p) view = { kind: "page", title: String(p.title), body: String(p.body ?? "") };
      } else if (a === "kosik" && !b) view = { kind: "cart" };
      else if (a === "objednavka" && b) {
        const order = await orderView(api, b);
        if (order) {
          const iban = order.transfer ? order.transfer.iban || czIban(order.transfer.account) : null;
          const qr = order.transfer && iban ? await QRCode.toString(spayd({ iban, amount: order.transfer.amount, currency: order.currency, vs: order.transfer.vs, message: `${m.name} ${order.orderNum}` }), { type: "svg", margin: 1, errorCorrectionLevel: "M" }) : null;
          view = { kind: "order", order, qr };
        }
      }
      return view ? { meta: m, view } : null;
    },
    client,
  );
}

/** Košík (chyby jako texty pro kupujícího). */
export async function shopQuote(org: string, input: QuoteInput, client: PrismaClient = prisma): Promise<Quote | null> {
  const l = await load(org, client);
  if (!l) return null;
  const q = await run(l, (api) => quote(api, l.shop, input), client);
  const t = await getT("cs", l.ctx.tenantId);
  return { ...q, errors: q.errors.map((e) => t(e)), lines: q.lines.map((x) => (x.error ? { ...x, error: t(x.error) } : x)) };
}

/** Objednávka z webu; po uložení potvrzení e-mailem (bez napojení pošty zůstane koncept). */
export async function shopOrder(org: string, input: OrderInput, ip: string, origin: string, client: PrismaClient = prisma): Promise<(OrderResult & { url?: string; errorText?: Record<string, string> }) | null> {
  const l = await load(org, client);
  if (!l) return null;
  const ipHash = createHash("sha256").update(`${l.ctx.tenantId}|shop|${ip}`).digest("hex").slice(0, 32);
  const token = randomBytes(24).toString("base64url");
  const t = await getT("cs", l.ctx.tenantId);
  const res = await run(l, (api) => placeOrder(api, l.shop, input, ipHash, token), client);
  if (!res.ok) return { ...res, errorText: Object.fromEntries(Object.entries(res.errors ?? {}).map(([k, v]) => [k, t(v)])) };
  const url = `${origin}/${org}/objednavka/${token}`;
  await confirmationMail(l, token, url, client).catch(() => undefined); // pošta nesmí shodit objednávku
  // platba bránou: rovnou na platební stránku (nepovede-li se, stránka objednávky nabídne Zaplatit)
  const pay = res.card ? await startGateway(l, org, token, origin, client).catch(() => null) : null;
  return { ...res, url: pay ?? url };
}

/**
 * Platba objednávky bránou (Comgate): čekající platbu použije znovu, jinak založí novou.
 * Síť mimo transakci; v protokolu Integrace „payment.start“ s adresou platební stránky.
 */
async function startGateway(l: Loaded, org: string, token: string, origin: string, client: PrismaClient): Promise<string | null> {
  const prep = await run(
    l,
    async (api) => {
      const [so] = await api.find("shop.order", { token }, { take: 1 });
      const conn = await gatewayConnection(api);
      if (!so || !conn || so.status !== "awaitingPayment") return null;
      const pm = so.paymentMethodId ? await api.get("bank.paymentMethod", String(so.paymentMethodId)) : null;
      if (pm?.kind !== "card") return null;
      const log = so.paymentLogId ? await api.get("int.log", String(so.paymentLogId)) : null;
      const cur = so.currencyId ? await api.get("sys.currency", String(so.currencyId)) : null;
      return { so, conn, log, currency: String(cur?.code ?? "CZK") };
    },
    client,
  );
  if (!prep) return null;
  const { so, conn, log, currency } = prep;
  const reuse = log && log.status === "pending" && log.connectionId === conn.id ? paymentRedirectOf(log) : null;
  if (reuse) return reuse;
  const cents = toCents(so.amountGross ?? 0);
  try {
    const res = await comgateCreate(conn, {
      amountCents: cents,
      currency,
      label: String(l.shop.name),
      refId: String(so.orderNum),
      email: String(so.email),
      phone: (so.phone as string) || null,
      fullName: String(so.buyerName),
      returnUrl: `${origin}/${org}/objednavka/${token}`,
    });
    await run(
      l,
      async (api) => {
        const lg = await writeLog(api, conn, "payment.start", "pending", { reference: String(so.orderNum), externalId: res.transId, detail: `amount=${cents} redirect=${res.redirect}` });
        await api.update("shop.order", String(so.id), { paymentLogId: lg.id });
      },
      client,
    );
    return res.redirect;
  } catch (e) {
    await run(l, (api) => writeLog(api, conn, "payment.start", "error", { reference: String(so.orderNum), message: String((e as UserError).params?.reason ?? (e as Error).message).slice(0, 240) }), client);
    return null;
  }
}

/** Tlačítko Zaplatit na stránce objednávky: adresa platební stránky (null = nejde). */
export async function shopPay(org: string, token: string, origin: string, client: PrismaClient = prisma): Promise<string | null> {
  const l = await load(org, client);
  return l ? startGateway(l, org, token, origin, client) : null;
}

/** Návrat z brány / otevření objednávky: ověří stav platby u brány (oznámení může přijít později). */
export async function shopRefreshPayment(org: string, token: string, client: PrismaClient = prisma): Promise<void> {
  const l = await load(org, client);
  if (!l || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return;
  const prep = await run(
    l,
    async (api) => {
      const [so] = await api.find("shop.order", { token }, { take: 1 });
      if (!so || so.status !== "awaitingPayment" || !so.paymentLogId) return null;
      const log = await api.get("int.log", String(so.paymentLogId));
      const conn = log?.connectionId ? await api.get("int.connection", String(log.connectionId)) : null;
      return log && conn ? { log, conn } : null;
    },
    client,
  );
  if (!prep) return;
  await settleGatewayLog(l.ctx, prep.conn, prep.log, client);
}

/**
 * Stav platby bránou podle brány (nikdy podle oznámení samotného): zaplaceno na celou částku →
 * protokol OK a objednávka e-shopu k vyřízení; zrušeno → protokol chyba. Pokladna čte stav z protokolu.
 */
export async function settleGatewayLog(ctx: Ctx, conn: RecordData, log: RecordData, client: PrismaClient = prisma): Promise<string> {
  if (log.status === "ok") {
    await inTenant(ctx, (s) => markGatewayPaid(s.sys().api(), String(log.id)).catch(() => false), client);
    return "paid";
  }
  if (log.status !== "pending" || !log.externalId) return String(log.status);
  const st = await comgateStatus(conn, String(log.externalId));
  const cents = BigInt(/amount=(-?\d+)/.exec(String(log.detail))?.[1] ?? "-1");
  const paid = st.state === "paid" && (st.priceCents === null || st.priceCents === cents);
  if (st.state === "pending") return "pending";
  await inTenant(
    ctx,
    async (s) => {
      const api = s.sys().api();
      const fresh = await api.get("int.log", String(log.id));
      if (fresh?.status !== "pending") return;
      await api.update("int.log", String(log.id), { status: paid ? "ok" : "error", message: paid ? "PAID" : st.message.slice(0, 240) });
      if (paid) await markGatewayPaid(api, String(log.id)).catch(() => false); // bez e-shopu (pokladna) nic
    },
    client,
  );
  return paid ? "paid" : "cancelled";
}

async function confirmationMail(l: Loaded, token: string, url: string, client: PrismaClient) {
  if (!l.ctx.modules.has("int")) return;
  const t = await getT("cs", l.ctx.tenantId);
  const fmt = (v: string) => Number(v).toLocaleString("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const mailId = await run(
    l,
    async (api) => {
      const o = await orderView(api, token);
      if (!o) return null;
      const lines = o.lines.map((x) => `${x.name} — ${x.qty} — ${fmt(x.amount)} ${o.currency}`).join("\n");
      const pay = o.transfer ? t("@SHOP:MailTransfer", { account: o.transfer.account || o.transfer.iban, vs: o.transfer.vs, amount: `${fmt(o.transfer.amount)} ${o.currency}` }) : "";
      const [conn] = (await api.find("int.connection", { kind: "mail", active: true }, { take: 20 })).sort((a, b) => String(a.code).localeCompare(String(b.code)));
      const m = await api.create("int.mail", {
        mailTo: o.email,
        mailCc: l.shop.contactEmail ?? null,
        subject: t("@SHOP:MailSubject", { num: o.orderNum, shop: String(l.shop.name) }).slice(0, 255),
        body: t("@SHOP:MailBody", { num: o.orderNum, lines, total: `${fmt(o.total)} ${o.currency}`, delivery: o.delivery, payment: o.payment, pay, url, shop: String(l.shop.name) }),
        status: "draft",
        connectionId: conn?.id ?? null,
        reference: `E-shop ${o.orderNum}`,
        sourceObject: "shop.order",
      } as RecordData);
      return conn ? String(m.id) : null;
    },
    client,
  );
  if (mailId) await sendMail(l.ctx, mailId, client);
}

/** Obrázek pro obchod: i = položka, c = kategorie, logo, hero. Jen to, co obchod ukazuje. */
export async function shopImage(org: string, kind: string, id: string, client: PrismaClient = prisma): Promise<{ data: Buffer; mime: string } | null> {
  const l = await load(org, client);
  if (!l) return null;
  const ref = await run(
    l,
    async (api) => {
      if (kind === "i" && /^[0-9a-f-]{36}$/i.test(id)) {
        const item = await api.get("inv.item", id);
        return item?.eshop && !item.blocked ? ((item.image as string) ?? null) : null;
      }
      if (kind === "c" && /^[0-9a-f-]{36}$/i.test(id)) {
        const c = await api.get("shop.category", id);
        return c?.active ? ((c.image as string) ?? null) : null;
      }
      if (kind === "logo") return ((l.shop.logo ?? l.entity?.logo) as string) ?? null;
      if (kind === "hero") return (l.shop.heroImage as string) ?? null;
      return null;
    },
    client,
  );
  if (!ref) return null;
  try {
    const f = await readFile(l.ctx, ref, client);
    if (!/^image\/(png|jpeg|webp|gif)$/.test(f.mime)) return null; // jen obrázky (ne SVG — skripty)
    return { data: f.data, mime: f.mime };
  } catch (e) {
    if (e instanceof UserError) return null;
    throw e;
  }
}
