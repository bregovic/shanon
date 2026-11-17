/**
 * Veřejný e-shop organizace (bez přihlášení): /<zkratka>[/k/<kategorie> | /p/<číslo>/<název> |
 * /kosik | /objednavka/<klíč> | /info/<stránka>]. Proxy přepisuje na /eshop/<zkratka>/…;
 * data a ceny: src/server/eshop.ts.
 */
/* eslint-disable @next/next/no-img-element -- obrázky obchodu z úložiště tenanta, bez optimalizace Next */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AddToCart, CartBadge, CartCheckout } from "@/components/eshop/cart";
import { money } from "@/components/eshop/format";
import s from "@/components/eshop/eshop.module.css";
import type { ShopProduct } from "@/modules/shop/catalog";
import { shopPage, shopRefreshPayment, type ShopMeta } from "@/server/eshop";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ org: string; path?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const STATUS: Record<string, string> = {
  new: "Přijata",
  awaitingPayment: "Čeká na platbu",
  paid: "Přijata, připravujeme",
  shipped: "Vyřízena",
  cancelled: "Zrušena",
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org } = await params;
  const r = await shopPage(org, []).catch(() => null);
  return { title: { absolute: r?.meta.name ?? "E-shop" }, description: r?.meta.headline || undefined };
}

