"use client";

/**
 * E-shop — košík v prohlížeči (localStorage, jen id položky a množství) a pokladna. Ceny, doprava,
 * platby i součet vrací vždy server (/api/eshop/<obchod>/quote), objednávku zakládá server.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { Quote } from "@/modules/shop/catalog";
import s from "./eshop.module.css";
import { money } from "./format";

type CartLine = { itemId: string; qty: string };
const EVENT = "eshop-cart";
const keyOf = (base: string) => `eshop:${base}`;

function parseCart(raw: string | null): CartLine[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((l) => l && typeof l.itemId === "string").slice(0, 100) : [];
  } catch {
    return [];
  }
}
function rawCart(base: string): string | null {
  try {
    return localStorage.getItem(keyOf(base));
  } catch {
    return null;
  }
}
const readCart = (base: string) => parseCart(rawCart(base));
function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
/** Košík z úložiště prohlížeče (na serveru prázdný; null = ještě nenačteno). */
function useCart(base: string): CartLine[] | null {
  const raw = useSyncExternalStore(subscribe, () => rawCart(base) ?? "[]", () => null);
  return useMemo(() => (raw === null ? null : parseCart(raw)), [raw]);
}
function writeCart(base: string, lines: CartLine[]) {
  try {
    localStorage.setItem(keyOf(base), JSON.stringify(lines));
  } catch {
    /* soukromé okno bez úložiště — košík jen do obnovení stránky */
  }
  window.dispatchEvent(new Event(EVENT));
}


/** Odkaz na košík s počtem položek. */
export function CartBadge({ base }: { base: string }) {
  const count = useCart(base)?.length ?? 0;
  return (
    <a className={s.cartLink} href={`${base}/kosik`}>
      Košík <span className={s.badge}>{count}</span>
    </a>
  );
}

