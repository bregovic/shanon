"use client";

/**
 * Zákaznická obrazovka pokladny (portál, mobil / tablet otočený k zákazníkovi): úvod s logem a textem, položky
 * nákupu se součtem vždy dole, QR k zaplacení, po zaplacení účtenka jako stvrzenka. Jen zobrazuje; stav čte
 * dlouhým dotazem. Celá obrazovka na ťuknutí, obrazovka nezhasíná (Wake Lock).
 */
import { useEffect, useRef, useState } from "react";
import { Button, makeStyles, tokens } from "@fluentui/react-components";
import { FullScreenMaximize24Regular } from "@fluentui/react-icons";
import { QrSvg } from "@/lib/print-render";
import type { DisplayState } from "@/server/pos-display";

const useStyles = makeStyles({
  // celá výška okna (i mobil s lištou prohlížeče): součet vždy dole, položky se posouvají nad ním
  root: { height: "100dvh", display: "flex", flexDirection: "column", padding: "12px", boxSizing: "border-box", gap: "12px", overflow: "hidden" },
  head: { display: "flex", alignItems: "center", gap: "12px", padding: "4px 8px", flexShrink: 0 },
  headLogo: { height: "40px", maxWidth: "40vw", objectFit: "contain" },
  headName: { fontSize: "clamp(16px, 3.5vw, 22px)", fontWeight: 600 },
  card: {
    background: tokens.colorNeutralBackground1,
    borderRadius: "20px",
    boxShadow: tokens.shadow28,
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
  },
  idle: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: "20px", padding: "24px" },
  logo: { maxWidth: "60vw", maxHeight: "30vh", objectFit: "contain" },
  title: { fontSize: "clamp(28px, 7vw, 52px)", fontWeight: 700, lineHeight: 1.15 },
  intro: { fontSize: "clamp(17px, 3.8vw, 26px)", whiteSpace: "pre-line", color: tokens.colorNeutralForeground2, maxWidth: "36em" },
  customer: { padding: "12px 20px 0", color: tokens.colorNeutralForeground2, fontSize: "clamp(14px, 3vw, 20px)", flexShrink: 0 },
  lines: { flex: 1, minHeight: 0, overflowY: "auto", padding: "8px 12px" },
  line: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    alignItems: "center",
    gap: "2px 16px",
    padding: "12px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    fontSize: "clamp(17px, 3.8vw, 24px)",
  },
  last: {
    background: tokens.colorBrandBackground2,
    borderRadius: "12px",
    borderBottom: "none",
    borderLeft: `6px solid ${tokens.colorBrandBackground}`,
    animationName: { from: { opacity: 0.4, transform: "scale(0.98)" }, to: { opacity: 1, transform: "scale(1)" } },
    animationDuration: "250ms",
  },
  name: { fontWeight: 600 },
  qty: { color: tokens.colorNeutralForeground3, fontSize: "0.75em" },
  amount: { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", fontWeight: 600 },
  total: {
    flexShrink: 0,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: "16px",
    padding: "16px 24px",
    background: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    fontSize: "clamp(30px, 8vw, 60px)",
    fontWeight: 800,
    fontVariantNumeric: "tabular-nums",
  },
  totalLabel: { fontSize: "0.55em", fontWeight: 600, opacity: 0.9 },
  // po zaplacení: účtenka jako papírová stvrzenka
  doneWrap: { flex: 1, minHeight: 0, overflowY: "auto", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "16px" },
  paper: {
    width: "min(440px, 100%)",
    background: "#fff",
    color: "#222",
    borderRadius: "6px",
    boxShadow: "0 10px 30px rgba(0,0,0,.18)",
    padding: "20px 20px 28px",
    fontFamily: "ui-monospace, 'Cascadia Mono', Menlo, Consolas, monospace",
    fontSize: "clamp(13px, 3.2vw, 16px)",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    animationName: { from: { opacity: 0, transform: "translateY(24px)" }, to: { opacity: 1, transform: "translateY(0)" } },
    animationDuration: "400ms",
  },
  paperLogo: { alignSelf: "center", maxWidth: "60%", maxHeight: "80px", objectFit: "contain", filter: "grayscale(1)" },
  paperCenter: { textAlign: "center" },
  sep: { borderTop: "1px dashed #999", margin: "6px 0" },
  row: { display: "flex", justifyContent: "space-between", gap: "12px" },
  rowSmall: { color: "#666", fontSize: "0.9em" },
  bigRow: { display: "flex", justifyContent: "space-between", fontSize: "1.35em", fontWeight: 700 },
  thanks: { textAlign: "center", fontSize: "clamp(22px, 5vw, 34px)", fontWeight: 700, fontFamily: tokens.fontFamilyBase, marginTop: "8px" },
  qr: { display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", marginTop: "8px" },
  qrBox: { background: "#fff", padding: "8px", width: "min(60vw, 260px)" },
  full: { position: "fixed", right: "16px", bottom: "16px", zIndex: 10, opacity: 0.9 },
});