export default async function ShopPage({ params, searchParams }: Props) {
  const { org, path = [] } = await params;
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  // návrat z platební brány: ověřit stav platby dřív, než se stránka objednávky vykreslí
  if (path[0] === "objednavka" && path[1]) await shopRefreshPayment(org, path[1]).catch(() => undefined);
  const r = await shopPage(org, path, q);
  if (!r) notFound();
  const { meta, view } = r;
  const img = (kind: string, id: string) => `/api/eshop/${org}/img/${kind}/${id}`;
  const top = meta.categories.filter((c) => !c.parentId);
  const current = view.kind === "category" ? view.category.id : view.kind === "product" ? view.product.categoryId : null;
  const terms = meta.pages.find((p) => p.slug === "obchodni-podminky");

  return (
    <div className={s.root} data-layout={meta.layout} style={{ ["--accent" as string]: meta.accent }}>
      <header className={s.header}>
        <div className={s.wrap}>
          <div className={s.headerRow}>
            <a className={s.brand} href={meta.base}>
              {meta.logo && <img src={img("logo", "x")} alt="" />}
              <span className={s.brandName}>{meta.name}</span>
            </a>
            <form className={s.search} action={meta.base} method="get" role="search">
              <input name="q" defaultValue={q} placeholder="Hledat zboží" aria-label="Hledat zboží" />
              <button type="submit">Hledat</button>
            </form>
            <CartBadge base={meta.base} />
          </div>
          {top.length > 0 && (
            <nav className={s.nav} aria-label="Kategorie">
              {top.map((c) => (
                <a key={c.id} href={`${meta.base}/k/${c.slug}`} aria-current={current === c.id ? "page" : undefined}>
                  {c.name}
                </a>
              ))}
            </nav>
          )}
        </div>
      </header>

      <main className={s.main}>
        <div className={s.wrap}>
          {view.kind === "home" && (
            <>
              {!view.q && (meta.headline || meta.intro || meta.hero) && (
                <section className={`${s.hero} ${meta.hero ? s.heroWithImage : ""}`}>
                  <div>
                    <h1>{meta.headline || meta.name}</h1>
                    {meta.intro && <p>{meta.intro}</p>}
                  </div>
                  {meta.hero && <img src={img("hero", "x")} alt="" />}
                </section>
              )}
              {view.q && <h1 className={s.h1}>Hledání: {view.q}</h1>}
              <Products base={meta.base} items={view.products} currency={meta.currency} img={img} />
            </>
          )}

          {view.kind === "category" && (
            <>
              <div className={s.crumbs}>
                <a href={meta.base}>{meta.name}</a> › {view.category.name}
              </div>
              <h1 className={s.h1}>{view.category.name}</h1>
              {view.category.description && <p className={s.lead}>{view.category.description}</p>}
              {meta.categories.some((c) => c.parentId === view.category.id) && (
                <nav className={s.nav} style={{ marginBottom: 16 }}>
                  {meta.categories
                    .filter((c) => c.parentId === view.category.id)
                    .map((c) => (
                      <a key={c.id} href={`${meta.base}/k/${c.slug}`}>
                        {c.name}
                      </a>
                    ))}
                </nav>
              )}
              <Products base={meta.base} items={view.products} currency={meta.currency} img={img} />
            </>
          )}

          {view.kind === "product" && (
            <>
              <div className={s.crumbs}>
                <a href={meta.base}>{meta.name}</a>
                {view.category && (
                  <>
                    {" "}
                    › <a href={`${meta.base}/k/${view.category.slug}`}>{view.category.name}</a>
                  </>
                )}
              </div>
              <div className={s.detail}>
                <div className={s.detailImg}>{view.product.image ? <img src={img("i", view.product.id)} alt={view.product.name} /> : <Initial name={view.product.name} />}</div>
                <div>
                  <h1 className={s.h1}>{view.product.name}</h1>
                  <PriceLine p={view.product} currency={meta.currency} />
                  <Stock p={view.product} />
                  <AddToCart base={meta.base} itemId={view.product.id} weighed={view.product.weighed} unit={view.product.unit} disabled={!view.product.orderable} />
                  {view.product.weighed && <p className={s.note}>Zboží na váhu: cena je za {view.product.unit}, výsledná částka se může podle skutečné hmotnosti mírně lišit.</p>}
                  {view.product.description && <div className={s.desc}>{view.product.description}</div>}
                  <p className={s.note}>Kód: {view.product.itemNum}</p>
                </div>
              </div>
            </>
          )}

          {view.kind === "cart" && (
            <>
              <h1 className={s.h1}>Košík a objednávka</h1>
              <CartCheckout base={meta.base} org={org} termsHref={terms ? `${meta.base}/info/${terms.slug}` : null} />
            </>
          )}

          {view.kind === "order" && (
            <>
              <h1 className={s.h1}>Objednávka {view.order.orderNum}</h1>
              <p>
                <span className={s.status}>{STATUS[view.order.status] ?? view.order.status}</span>
              </p>
              <p className={s.lead}>Děkujeme, {view.order.buyerName}. Potvrzení objednávky posíláme na {view.order.email}.</p>
              {view.order.cardPending && (
                <div className={s.panel} style={{ marginBottom: 16 }}>
                  <h2>Platba kartou, Google Pay nebo Apple Pay</h2>
                  <p className={s.note}>Objednávka čeká na zaplacení. Platba proběhne na zabezpečené stránce platební brány Comgate.</p>
                  <a className={s.btn} href={`/api/eshop/${org}/pay/${path[1]}`} style={{ display: "inline-block", textDecoration: "none" }}>
                    Zaplatit {money(view.order.total, view.order.currency)}
                  </a>
                </div>
              )}
              {view.order.transfer && (
                <div className={s.panel} style={{ marginBottom: 16 }}>
                  <h2>Platba převodem</h2>
                  <div className={s.payGrid}>
                    {view.qr && <div className={s.qr} dangerouslySetInnerHTML={{ __html: view.qr }} />}
                    <div>
                      <div className={s.sum}>
                        <span>Účet</span>
                        <strong>{view.order.transfer.account || view.order.transfer.iban}</strong>
                      </div>
                      <div className={s.sum}>
                        <span>Variabilní symbol</span>
                        <strong>{view.order.transfer.vs}</strong>
                      </div>
                      <div className={s.sum}>
                        <span>Částka</span>
                        <strong>{money(view.order.transfer.amount, view.order.currency)}</strong>
                      </div>
                      {view.order.transfer.dueDate && (
                        <div className={s.sum}>
                          <span>Splatnost</span>
                          <strong>{new Date(view.order.transfer.dueDate).toLocaleDateString("cs-CZ")}</strong>
                        </div>
                      )}
                      <p className={s.note}>QR kód naskenujte v aplikaci své banky. Objednávku vyřídíme po připsání platby.</p>
                    </div>
                  </div>
                </div>
              )}
              <div className={s.panel}>
                {view.order.lines.map((l, i) => (
                  <div key={i} className={s.sum}>
                    <span>
                      {l.name} {Number(l.qty) !== 1 && <span className={s.note}>× {Number(l.qty).toLocaleString("cs-CZ")}</span>}
                    </span>
                    <span>{money(l.amount, view.order.currency)}</span>
                  </div>
                ))}
                <div className={`${s.sum} ${s.total}`}>
                  <span>Celkem s DPH</span>
                  <span>{money(view.order.total, view.order.currency)}</span>
                </div>
                <p className={s.note}>
                  Doprava: {view.order.delivery} · Platba: {view.order.payment}
                </p>
              </div>
            </>
          )}

          {view.kind === "page" && (
            <article className={s.article}>
              <h1 className={s.h1}>{view.title}</h1>
              <Body text={view.body} />
            </article>
          )}
        </div>
      </main>

      <Footer meta={meta} />
    </div>
  );
}