/** Množství a Do košíku (vážené zboží po desetinách). */
export function AddToCart({ base, itemId, weighed, unit, disabled }: { base: string; itemId: string; weighed: boolean; unit: string; disabled?: boolean }) {
  const [qty, setQty] = useState(weighed ? "0.5" : "1");
  const [added, setAdded] = useState(false);
  const add = () => {
    const n = Number(qty.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return;
    const lines = readCart(base);
    const have = lines.find((l) => l.itemId === itemId);
    if (have) have.qty = String(Math.round((Number(have.qty) + n) * 1000) / 1000);
    else lines.push({ itemId, qty: String(n) });
    writeCart(base, lines);
    setAdded(true);
    setTimeout(() => setAdded(false), 2500);
  };
  return (
    <div className={s.buy}>
      <input className={s.qty} type="number" min={weighed ? 0.1 : 1} step={weighed ? 0.1 : 1} value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Množství" />
      <span className={s.note}>{unit}</span>
      <button className={s.btn} onClick={add} disabled={disabled}>
        Do košíku
      </button>
      {added && (
        <a className={s.added} href={`${base}/kosik`}>
          ✓ Přidáno — do košíku
        </a>
      )}
    </div>
  );
}

type Buyer = { name: string; email: string; phone: string; companyName: string; regNo: string; vatId: string; street: string; city: string; zip: string; note: string };
const EMPTY: Buyer = { name: "", email: "", phone: "", companyName: "", regNo: "", vatId: "", street: "", city: "", zip: "", note: "" };

/** Košík + doprava + platba + údaje kupujícího → objednávka. */
export function CartCheckout({ base, org, termsHref }: { base: string; org: string; termsHref: string | null }) {
  const router = useRouter();
  const stored = useCart(base);
  const lines = useMemo(() => stored ?? [], [stored]);
  const [q, setQ] = useState<Quote | null>(null);
  const [deliveryId, setDeliveryId] = useState<string | null>(null);
  const [paymentMethodId, setPaymentMethodId] = useState<string | null>(null);
  const [buyer, setBuyer] = useState<Buyer>(EMPTY);
  const [company, setCompany] = useState(false);
  const [terms, setTerms] = useState(false);
  const [website, setWebsite] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // přepočet po každé změně (server vrátí platnou dopravu a platbu — ta je pak vybraná)
  const [tick, setTick] = useState(0);
  const loaded = stored !== null;
  useEffect(() => {
    if (!loaded) return;
    let off = false;
    fetch(`/api/eshop/${org}/quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines, deliveryId, paymentMethodId }) })
      .then((r) => (r.ok ? (r.json() as Promise<Quote>) : null))
      .then((data) => {
        if (!off && data) setQ(data);
      })
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [org, loaded, lines, deliveryId, paymentMethodId, tick]);
  const selDelivery = q?.deliveryId ?? null;
  const selPayment = q?.paymentMethodId ?? null;

  const setQty = (itemId: string, qty: string) => writeCart(base, lines.map((l) => (l.itemId === itemId ? { ...l, qty } : l)));
  const remove = (itemId: string) => writeCart(base, lines.filter((l) => l.itemId !== itemId));
  const delivery = useMemo(() => q?.deliveries.find((d) => d.id === selDelivery) ?? null, [q, selDelivery]);
  const needAddress = delivery?.kind === "address";
  const field = (k: keyof Buyer, label: string, opts: { type?: string; full?: boolean; required?: boolean; auto?: string } = {}) => (
    <label className={`${s.field} ${opts.full ? s.full : ""}`}>
      <span>
        {label}
        {opts.required ? " *" : ""}
      </span>
      <input type={opts.type ?? "text"} value={buyer[k]} autoComplete={opts.auto} onChange={(e) => setBuyer({ ...buyer, [k]: e.target.value })} />
      {errors[k] && <span className={s.fieldErr}>{errors[k]}</span>}
    </label>
  );

  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      const r = await fetch(`/api/eshop/${org}/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines, deliveryId: selDelivery, paymentMethodId: selPayment, terms, website, buyer: company ? buyer : { ...buyer, companyName: "", regNo: "", vatId: "" } }),
      });
      const data = await r.json();
      if (data.ok) {
        writeCart(base, []);
        // platba bránou: platební stránka Comgate (mimo obchod)
        if (/^https?:\/\//.test(data.url)) window.location.assign(data.url);
        else router.push(data.url);
        return;
      }
      setErrors(data.errors ?? { _: data.error ?? "Objednávku se nepodařilo odeslat." });
      setTick((x) => x + 1);
    } catch {
      setErrors({ _: "Objednávku se nepodařilo odeslat. Zkontrolujte připojení a zkuste to znovu." });
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return null;
  if (!lines.length || (q && !q.lines.length))
    return (
      <div className={s.empty}>
        <p>Košík je prázdný.</p>
        <a className={`${s.btn}`} href={base} style={{ textDecoration: "none" }}>
          Pokračovat v nákupu
        </a>
      </div>
    );
  const cur = q?.currency ?? "CZK";
  return (
    <div className={s.checkout}>
      <div>
        <div className={s.panel}>
          <h2>Košík</h2>
          {q?.lines.map((l) => (
            <div key={l.itemId} className={s.line}>
              <div className={s.lineName}>
                <a href={`${base}/p/${encodeURIComponent(l.itemNum)}`}>{l.name}</a>
                <div className={s.note}>
                  {money(l.price, cur)} / {l.unit}
                </div>
                {l.error && <div className={s.lineErr}>{l.error}</div>}
              </div>
              <input className={s.qty} type="number" min={l.weighed ? 0.1 : 1} step={l.weighed ? 0.1 : 1} defaultValue={l.qty} onBlur={(e) => setQty(l.itemId, e.target.value)} aria-label="Množství" style={{ width: 80 }} />
              <strong>{money(l.amount, cur)}</strong>
              <button className={s.remove} onClick={() => remove(l.itemId)} aria-label="Odebrat">
                ×
              </button>
            </div>
          ))}
        </div>

        <div className={s.panel} style={{ marginTop: 16 }}>
          <h2>Doprava</h2>
          {q?.deliveries.map((d) => (
            <label key={d.id} className={`${s.choice} ${d.id === selDelivery ? s.choiceOn : ""}`}>
              <input type="radio" name="delivery" checked={d.id === selDelivery} onChange={() => setDeliveryId(d.id)} />
              <span className={s.choiceMain}>
                {d.name}
                {d.description && <div className={s.note}>{d.description}</div>}
              </span>
              <strong>{Number(d.price) ? money(d.price, cur) : "zdarma"}</strong>
            </label>
          ))}
          <h2 style={{ marginTop: 16 }}>Platba</h2>
          {q?.payments.map((p) => (
            <label key={p.id} className={`${s.choice} ${p.id === selPayment ? s.choiceOn : ""}`}>
              <input type="radio" name="payment" checked={p.id === selPayment} onChange={() => setPaymentMethodId(p.id)} />
              <span className={s.choiceMain}>{p.name}</span>
            </label>
          ))}
        </div>

        <div className={s.panel} style={{ marginTop: 16 }}>
          <h2>Kontaktní údaje</h2>
          <div className={s.fields}>
            {field("name", "Jméno a příjmení", { required: true, full: true, auto: "name" })}
            {field("email", "E-mail", { type: "email", required: true, auto: "email" })}
            {field("phone", "Telefon", { type: "tel", auto: "tel" })}
            {needAddress && (
              <>
                {field("street", "Ulice a číslo", { required: true, full: true, auto: "street-address" })}
                {field("city", "Obec", { required: true, auto: "address-level2" })}
                {field("zip", "PSČ", { required: true, auto: "postal-code" })}
              </>
            )}
          </div>
          <label className={s.check}>
            <input type="checkbox" checked={company} onChange={(e) => setCompany(e.target.checked)} /> Nakupuji na firmu
          </label>
          {company && (
            <div className={s.fields}>
              {field("companyName", "Název firmy", { full: true, auto: "organization" })}
              {field("regNo", "IČO")}
              {field("vatId", "DIČ")}
            </div>
          )}
          <label className={`${s.field} ${s.full}`} style={{ marginTop: 10 }}>
            <span>Poznámka k objednávce</span>
            <textarea rows={3} value={buyer.note} onChange={(e) => setBuyer({ ...buyer, note: e.target.value })} />
          </label>
          <input className={s.hp} tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} aria-hidden="true" name="website" />
        </div>
      </div>

      <div className={s.panel}>
        <h2>Souhrn</h2>
        <div className={s.sum}>
          <span>Zboží</span>
          <span>{money(q?.itemsTotal ?? 0, cur)}</span>
        </div>
        <div className={s.sum}>
          <span>Doprava</span>
          <span>{money(q?.deliveryPrice ?? 0, cur)}</span>
        </div>
        <div className={`${s.sum} ${s.total}`}>
          <span>Celkem s DPH</span>
          <span>{money(q?.total ?? 0, cur)}</span>
        </div>
        <label className={s.check}>
          <input
            type="checkbox"
            checked={terms}
            onChange={(e) => {
              setTerms(e.target.checked);
              setErrors((prev) => {
                const next = { ...prev };
                delete next.terms;
                return next;
              });
            }}
          />
          <span>
            Souhlasím s{" "}
            {termsHref ? (
              <a href={termsHref} target="_blank" rel="noreferrer">
                obchodními podmínkami
              </a>
            ) : (
              "obchodními podmínkami"
            )}{" "}
            a beru na vědomí zpracování osobních údajů pro vyřízení objednávky.
          </span>
        </label>
        {errors.terms && <div className={s.fieldErr}>{errors.terms}</div>}
        {q?.errors.map((e) => (
          <div key={e} className={s.errorBox}>
            {e}
          </div>
        ))}
        {errors._ && <div className={s.errorBox}>{errors._}</div>}
        <button className={s.btn} style={{ width: "100%", marginTop: 8 }} disabled={busy || !q || q.errors.length > 0} onClick={() => void submit()}>
          {busy ? "Odesílám…" : "Objednat s povinností platby"}
        </button>
      </div>
    </div>
  );
}
