"use client";

/**
 * Portál smluv — stránka pro zájemce o členství / předplatné: tarif, údaje, potvrzení znění smlouvy.
 * Po odeslání platební údaje (účet, VS, částka, QR). Bez přihlášení; kontroly a limity hlídá server.
 */
import { useEffect, useState } from "react";
import { Button, Checkbox, Field, Input, makeStyles, Select, Spinner, Text, Textarea, tokens } from "@fluentui/react-components";
import { CheckmarkCircle48Filled } from "@fluentui/react-icons";
import QRCode from "qrcode";
import type { AgreementPortalInfo, AgreementResult, PortalFormField } from "@/server/agreement-portal";
import { PortalLogo, portalBackground } from "@/components/portal-theme";
import { formFieldVisible } from "@/lib/form-visible";

const useStyles = makeStyles({
  page: {
    minHeight: "100vh",
    background: `linear-gradient(160deg, ${tokens.colorBrandBackground} 0%, ${tokens.colorBrandBackgroundPressed} 38%, ${tokens.colorNeutralBackground2} 38.1%)`,
    padding: "40px 16px 60px",
    "@media (max-width: 600px)": { padding: "20px 10px 40px" },
    display: "flex",
    justifyContent: "center",
  },
  wrap: { width: "100%", maxWidth: "720px", display: "flex", flexDirection: "column", gap: "18px" },
  hero: { color: tokens.colorNeutralForegroundOnBrand, display: "flex", flexDirection: "column", gap: "6px", padding: "0 4px" },
  company: { fontSize: tokens.fontSizeBase300, opacity: 0.85, letterSpacing: "0.04em", textTransform: "uppercase" },
  title: { fontSize: "32px", lineHeight: "40px", fontWeight: tokens.fontWeightSemibold },
  card: { backgroundColor: tokens.colorNeutralBackground1, borderRadius: "16px", boxShadow: tokens.shadow28, padding: "28px", display: "flex", flexDirection: "column", gap: "22px", "@media (max-width: 600px)": { padding: "18px 14px", gap: "18px" } },
  step: { display: "flex", flexDirection: "column", gap: "10px" },
  stepHead: { fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase400 },
  tariffs: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px" },
  tariff: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "14px",
    borderRadius: "12px",
    border: `2px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    cursor: "pointer",
    textAlign: "left",
    font: "inherit",
    color: "inherit",
  },
  tariffOn: { border: `2px solid ${tokens.colorBrandStroke1}`, backgroundColor: tokens.colorBrandBackground2 },
  price: { fontSize: "22px", fontWeight: tokens.fontWeightSemibold },
  // pole nahoru: chyba pod jedním polem nerozhodí sousední v řádku; na telefonu jeden sloupec
  grid2: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px", alignItems: "start" },
  terms: {
    maxHeight: "260px",
    overflowY: "auto",
    lineHeight: "1.5",
    padding: "12px 14px",
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    fontSize: tokens.fontSizeBase300,
  },
  termsOpen: { maxHeight: "none" },
  termsHead: { fontWeight: tokens.fontWeightSemibold, margin: "12px 0 4px" },
  termsPara: { margin: "0 0 6px" },
  error: { color: tokens.colorPaletteRedForeground1 },
  trap: { position: "absolute", left: "-10000px", width: "1px", height: "1px", overflow: "hidden" },
  done: { display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", textAlign: "center" },
  pay: { display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 16px", alignItems: "baseline" },
  qrBox: { display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" },
  cardPay: { display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" },
  payWrap: { display: "flex", flexWrap: "wrap", gap: "20px", alignItems: "center", justifyContent: "center" },
});

const money = (v: string) => new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(v));
const months = (n: number) => (n === 12 ? "rok" : n === 1 ? "měsíc" : n < 5 ? `${n} měsíce` : `${n} měsíců`);
const date = (s: string) => (s ? s.split("-").reverse().map((x) => String(Number(x))).join(". ") : "");

export function AgreementPortal({ action, info }: { action: string; info: AgreementPortalInfo }) {
  const s = useStyles();
  const look = portalBackground(info.design);
  const radius = info.design.corners === "square" ? { borderRadius: 4 } : undefined;
  const footer = info.design.footer ? <Text style={{ whiteSpace: "pre-wrap", textAlign: "center", color: tokens.colorNeutralForeground3 }}>{info.design.footer}</Text> : null;
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ tariffId: info.tariffs[0]?.id ?? "", firstName: "", lastName: "", email: "", phone: "", street: "", city: "", zipCode: "", startDate: today, consent: false, website: "" });
  // formulář portálu (Integrace → Formuláře): odpovědi podle klíče pole
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
  const answer = (k: string, v: string | boolean) => setAnswers((x) => ({ ...x, [k]: v }));
  // rozepsané údaje zůstanou v prohlížeči (zavřená stránka, telefon zhasne); po uzavření smlouvy se smažou
  const draftKey = `portal-draft:${action}`;
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem(draftKey) ?? "null") as { f?: Record<string, string>; answers?: Record<string, string | boolean> } | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- úložiště prohlížeče (vnější zdroj, až po hydrataci)
      if (d?.answers) setAnswers(d.answers);
      if (d?.f) setF((x) => ({ ...x, ...d.f, consent: false, website: "" }));
    } catch {
      /* soukromý režim apod. */
    }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      const rest = { ...f } as Record<string, unknown>;
      delete rest.consent;
      delete rest.website;
      localStorage.setItem(draftKey, JSON.stringify({ f: rest, answers }));
    } catch {
      /* bez úložiště */
    }
  }, [f, answers, loaded, draftKey]);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  // ARES: podle IČO doplnit pole mapovaná na název, DIČ a sídlo (jen co z ARES přijde)
  const [aresMsg, setAresMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const loadAres = async (icoKey: string) => {
    setAresMsg(null);
    try {
      const r = await fetch(`${action.replace(/\/agreement$/, "/ares")}?ico=${encodeURIComponent(String(answers[icoKey] ?? ""))}`);
      const j = (await r.json()) as { ok: boolean; error?: string; name?: string; vatId?: string; street?: string; city?: string; zip?: string; closed?: boolean };
      if (!j.ok) return setAresMsg({ ok: false, text: j.error ?? "ARES teď neodpovídá – vyplňte údaje ručně." });
      const vals: Record<string, string> = { name: j.name ?? "", vatId: j.vatId ?? "", street: j.street ?? "", city: j.city ?? "", zip: j.zip ?? "" };
      setAnswers((x) => {
        const next = { ...x };
        for (const fl of info.form?.fields ?? []) if (fl.ares && fl.ares !== "lookup" && vals[fl.ares]) next[fl.key] = vals[fl.ares];
        return next;
      });
      setAresMsg({ ok: !j.closed, text: j.closed ? `${j.name} – firma je podle ARES zaniklá.` : `Načteno z ARES: ${j.name}` });
    } catch {
      setAresMsg({ ok: false, text: "ARES teď neodpovídá – vyplňte údaje ručně." });
    }
  };
  const touch = (k: string) => setTouched((x) => ({ ...x, [k]: true }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<AgreementResult | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (_: unknown, d: { value: string }) => setF((x) => ({ ...x, [k]: d.value }));

  // návrat z platební brány: ?zaplaceno=<ref> → stav smlouvy ověřený u brány
  const payUrl = action.replace(/\/agreement$/, "/pay");
  const [paid, setPaid] = useState<{ status: string; agreementNum: string } | null>(null);
  const [paying, setPaying] = useState(false);
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("zaplaceno");
    if (!ref) return;
    void fetch(`${payUrl}?ref=${encodeURIComponent(ref)}`)
      .then((r) => r.json())
      .then((j: { ok: boolean; status: string; agreementNum: string }) => j.ok && setPaid(j))
      .catch(() => undefined);
  }, [payUrl]);
  const payCard = async () => {
    if (!done?.payRef) return;
    setPaying(true);
    try {
      const back = `${window.location.pathname}?zaplaceno=${done.payRef}`;
      const r = await fetch(payUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref: done.payRef, back }) });
      const j = (await r.json()) as { ok: boolean; url?: string; error?: string };
      if (j.ok && j.url) window.location.href = j.url;
      else setError(j.error ?? "Platba kartou teď nejde.");
    } catch {
      setError("Server neodpovídá. Zkuste to znovu.");
    } finally {
      setPaying(false);
    }
  };

  useEffect(() => {
    if (done?.payment?.qr) void QRCode.toDataURL(done.payment.qr, { margin: 1, width: 220 }).then(setQr).catch(() => setQr(null));
  }, [done]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(action, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, answers }) });
      const j = (await r.json()) as AgreementResult;
      if (!j.ok) setError(j.error ?? "Odeslání se nepodařilo.");
      else {
        setDone(j);
        try {
          localStorage.removeItem(draftKey);
        } catch {
          /* bez úložiště */
        }
      }
    } catch {
      setError("Server neodpovídá. Zkuste to znovu.");
    } finally {
      setBusy(false);
    }
  };

  const hero = (
    <div className={s.hero} style={{ color: look.heroColor }}>
      <PortalLogo design={info.design} />
      {info.design.showCompany && <span className={s.company}>{info.companyName}</span>}
      <span className={s.title}>{info.title}</span>
      {info.intro && <Text style={{ whiteSpace: "pre-wrap" }}>{info.intro}</Text>}
    </div>
  );

  if (paid) {
    const ok = paid.status === "active";
    return (
      <main className={s.page} style={{ background: look.background }}>
        <div className={s.wrap}>
          {hero}
          <div className={s.card} style={radius}>
            <div className={s.done}>
              <CheckmarkCircle48Filled primaryFill={ok ? tokens.colorPaletteGreenForeground1 : tokens.colorNeutralForeground3} />
              <Text size={600} weight="semibold">{ok ? `Zaplaceno – smlouva ${paid.agreementNum} platí` : `Smlouva ${paid.agreementNum} čeká na platbu`}</Text>
              <Text>{ok ? "Děkujeme. Potvrzení vám přijde e-mailem." : "Platba zatím nedorazila. Pokud jste platbu zrušili, zaplaťte prosím převodem podle údajů v e-mailu."}</Text>
            </div>
          </div>
          {footer}
        </div>
      </main>
    );
  }

  if (done?.ok) {
    const p = done.payment;
    return (
      <main className={s.page} style={{ background: look.background }}>
        <div className={s.wrap}>
          {hero}
          <div className={s.card} style={radius}>
            <div className={s.done}>
              <CheckmarkCircle48Filled primaryFill={tokens.colorPaletteGreenForeground1} />
              <Text size={600} weight="semibold">Smlouva {done.agreementNum} je uzavřená</Text>
              <Text>{p ? "Začne platit, jakmile přijde platba. Zaplaťte prosím podle údajů níže." : "Začne platit, jakmile přijde platba. Platební údaje vám pošleme e-mailem."}</Text>
              {done.mailedTo && <Text>Vyplněnou smlouvu a obchodní podmínky jsme poslali na {done.mailedTo}.</Text>}
            </div>
            {p && (
              <div className={s.payWrap}>
                <div className={s.pay}>
                  <Text>Částka</Text>
                  <Text weight="semibold" size={500}>
                    {money(p.amount)} {p.currency === "CZK" ? "Kč" : p.currency}
                  </Text>
                  {p.bankAccount && (
                    <>
                      <Text>Účet</Text>
                      <Text weight="semibold">{p.bankAccount}</Text>
                    </>
                  )}
                  {p.iban && (
                    <>
                      <Text>IBAN</Text>
                      <Text>{p.iban}</Text>
                    </>
                  )}
                  <Text>Variabilní symbol</Text>
                  <Text weight="semibold">{p.vs}</Text>
                  <Text>Splatnost</Text>
                  <Text>{date(p.dueDate)}</Text>
                </div>
                {qr && (
                  <div className={s.qrBox}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qr} alt="QR platba" width={220} height={220} />
                    <a href={qr} download={`QR-platba-${done.agreementNum}.png`}>
                      <Button appearance="secondary" size="small">Stáhnout QR kód</Button>
                    </a>
                  </div>
                )}
              </div>
            )}
            {info.cardPay && done.payRef && (
              <div className={s.cardPay}>
                <Button appearance="primary" size="large" disabled={paying} onClick={() => void payCard()}>
                  {paying ? <Spinner size="tiny" /> : "Zaplatit kartou / Apple Pay / Google Pay"}
                </Button>
                {error && <Text style={{ color: tokens.colorPaletteRedForeground1 }}>{error}</Text>}
              </div>
            )}
          </div>
          {footer}
        </div>
      </main>
    );
  }

  const chosen = info.tariffs.find((t) => t.id === f.tariffId);
  return (
    <main className={s.page} style={{ background: look.background }}>
      <div className={s.wrap}>
        {hero}
        <div className={s.card} style={radius}>
          {!info.tariffs.length ? (
            <Text>Přihlášky zatím nejsou otevřené.</Text>
          ) : (
            <>
              <div className={s.step}>
                <span className={s.stepHead}>1. Vyberte tarif</span>
                <div className={s.tariffs} role="radiogroup">
                  {info.tariffs.map((t) => (
                    <button key={t.id} type="button" role="radio" aria-checked={t.id === f.tariffId} className={`${s.tariff} ${t.id === f.tariffId ? s.tariffOn : ""}`} onClick={() => setF((x) => ({ ...x, tariffId: t.id }))}>
                      <Text weight="semibold">{t.name}</Text>
                      <span className={s.price}>{money(t.price)} Kč</span>
                      <Text size={200}>{t.perUnit ? "za kartu / " : "za "}{months(t.months)}</Text>
                      {t.description && <Text size={200}>{t.description}</Text>}
                    </button>
                  ))}
                </div>
              </div>

              {info.form ? (
                <div className={s.step}>
                  <span className={s.stepHead}>2. {info.form.heading || "Vaše údaje"}</span>
                  {info.form.intro && <Text style={{ whiteSpace: "pre-wrap" }}>{info.form.intro}</Text>}
                  <div className={s.grid2}>
                    {info.form.fields.filter((fl) => formFieldVisible(fl.showIf, answers)).map((fl) =>
                      formField(fl, answers[fl.key], answer, touched[fl.key] ? fieldError(fl, answers[fl.key]) : null, () => touch(fl.key), fl.ares === "lookup" ? () => loadAres(fl.key) : undefined),
                    )}
                    {aresMsg && <Text size={200} style={{ gridColumn: "1 / -1", color: aresMsg.ok ? tokens.colorPaletteGreenForeground1 : tokens.colorPaletteRedForeground1 }}>{aresMsg.text}</Text>}
                  </div>
                  <div className={s.trap} aria-hidden="true">
                    <Input tabIndex={-1} value={f.website} onChange={set("website")} autoComplete="off" />
                  </div>
                </div>
              ) : (
              <div className={s.step}>
                <span className={s.stepHead}>2. Vaše údaje</span>
                <div className={s.grid2}>
                  <Field label="Jméno" required>
                    <Input value={f.firstName} onChange={set("firstName")} autoComplete="given-name" />
                  </Field>
                  <Field label="Příjmení" required>
                    <Input value={f.lastName} onChange={set("lastName")} autoComplete="family-name" />
                  </Field>
                  <Field label="E-mail" required>
                    <Input type="email" value={f.email} onChange={set("email")} autoComplete="email" />
                  </Field>
                  <Field label="Telefon" required>
                    <Input type="tel" value={f.phone} onChange={set("phone")} autoComplete="tel" />
                  </Field>
                  <Field label="Ulice a číslo" required>
                    <Input value={f.street} onChange={set("street")} autoComplete="street-address" />
                  </Field>
                  <Field label="Město" required>
                    <Input value={f.city} onChange={set("city")} autoComplete="address-level2" />
                  </Field>
                  <Field label="PSČ" required>
                    <Input value={f.zipCode} onChange={set("zipCode")} inputMode="numeric" autoComplete="postal-code" />
                  </Field>
                  <Field label="Začátek členství" required>
                    <Input type="date" value={f.startDate} min={today} onChange={set("startDate")} />
                  </Field>
                </div>
                <div className={s.trap} aria-hidden="true">
                  <Input tabIndex={-1} value={f.website} onChange={set("website")} autoComplete="off" />
                </div>
              </div>
              )}

              <div className={s.step}>
                <span className={s.stepHead}>3. Smlouva</span>
                {info.terms && <Terms text={info.terms} pdf={action.replace(/\/agreement$/, "/vop")} />}
                <Checkbox
                  checked={f.consent}
                  onChange={(_, d) => setF((x) => ({ ...x, consent: !!d.checked }))}
                  label={`Souhlasím se zněním smlouvy${chosen ? ` (tarif ${chosen.name}, ${money(chosen.price)} Kč za ${months(chosen.months)})` : ""} a se zpracováním osobních údajů pro její plnění.`}
                />
              </div>

              {error && <Text className={s.error}>{error}</Text>}
              <Button appearance="primary" size="large" disabled={busy || !f.consent || !f.tariffId} onClick={submit} icon={busy ? <Spinner size="tiny" /> : undefined}>
                Uzavřít smlouvu
              </Button>
            </>
          )}
        </div>
        {footer}
      </div>
    </main>
  );
}

const AUTO: Record<string, string> = { email: "email", phone: "tel" };

/** Jedno pole formuláře portálu podle typu (text, datum, výběr, souhlas…); celý řádek = přes obě kolony. */
/** Chyba u pole hned po opuštění (stejná pravidla jako na serveru). */
function fieldError(fl: PortalFormField, value: string | boolean | undefined): string | null {
  if (fl.kind === "heading" || fl.kind === "info") return null;
  if (fl.kind === "checkbox" || fl.kind === "consent") return fl.required && value !== true ? "Potvrďte prosím." : null;
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) return fl.required ? "Vyplňte prosím." : null;
  if (fl.kind === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "Zkontrolujte e-mail.";
  if (fl.kind === "phone" && v.replace(/\D/g, "").length < 9) return "Telefon má mít aspoň 9 číslic.";
  if (fl.kind === "number" && !/^-?\d+([.,]\d+)?$/.test(v)) return "Zadejte číslo.";
  return null;
}

function formField(
  fl: PortalFormField,
  value: string | boolean | undefined,
  answer: (k: string, v: string | boolean) => void,
  error: string | null,
  onBlur: () => void,
  onAres?: () => void,
) {
  const full = fl.width === "full" ? { gridColumn: "1 / -1" } : undefined;
  const str = typeof value === "string" ? value : "";
  if (fl.kind === "heading")
    return (
      <Text key={fl.key} weight="semibold" size={400} style={{ ...full, marginTop: 8 }}>
        {fl.label}
      </Text>
    );
  if (fl.kind === "info")
    return (
      <Text key={fl.key} style={{ ...full, whiteSpace: "pre-wrap" }}>
        {fl.label}
      </Text>
    );
  if (fl.kind === "checkbox" || fl.kind === "consent")
    return (
      <div key={fl.key} style={full}>
        <Checkbox checked={value === true} onChange={(_, d) => (answer(fl.key, !!d.checked), onBlur())} label={fl.label + (fl.required ? " *" : "")} />
        {error && <Text size={200} style={{ display: "block", marginLeft: 32, color: tokens.colorPaletteRedForeground1 }}>{error}</Text>}
        {fl.help && <Text size={200} style={{ display: "block", marginLeft: 32 }}>{fl.help}</Text>}
      </div>
    );
  const input =
    fl.kind === "longtext" ? (
      <Textarea value={str} onChange={(_, d) => answer(fl.key, d.value)} onBlur={onBlur} resize="vertical" />
    ) : fl.kind === "select" ? (
      <Select value={str} onChange={(_, d) => (answer(fl.key, d.value), onBlur())}>
        <option value="">—</option>
        {fl.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
    ) : (
      <Input
        type={fl.kind === "date" ? "date" : fl.kind === "email" ? "email" : fl.kind === "phone" ? "tel" : "text"}
        inputMode={fl.kind === "number" ? "decimal" : undefined}
        value={str}
        onChange={(_, d) => answer(fl.key, d.value)}
        onBlur={onBlur}
        autoComplete={fl.auto || AUTO[fl.kind]}
        contentAfter={
          onAres ? (
            <Button appearance="transparent" size="small" onClick={onAres} disabled={str.replace(/\s/g, "").length < 6}>
              Načíst z ARES
            </Button>
          ) : undefined
        }
      />
    );
  return (
    <Field key={fl.key} label={fl.label} required={fl.required} hint={fl.help || undefined} validationMessage={error ?? undefined} style={full}>
      {input}
    </Field>
  );
}

/**
 * Obchodní podmínky: odstavce a nadpisy („1. ÚVODNÍ USTANOVENÍ“, řádky velkými písmeny), posuvné okno
 * s Zobrazit celé, a ke stažení jako PDF.
 */
function Terms({ text, pdf }: { text: string; pdf: string }) {
  const s = useStyles();
  const [open, setOpen] = useState(false);
  const blocks = text.replace(/\r/g, "").split("\n").map((l) => l.trim());
  const isHead = (l: string) => /^\d+\.\s+\p{Lu}[\p{Lu}\s,.–-]{3,}$/u.test(l) || (l.length < 90 && l === l.toUpperCase() && /\p{Lu}{3}/u.test(l));
  return (
    <div>
      <div className={`${s.terms} ${open ? s.termsOpen : ""}`}>
        {blocks.map((l, i) =>
          !l ? null : isHead(l) ? (
            <div key={i} className={s.termsHead}>
              {l}
            </div>
          ) : (
            <p key={i} className={s.termsPara}>
              {l}
            </p>
          ),
        )}
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
        <Button appearance="subtle" size="small" onClick={() => setOpen((x) => !x)}>
          {open ? "Sbalit" : "Zobrazit celé"}
        </Button>
        <Button appearance="subtle" size="small" as="a" href={pdf} target="_blank" rel="noopener">
          Stáhnout PDF
        </Button>
      </div>
    </div>
  );
}
