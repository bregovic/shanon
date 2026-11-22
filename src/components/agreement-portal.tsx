"use client";

/**
 * Portál smluv — stránka pro zájemce o členství / předplatné: tarif, údaje, potvrzení znění smlouvy.
 * Po odeslání platební údaje (účet, VS, částka, QR). Bez přihlášení; kontroly a limity hlídá server.
 */
import { useEffect, useState } from "react";
import { Button, Checkbox, Field, Input, makeStyles, Spinner, Text, tokens } from "@fluentui/react-components";
import { CheckmarkCircle48Filled } from "@fluentui/react-icons";
import QRCode from "qrcode";
import type { AgreementPortalInfo, AgreementResult } from "@/server/agreement-portal";

const useStyles = makeStyles({
  page: {
    minHeight: "100vh",
    background: `linear-gradient(160deg, ${tokens.colorBrandBackground} 0%, ${tokens.colorBrandBackgroundPressed} 38%, ${tokens.colorNeutralBackground2} 38.1%)`,
    padding: "40px 16px 60px",
    display: "flex",
    justifyContent: "center",
  },
  wrap: { width: "100%", maxWidth: "720px", display: "flex", flexDirection: "column", gap: "18px" },
  hero: { color: tokens.colorNeutralForegroundOnBrand, display: "flex", flexDirection: "column", gap: "6px", padding: "0 4px" },
  company: { fontSize: tokens.fontSizeBase300, opacity: 0.85, letterSpacing: "0.04em", textTransform: "uppercase" },
  title: { fontSize: "32px", lineHeight: "40px", fontWeight: tokens.fontWeightSemibold },
  card: { backgroundColor: tokens.colorNeutralBackground1, borderRadius: "16px", boxShadow: tokens.shadow28, padding: "28px", display: "flex", flexDirection: "column", gap: "22px" },
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
  grid2: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" },
  terms: {
    maxHeight: "260px",
    overflowY: "auto",
    whiteSpace: "pre-wrap",
    padding: "12px 14px",
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    fontSize: tokens.fontSizeBase300,
  },
  error: { color: tokens.colorPaletteRedForeground1 },
  trap: { position: "absolute", left: "-10000px", width: "1px", height: "1px", overflow: "hidden" },
  done: { display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", textAlign: "center" },
  pay: { display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 16px", alignItems: "baseline" },
  payWrap: { display: "flex", flexWrap: "wrap", gap: "20px", alignItems: "center", justifyContent: "center" },
});

const money = (v: string) => new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(v));
const months = (n: number) => (n === 12 ? "rok" : n === 1 ? "měsíc" : n < 5 ? `${n} měsíce` : `${n} měsíců`);
const date = (s: string) => (s ? s.split("-").reverse().map((x) => String(Number(x))).join(". ") : "");

export function AgreementPortal({ action, info }: { action: string; info: AgreementPortalInfo }) {
  const s = useStyles();
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ tariffId: info.tariffs[0]?.id ?? "", firstName: "", lastName: "", email: "", phone: "", street: "", city: "", zipCode: "", startDate: today, consent: false, website: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<AgreementResult | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (_: unknown, d: { value: string }) => setF((x) => ({ ...x, [k]: d.value }));

  useEffect(() => {
    if (done?.payment?.qr) void QRCode.toDataURL(done.payment.qr, { margin: 1, width: 220 }).then(setQr).catch(() => setQr(null));
  }, [done]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(action, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
      const j = (await r.json()) as AgreementResult;
      if (!j.ok) setError(j.error ?? "Odeslání se nepodařilo.");
      else setDone(j);
    } catch {
      setError("Server neodpovídá. Zkuste to znovu.");
    } finally {
      setBusy(false);
    }
  };

  const hero = (
    <div className={s.hero}>
      <span className={s.company}>{info.companyName}</span>
      <span className={s.title}>{info.title}</span>
      {info.intro && <Text style={{ whiteSpace: "pre-wrap" }}>{info.intro}</Text>}
    </div>
  );

  if (done?.ok) {
    const p = done.payment;
    return (
      <main className={s.page}>
        <div className={s.wrap}>
          {hero}
          <div className={s.card}>
            <div className={s.done}>
              <CheckmarkCircle48Filled primaryFill={tokens.colorPaletteGreenForeground1} />
              <Text size={600} weight="semibold">Smlouva {done.agreementNum} je uzavřená</Text>
              <Text>Začne platit, jakmile přijde platba. Pošlete prosím částku na účet níže.</Text>
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
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qr} alt="QR platba" width={220} height={220} />
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    );
  }

  const chosen = info.tariffs.find((t) => t.id === f.tariffId);
  return (
    <main className={s.page}>
      <div className={s.wrap}>
        {hero}
        <div className={s.card}>
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
                      <Text size={200}>za {months(t.months)}</Text>
                      {t.description && <Text size={200}>{t.description}</Text>}
                    </button>
                  ))}
                </div>
              </div>

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

              <div className={s.step}>
                <span className={s.stepHead}>3. Smlouva</span>
                {info.terms && <div className={s.terms}>{info.terms}</div>}
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
      </div>
    </main>
  );
}