export function CustomerDisplay(p: { endpoint: string; logo: string | null; title: string; intro: string; companyName: string; texts: Record<string, string> }) {
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

  // účtenka po zaplacení ~15 s, pak úvod (kasa mezitím může začít další nákup)
  const [doneHidden, setDoneHidden] = useState(false);
  useEffect(() => {
    if (state?.phase !== "done") return;
    const t = setTimeout(() => setDoneHidden(true), 15_000);
    return () => {
      clearTimeout(t);
      setDoneHidden(false);
    };
  }, [state]);

  const phase = !state || (state.phase === "done" && doneHidden) ? "idle" : state.phase;
  // naposledy přidaná položka vždy vidět (posun dolů)
  const linesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = linesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state]);
  // celá obrazovka (jen na ťuknutí – prohlížeč to jinak nedovolí) a obrazovka nezhasne
  const [isFull, setIsFull] = useState(false);
  useEffect(() => {
    const sync = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    let lock: { release(): Promise<void> } | null = null;
    const wake = async () => {
      try {
        lock = (await (navigator as unknown as { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock?.request("screen")) ?? null;
      } catch {
        /* bez podpory – obrazovka zhasne podle nastavení zařízení */
      }
    };
    void wake();
    const onVis = () => document.visibilityState === "visible" && void wake();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release().catch(() => undefined);
    };
  }, []);
  const goFull = () => void document.documentElement.requestFullscreen?.().catch(() => undefined);

  const at = state?.at ? new Date(state.at) : null;
  return (
    <div className={st.root} onDoubleClick={goFull}>
      {!isFull && (
        <Button className={st.full} icon={<FullScreenMaximize24Regular />} onClick={goFull}>
          {T.DisplayFullscreen}
        </Button>
      )}
      {phase !== "idle" && (
        <div className={st.head}>
          {/* eslint-disable-next-line @next/next/no-img-element -- logo portálu (veřejný obrázek) */}
          {p.logo && <img src={p.logo} alt="" className={st.headLogo} />}
          <span className={st.headName}>{p.title}</span>
        </div>
      )}
      <div className={st.card}>
        {phase === "idle" || !state ? (
          <div className={st.idle}>
            {/* eslint-disable-next-line @next/next/no-img-element -- logo portálu (veřejný obrázek) */}
            {p.logo && <img src={p.logo} alt="" className={st.logo} />}
            <div className={st.title}>{p.title}</div>
            {p.intro && <div className={st.intro}>{p.intro}</div>}
          </div>
        ) : phase === "done" ? (
          <div className={st.doneWrap}>
            <div className={st.paper}>
              {/* eslint-disable-next-line @next/next/no-img-element -- logo portálu (veřejný obrázek) */}
              {p.logo && <img src={p.logo} alt="" className={st.paperLogo} />}
              <div className={st.paperCenter}>
                <b>{p.companyName}</b>
              </div>
              {(state.receiptNum || at) && (
                <div className={`${st.row} ${st.rowSmall}`}>
                  <span>{state.receiptNum}</span>
                  <span>{at ? at.toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}</span>
                </div>
              )}
              {state.customer && <div className={st.rowSmall}>{state.customer}</div>}
              <div className={st.sep} />
              {state.lines.map((l, i) => (
                <div key={i}>
                  <div className={st.row}>
                    <span>{l.name}</span>
                    <span>{fmt(l.amount)}</span>
                  </div>
                  {l.qty && <div className={st.rowSmall}>{l.qty}</div>}
                </div>
              ))}
              <div className={st.sep} />
              <div className={st.bigRow}>
                <span>{T.DisplayTotal}</span>
                <span>{fmt(state.paid ?? state.total)}</span>
              </div>
              {state.qr ? (
                <div className={st.qr}>
                  <div className={st.qrBox}>
                    <QrSvg text={state.qr} size={60} />
                  </div>
                  <div className={st.paperCenter}>{T.DisplayScanToPay}</div>
                </div>
              ) : (
                <>
                  <div className={st.row}>
                    <span>{T.DisplayPaid}</span>
                    <span>{fmt(state.paid ?? state.total)}</span>
                  </div>
                  {state.change && Number(state.change) > 0 && (
                    <div className={st.row}>
                      <span>{T.DisplayChange}</span>
                      <span>{fmt(state.change)}</span>
                    </div>
                  )}
                </>
              )}
              <div className={st.thanks}>{T.DisplayThanks}</div>
            </div>
          </div>
        ) : (
          <>
            {state.customer && (
              <div className={st.customer}>
                {T.DisplayCustomer}: {state.customer}
              </div>
            )}
            <div className={st.lines} ref={linesRef}>
              {state.lines.map((l, i) => (
                <div key={`${i}-${l.name}-${l.amount}`} className={`${st.line} ${i === state.lines.length - 1 ? st.last : ""}`}>
                  <div>
                    <div className={st.name}>{l.name}</div>
                    <div className={st.qty}>{l.qty}</div>
                  </div>
                  <div className={st.amount}>{fmt(l.amount)}</div>
                </div>
              ))}
            </div>
            <div className={st.total}>
              <span className={st.totalLabel}>{T.DisplayTotal}</span>
              <span>{fmt(state.total)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
