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
    return Array.isArray(v)
      ? v.filter((l) => l && typeof l.itemId === "string").slice(0, 100)
      : [];
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
  const raw = useSyncExternalStore(
    subscribe,
    () => rawCart(base) ?? "[]",
    () => null,
  );
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
const ADDED = "eshop:added";

export function CartBadge({ base }: { base: string }) {
  const count = useCart(base)?.length ?? 0;
  // potvrzení po přidání z detailu zboží (návrat do přehledu): krátká hláška s odkazem do košíku
  const [added, setAdded] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (name: string) => {
      setAdded(name);
      clearTimeout(timer);
      timer = setTimeout(() => setAdded(null), 4000);
    };
    // po přidání (návrat do přehledu bez nového načtení hlavičky) i po načtení stránky
    const onAdded = (e: Event) =>
      show(String((e as CustomEvent<string>).detail ?? ""));
    window.addEventListener(ADDED, onAdded);
    // nově načtená stránka nebo obnovená z mezipaměti prohlížeče (Zpět): čerstvé přidání z relace (nejvýš 5 s)
    const fromStorage = () => {
      try {
        const saved = JSON.parse(sessionStorage.getItem(ADDED) ?? "null") as { name: string; at: number } | null;
        sessionStorage.removeItem(ADDED);
        if (saved && Date.now() - saved.at < 5000) show(saved.name);
      } catch {
        /* úložiště nedostupné */
      }
    };
    queueMicrotask(fromStorage);
    window.addEventListener("pageshow", fromStorage);
    return () => {
      window.removeEventListener("pageshow", fromStorage);
      window.removeEventListener(ADDED, onAdded);
      clearTimeout(timer);
    };
  }, []);
  return (
    <>
      <a className={s.cartLink} href={`${base}/kosik`}>
        Košík <span className={s.badge}>{count}</span>
      </a>
      {added && (
        <div className={s.toast} role="status">
          ✓ {added} je v košíku · <a href={`${base}/kosik`}>Do košíku</a>
        </div>
      )}
    </>
  );
}

/** Přidat do košíku z přehledu (kusové zboží, 1 ks) — bez odchodu ze stránky, s hláškou. */
export function QuickAdd({ base, itemId, name }: { base: string; itemId: string; name: string }) {
  const add = () => {
    const lines = readCart(base);
    const have = lines.find((l) => l.itemId === itemId);
    if (have) have.qty = String(Number(have.qty) + 1);
    else lines.push({ itemId, qty: "1" });
    writeCart(base, lines);
    window.dispatchEvent(new CustomEvent(ADDED, { detail: name }));
  };
  return (
    <button type="button" className={s.btnAdd} onClick={add} aria-label={`Přidat do košíku: ${name}`}>
      + Do košíku
    </button>
  );
}

