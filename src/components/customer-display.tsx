"use client";

/**
 * Zákaznická obrazovka pokladny (portál, mobil / tablet otočený k zákazníkovi): úvod s logem a textem, položky
 * nákupu se součtem, QR k zaplacení, poděkování po zaplacení. Jen zobrazuje; stav čte dlouhým dotazem.
 */
import { useEffect, useRef, useState } from "react";
import { makeStyles, tokens } from "@fluentui/react-components";
import { QrSvg } from "@/lib/print-render";
import type { DisplayState } from "@/server/pos-display";

const useStyles = makeStyles({
  root: { minHeight: "100vh", display: "flex", flexDirection: "column", padding: "16px", boxSizing: "border-box", gap: "12px" },
  card: {
    background: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusXLarge,
    boxShadow: tokens.shadow16,
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    flex: 1,
    minHeight: 0,
  },
  idle: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: "16px" },
  logo: { maxWidth: "60vw", maxHeight: "30vh", objectFit: "contain" },
  title: { fontSize: "clamp(24px, 6vw, 44px)", fontWeight: 600 },
  intro: { fontSize: "clamp(16px, 3.5vw, 24px)", whiteSpace: "pre-line", color: tokens.colorNeutralForeground2 },
  lines: { flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" },
  line: { display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 12px", padding: "8px 0", borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, fontSize: "clamp(16px, 3.5vw, 22px)" },
  last: { background: tokens.colorBrandBackground2, borderRadius: tokens.borderRadiusMedium, padding: "8px" },
  qty: { color: tokens.colorNeutralForeground3, fontSize: "0.8em" },
  amount: { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  total: { display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: "clamp(28px, 8vw, 56px)", fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  customer: { color: tokens.colorNeutralForeground2, fontSize: "clamp(14px, 3vw, 20px)" },
  qr: { display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", fontSize: "clamp(16px, 3.5vw, 22px)" },
  qrBox: { background: "#fff", padding: "12px", borderRadius: tokens.borderRadiusMedium, width: "min(60vw, 320px)" },
});

export function CustomerDisplay(p: { endpoint: string; logo: string | null; title: string; intro: string; texts: Record<string, string> }) {
  const st = useStyles();
  const T = p.texts;
  const [state, setState] = useState<DisplayState | null>(null);
  const version = useRef(-1);
  const money = new Intl.NumberFormat("cs-CZ", { style: "currency", currency: "CZK" });
  const fmt = (v: string | null | undefined) => money.format(Number(v ?? 0));

  useEffect(() => {
    let stop = false;
    const loop = async () => {
      while (!stop) {
        try {
          const r = await fetch(`${p.endpoint}?v=${version.current}`, { cache: "no-store" });
          if (r.ok) {
            const d = (await r.json()) as { version: number; state: DisplayState | null };
            version.current = d.version;
            setState(d.state);
          } else await new Promise((res) => setTimeout(res, 5000));
        } catch {
          // výpadek spojení: zkusit znovu za chvíli
          await new Promise((res) => setTimeout(res, 3000));
        }
      }
    };
    void loop();
    return () => {
      stop = true;
    };
  }, [p.endpoint]);

  // po zaplacení poděkování ~10 s, pak úvod (kasa mezitím může začít další nákup)
  const [doneHidden, setDoneHidden] = useState(false);
  useEffect(() => {
    if (state?.phase !== "done") return;
    const t = setTimeout(() => setDoneHidden(true), 10_000);
    return () => {
      clearTimeout(t);
      setDoneHidden(false);
    };
  }, [state]);

  const phase = !state || (state.phase === "done" && doneHidden) ? "idle" : state.phase;
  const idle = (
    <div className={st.idle}>
      {/* eslint-disable-next-line @next/next/no-img-element -- logo portálu (veřejný obrázek) */}
      {p.logo && <img src={p.logo} alt="" className={st.logo} />}
      <div className={st.title}>{p.title}</div>
      {p.intro && <div className={st.intro}>{p.intro}</div>}
    </div>
  );
  return (
    <div className={st.root}>
      <div className={st.card}>
        {phase === "idle" || !state ? (
          idle
        ) : phase === "done" ? (
          <div className={st.idle}>
            <div className={st.title}>{T.DisplayThanks}</div>
            {state.qr ? (
              <div className={st.qr}>
                <div className={st.qrBox}>
                  <QrSvg text={state.qr} size={60} />
                </div>
                <div>
                  {T.DisplayScanToPay} · {fmt(state.paid ?? state.total)}
                </div>
              </div>
            ) : (
              <>
                <div className={st.total} style={{ gap: 16 }}>
                  <span>{T.DisplayPaid}</span>
                  <span>{fmt(state.paid ?? state.total)}</span>
                </div>
                {state.change && Number(state.change) > 0 && (
                  <div className={st.intro}>
                    {T.DisplayChange}: {fmt(state.change)}
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <>
            {state.customer && (
              <div className={st.customer}>
                {T.DisplayCustomer}: {state.customer}
              </div>
            )}
            <div className={st.lines}>
              {state.lines.map((l, i) => (
                <div key={i} className={`${st.line} ${i === state.lines.length - 1 ? st.last : ""}`}>
                  <div>
                    {l.name}
                    <div className={st.qty}>{l.qty}</div>
                  </div>
                  <div className={st.amount}>{fmt(l.amount)}</div>
                </div>
              ))}
            </div>
            <div className={st.total}>
              <span>{T.DisplayTotal}</span>
              <span>{fmt(state.total)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