function Products({ base, items, currency, img }: { base: string; items: ShopProduct[]; currency: string; img: (k: string, id: string) => string }) {
  if (!items.length) return <div className={s.empty}>Zboží jsme nenašli.</div>;
  return (
    <div className={s.grid}>
      {items.map((p) => (
        <a key={p.id} className={s.card} href={`${base}/p/${encodeURIComponent(p.itemNum)}/${p.slug}`}>
          <div className={s.thumb}>{p.image ? <img src={img("i", p.id)} alt="" loading="lazy" /> : <Initial name={p.name} />}</div>
          <div className={s.cardBody}>
            <span className={s.cardName}>{p.name}</span>
            <div className={s.cardFoot}>
              <PriceLine p={p} currency={currency} />
              <Stock p={p} />
            </div>
          </div>
        </a>
      ))}
    </div>
  );
}

function PriceLine({ p, currency }: { p: ShopProduct; currency: string }) {
  return (
    <span className={s.price}>
      {money(p.price, currency)}
      {p.weighed && <span className={s.per}> / {p.unit}</span>}
      {p.regularPrice && <span className={s.regular}>{money(p.regularPrice, currency)}</span>}
    </span>
  );
}

function Stock({ p }: { p: ShopProduct }) {
  if (p.stock === null) return null;
  return p.stock > 0 ? <span className={s.stock}>Skladem</span> : <span className={s.stockOut}>{p.orderable ? "Na objednávku" : "Vyprodáno"}</span>;
}

const Initial = ({ name }: { name: string }) => <span>{name.slice(0, 1).toUpperCase()}</span>;

/** Text stránky: odstavce (prázdný řádek), „## “ nadpis, „- “ odrážky. Bez HTML. */
function Body({ text }: { text: string }) {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return (
    <>
      {blocks.map((b, i) => {
        if (b.startsWith("## ")) return <h2 key={i}>{b.slice(3)}</h2>;
        const rows = b.split("\n");
        if (rows.every((r) => r.trim().startsWith("- ")))
          return (
            <ul key={i}>
              {rows.map((r, j) => (
                <li key={j}>{r.trim().slice(2)}</li>
              ))}
            </ul>
          );
        return (
          <p key={i} style={{ whiteSpace: "pre-line" }}>
            {b}
          </p>
        );
      })}
    </>
  );
}

function Footer({ meta }: { meta: ShopMeta }) {
  const c = meta.company;
  return (
    <footer className={s.footer}>
      <div className={`${s.wrap} ${s.footGrid}`}>
        <div>
          <h3>{c.name}</h3>
          {c.address && <p>{c.address}</p>}
          {c.regNo && <p>IČO: {c.regNo}</p>}
          {c.vatId && <p>DIČ: {c.vatId}</p>}
          {c.registration && <p>{c.registration}</p>}
        </div>
        <div>
          <h3>Kontakt</h3>
          {meta.contactEmail && (
            <p>
              <a href={`mailto:${meta.contactEmail}`}>{meta.contactEmail}</a>
            </p>
          )}
          {meta.contactPhone && (
            <p>
              <a href={`tel:${meta.contactPhone.replace(/\s/g, "")}`}>{meta.contactPhone}</a>
            </p>
          )}
        </div>
        {meta.pages.length > 0 && (
          <div>
            <h3>Informace</h3>
            <ul>
              {meta.pages.map((p) => (
                <li key={p.slug}>
                  <a href={`${meta.base}/info/${p.slug}`}>{p.title}</a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </footer>
  );
}