/** Množství a Do košíku (vážené zboží po desetinách). */
export function AddToCart({
  base,
  itemId,
  name,
  weighed,
  unit,
  disabled,
}: {
  base: string;
  itemId: string;
  name: string;
  weighed: boolean;
  unit: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [qty, setQty] = useState(weighed ? "0.5" : "1");
  const step = weighed ? 0.1 : 1;
  const [added, setAdded] = useState(false);
  const add = () => {
    const n = Number(qty.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return;
    const lines = readCart(base);
    const have = lines.find((l) => l.itemId === itemId);
    if (have)
      have.qty = String(Math.round((Number(have.qty) + n) * 1000) / 1000);
    else lines.push({ itemId, qty: String(n) });
    writeCart(base, lines);
    setAdded(true);
    // zpět do přehledu, odkud zákazník přišel (kategorie, hledání), jinak na úvod obchodu
    // hláška v přehledu: hlavička obchodu je součástí stránky, po návratu se vytvoří znovu a přečte ji z relace
    try {
      sessionStorage.setItem(ADDED, JSON.stringify({ name, at: Date.now() }));
    } catch {
      /* úložiště nedostupné */
    }
    window.dispatchEvent(new CustomEvent(ADDED, { detail: name }));
    let from: URL | null = null;
    try {
      from = document.referrer ? new URL(document.referrer) : null;
    } catch {
      from = null;
    }
    const inShop =
      from &&
      from.origin === location.origin &&
      (from.pathname === base || from.pathname.startsWith(`${base}/`)) &&
      !from.pathname.startsWith(`${base}/p/`) &&
      !from.pathname.startsWith(`${base}/kosik`);
    if (inShop && window.history.length > 1) router.back();
    else router.push(base);
  };
  return (
    <div className={s.buy}>
      <div className={s.stepper}>
        <button type="button" aria-label="Méně" onClick={() => setQty((v) => String(Math.max(step, Math.round((Number(v.replace(",", ".")) - step) * 1000) / 1000)))}>
          −
        </button>
        <input className={s.qty} type="number" min={step} step={step} value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Množství" />
        <button type="button" aria-label="Více" onClick={() => setQty((v) => String(Math.round(((Number(v.replace(",", ".")) || 0) + step) * 1000) / 1000))}>
          +
        </button>
      </div>
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

type Buyer = {
  name: string;
  email: string;
  phone: string;
  companyName: string;
  regNo: string;
  vatId: string;
  street: string;
  city: string;
  zip: string;
  note: string;
};
const EMPTY: Buyer = {
  name: "",
  email: "",
  phone: "",
  companyName: "",
  regNo: "",
  vatId: "",
  street: "",
  city: "",
  zip: "",
  note: "",
};

/** Košík + doprava + platba + údaje kupujícího → objednávka. */
export function CartCheckout({
  base,
  org,
  termsHref,
}: {
  base: string;
  org: string;
  termsHref: string | null;
}) {
  const router = useRouter();
  const stored = useCart(base);
  const lines = useMemo(() => stored ?? [], [stored]);
  const [q, setQ] = useState<Quote | null>(null);
  const [deliveryId, setDeliveryId] = useState<string | null>(null);
  const [paymentMethodId, setPaymentMethodId] = useState<string | null>(null);
  const [buyer, setBuyer] = useState<Buyer>(EMPTY);
  const [company, setCompany] = useState(false);
  const [terms, setTerms] = useState(false);
  const [pickupDate, setPickupDate] = useState("");
  const [pickupHour, setPickupHour] = useState("");
  const [planned, setPlanned] = useState(false);
  const [website, setWebsite] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // přepočet po každé změně (server vrátí platnou dopravu a platbu — ta je pak vybraná)
  const [tick, setTick] = useState(0);
  const loaded = stored !== null;
  useEffect(() => {
    if (!loaded) return;
    let off = false;
    fetch(`/api/eshop/${org}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines, deliveryId, paymentMethodId }),
    })
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

  const setQty = (itemId: string, qty: string) =>
    writeCart(
      base,
      lines.map((l) => (l.itemId === itemId ? { ...l, qty } : l)),
    );
  const remove = (itemId: string) =>
    writeCart(
      base,
      lines.filter((l) => l.itemId !== itemId),
    );
  const delivery = useMemo(
    () => q?.deliveries.find((d) => d.id === selDelivery) ?? null,
    [q, selDelivery],
  );
  const needAddress = delivery?.kind === "address";
  // den vyzvednutí: předvyplněný nejbližším možným (dnes, je-li v obchodě 0 dní)
  const pickDate = pickupDate || q?.pickup?.minDate || "";
  // výchozí „Dnes, co nejdřív“ — jen když obchod dovolí vyzvednutí ještě dnes
  const canAsap = !!q?.pickup && q.pickup.minDate === q.pickup.today;
  const asap = canAsap && !planned;
  const field = (
    k: keyof Buyer,
    label: string,
    opts: {
      type?: string;
      full?: boolean;
      required?: boolean;
      auto?: string;
    } = {},
  ) => (
    <label className={`${s.field} ${opts.full ? s.full : ""}`}>
      <span>
        {label}
        {opts.required ? " *" : ""}
      </span>
      <input
        type={opts.type ?? "text"}
        value={buyer[k]}
        autoComplete={opts.auto}
        onChange={(e) => setBuyer({ ...buyer, [k]: e.target.value })}
      />
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
        body: JSON.stringify({
          lines,
          deliveryId: selDelivery,
          paymentMethodId: selPayment,
          pickupDate: pickDate || null,
          pickupHour: asap || pickupHour === "" ? null : Number(pickupHour),
          pickupAsap: asap,
          terms,
          website,
          buyer: company
            ? buyer
            : { ...buyer, companyName: "", regNo: "", vatId: "" },
        }),
      });
      const data = await r.json();
      if (data.ok) {
        writeCart(base, []);
        // platba bránou: platební stránka Comgate (mimo obchod)
        if (/^https?:\/\//.test(data.url)) window.location.assign(data.url);
        else router.push(data.url);
        return;
      }
      setErrors(
        data.errors ?? { _: data.error ?? "Objednávku se nepodařilo odeslat." },
      );
      setTick((x) => x + 1);
    } catch {
      setErrors({
        _: "Objednávku se nepodařilo odeslat. Zkontrolujte připojení a zkuste to znovu.",
      });
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return null;
  if (!lines.length || (q && !q.lines.length))
    return (
      <div className={s.empty}>
        <p>Košík je prázdný.</p>
        <a
          className={`${s.btn}`}
          href={base}
          style={{ textDecoration: "none" }}
        >
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
                <a href={`${base}/p/${encodeURIComponent(l.itemNum)}`}>
                  {l.name}
                </a>
                <div className={s.note}>
                  {money(l.price, cur)} / {l.unit}
                  {l.weighed && l.maxAmount
                    ? ` · váží se, nejvýše ${money(l.maxAmount, cur)}`
                    : ""}
                </div>
                {l.error && <div className={s.lineErr}>{l.error}</div>}
              </div>
              <input
                className={s.qty}
                type="number"
                min={l.weighed ? 0.1 : 1}
                step={l.weighed ? 0.1 : 1}
                defaultValue={l.qty}
                onBlur={(e) => setQty(l.itemId, e.target.value)}
                aria-label="Množství"
                style={{ width: 80 }}
              />
              <strong>{money(l.amount, cur)}</strong>
              <button
                className={s.remove}
                onClick={() => remove(l.itemId)}
                aria-label="Odebrat"
              >
                ×
              </button>
            </div>
          ))}
          {delivery?.kind === "pickup" && q?.pickup && (
            <div className={s.fields} style={{ marginTop: 14 }}>
              <div className={s.full} style={{ fontWeight: 600 }}>
                Vyzvednutí v prodejně
              </div>
              {canAsap && (
                <div
                  className={s.full}
                  style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                >
                  <label
                    className={`${s.choice} ${asap ? s.choiceOn : ""}`}
                    style={{ flex: "1 1 200px" }}
                  >
                    <input
                      type="radio"
                      name="when"
                      checked={asap}
                      onChange={() => setPlanned(false)}
                    />
                    <span className={s.choiceMain}>
                      Dnes, co nejdřív
                      <div className={s.note}>
                        Připravíme hned, jak to půjde.
                      </div>
                    </span>
                  </label>
                  <label
                    className={`${s.choice} ${!asap ? s.choiceOn : ""}`}
                    style={{ flex: "1 1 200px" }}
                  >
                    <input
                      type="radio"
                      name="when"
                      checked={!asap}
                      onChange={() => setPlanned(true)}
                    />
                    <span className={s.choiceMain}>
                      Vybrat den a čas
                      <div className={s.note}>Na později nebo na jiný den.</div>
                    </span>
                  </label>
                </div>
              )}
              {!asap && (
                <>
                  <label className={s.field}>
                    <span>Den vyzvednutí *</span>
                    <input
                      type="date"
                      min={q.pickup.minDate}
                      max={q.pickup.maxDate}
                      value={pickDate}
                      onChange={(e) => setPickupDate(e.target.value)}
                    />
                    {errors.pickupDate && (
                      <span className={s.fieldErr}>{errors.pickupDate}</span>
                    )}
                  </label>
                  {q.pickup.fromHour !== null && q.pickup.toHour !== null && (
                    <label className={s.field}>
                      <span>Kolik hodin (nepovinné)</span>
                      <select
                        value={pickupHour}
                        onChange={(e) => setPickupHour(e.target.value)}
                      >
                        <option value="">Kdykoli během dne</option>
                        {Array.from(
                          {
                            length: Math.max(
                              0,
                              q.pickup.toHour - q.pickup.fromHour + 1,
                            ),
                          },
                          (_, i) => q.pickup.fromHour! + i,
                        ).map((h) => (
                          <option key={h} value={h}>
                            {h}:00
                          </option>
                        ))}
                      </select>
                      {errors.pickupHour && (
                        <span className={s.fieldErr}>{errors.pickupHour}</span>
                      )}
                    </label>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div className={s.panel} style={{ marginTop: 16 }}>
          <h2>Doprava</h2>
          {q?.deliveries.map((d) => (
            <label
              key={d.id}
              className={`${s.choice} ${d.id === selDelivery ? s.choiceOn : ""}`}
            >
              <input
                type="radio"
                name="delivery"
                checked={d.id === selDelivery}
                onChange={() => setDeliveryId(d.id)}
              />
              <span className={s.choiceMain}>
                {d.name}
                {d.description && <div className={s.note}>{d.description}</div>}
              </span>
              <strong>
                {Number(d.price) ? money(d.price, cur) : "zdarma"}
              </strong>
            </label>
          ))}
          <h2 style={{ marginTop: 16 }}>Platba</h2>
          {q?.payments.map((p) => (
            <label
              key={p.id}
              className={`${s.choice} ${p.id === selPayment ? s.choiceOn : ""}`}
            >
              <input
                type="radio"
                name="payment"
                checked={p.id === selPayment}
                onChange={() => setPaymentMethodId(p.id)}
              />
              <span className={s.choiceMain}>{p.name}</span>
            </label>
          ))}
        </div>

        <div className={s.panel} style={{ marginTop: 16 }}>
          <h2>Kontaktní údaje</h2>
          <div className={s.fields}>
            {field("name", "Jméno a příjmení", {
              required: true,
              full: true,
              auto: "name",
            })}
            {field("email", "E-mail", {
              type: "email",
              required: true,
              auto: "email",
            })}
            {field("phone", "Telefon", { type: "tel", auto: "tel" })}
            {needAddress && (
              <>
                {field("street", "Ulice a číslo", {
                  required: true,
                  full: true,
                  auto: "street-address",
                })}
                {field("city", "Obec", {
                  required: true,
                  auto: "address-level2",
                })}
                {field("zip", "PSČ", { required: true, auto: "postal-code" })}
              </>
            )}
          </div>
          <label className={s.check}>
            <input
              type="checkbox"
              checked={company}
              onChange={(e) => setCompany(e.target.checked)}
            />{" "}
            Nakupuji na firmu
          </label>
          {company && (
            <div className={s.fields}>
              {field("companyName", "Název firmy", {
                full: true,
                auto: "organization",
              })}
              {field("regNo", "IČO")}
              {field("vatId", "DIČ")}
            </div>
          )}
          <label className={`${s.field} ${s.full}`} style={{ marginTop: 10 }}>
            <span>Poznámka k objednávce</span>
            <textarea
              rows={3}
              value={buyer.note}
              onChange={(e) => setBuyer({ ...buyer, note: e.target.value })}
            />
          </label>
          <input
            className={s.hp}
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            aria-hidden="true"
            name="website"
          />
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
          <span>{q?.estimated ? "Celkem s DPH (odhad)" : "Celkem s DPH"}</span>
          <span>{money(q?.total ?? 0, cur)}</span>
        </div>
        {q?.estimated && (
          <p className={s.note} style={{ margin: "6px 0 10px" }}>
            Zboží na váhu krájíme a vážíme až při přípravě, cena se upřesní
            podle skutečné váhy — nejvýše {money(q.totalMax, cur)}. Zaplatíte až
            fakturu po zvážení, nebo při převzetí.
          </p>
        )}
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
        <button
          className={s.btn}
          style={{ width: "100%", marginTop: 8 }}
          disabled={busy || !q || q.errors.length > 0}
          onClick={() => void submit()}
        >
          {busy ? "Odesílám…" : "Objednat s povinností platby"}
        </button>
      </div>
    </div>
  );
}
