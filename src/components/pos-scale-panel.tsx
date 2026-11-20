"use client";

/**
 * Panel Váha v pokladně (ověřená váha Dialog 06): vybrané vážené zboží, hmotnost a cena PŘESNĚ z váhy, Přidat do
 * nákupu jen po ustálení. Panel o protokolu nic neví — pracuje se stavem `ScaleDriver` (src/lib/scale-driver.ts).
 * Cenu vážené položky tu nic nepočítá; zobrazuje se text, který vrátila váha.
 */
import { beep } from "@/lib/beep";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Spinner, makeStyles, tokens } from "@fluentui/react-components";
import { Scales24Regular } from "@fluentui/react-icons";
import { ScaleDriver, WebSerialTransport, type ScaleState, type ScaleWeighing } from "@/lib/scale-driver";
import { SimScaleTransport } from "@/lib/scale-sim";
import { connectScalePort, scalePort } from "@/lib/scale";

const useStyles = makeStyles({
  // kompaktní panel nahoře ve sloupci Nákup (ne samostatný sloupec)
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "10px 12px",
    margin: "8px 8px 0",
    border: `1px solid ${tokens.colorBrandStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorBrandBackground2,
  },
  head: { display: "flex", alignItems: "center", gap: "6px", fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase300, minWidth: 0 },
  product: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  unit: { color: tokens.colorNeutralForeground3, fontWeight: tokens.fontWeightRegular },
  nums: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" },
  big: { fontSize: "26px", lineHeight: "32px", fontWeight: tokens.fontWeightBold, fontVariantNumeric: "tabular-nums", textAlign: "right" },
  dim: { color: tokens.colorNeutralForegroundDisabled },
  label: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, textAlign: "right" },
  msg: { minHeight: "20px", fontSize: tokens.fontSizeBase300 },
  problem: { color: tokens.colorPaletteRedForeground1, fontWeight: tokens.fontWeightSemibold },
  stable: { color: tokens.colorPaletteGreenForeground1, fontWeight: tokens.fontWeightSemibold, display: "inline-flex", alignItems: "center", gap: "6px" },
  dot: { width: "10px", height: "10px", borderRadius: "50%", backgroundColor: tokens.colorPaletteGreenBackground3 },
  actions: { display: "grid", gridTemplateColumns: "2fr 1fr", gap: "8px" },
  addBtn: { minHeight: "44px", fontSize: tokens.fontSizeBase400 },
});

export interface VerifiedScaleConfig {
  driver: string;
  baudRate: number;
  /** linka z napojení váhy */
  dataBits?: 7 | 8;
  parity?: "none" | "even" | "odd";
  stopBits?: 1 | 2;
  /** přidat samo po N s ustálení (0 = vypnuto) */
  autoAddSec: number;
  /** pípnout při přidání váženého zboží do nákupu (výchozí ano) */
  beep?: boolean;
}

/** Driver ověřené váhy pro pokladnu: simulátor nebo Web Serial; po připojení stránky se sám připojí. */
export function useVerifiedScale(cfg: VerifiedScaleConfig | null) {
  const [driver, setDriver] = useState<ScaleDriver | null>(null);
  const [state, setState] = useState<ScaleState | null>(null);
  useEffect(() => {
    if (!cfg) return;
    const d = new ScaleDriver(
      cfg.driver === "scaleSim"
        ? new SimScaleTransport()
        : new WebSerialTransport(() => scalePort(), cfg.baudRate || 9600, { dataBits: cfg.dataBits ?? 8, parity: cfg.parity ?? "none", stopBits: cfg.stopBits ?? 1 }),
    );
    const off = d.subscribe(setState);
    void d.connect();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- driver vzniká s napojením (vnější zdroj)
    setDriver(d);
    return () => {
      off();
      void d.dispose();
    };
  }, [cfg?.driver, cfg?.baudRate, cfg?.dataBits, cfg?.parity, cfg?.stopBits]); // eslint-disable-line react-hooks/exhaustive-deps
  return { driver, state };
}

/** Je na váze nepřidaná položka? (upozornění při placení) */
export const scalePending = (s: ScaleState | null) => !!s?.product && (s.phase === "stable" || s.phase === "weighing");

export function ScalePanel({
  driver,
  state,
  autoAddSec,
  beepOn = true,
  L,
  fmtMoney,
  onAdd,
}: {
  driver: ScaleDriver;
  state: ScaleState;
  autoAddSec: number;
  /** pípnutí při přidání (napojení váhy) */
  beepOn?: boolean;
  L: Record<string, string>;
  /** formát Kč pro text z váhy (jen zobrazení) */
  fmtMoney: (v: string) => string;
  onAdd: (r: ScaleWeighing) => void;
}) {
  const st = useStyles();
  const { phase, product, reading, problem } = state;
  const stable = phase === "stable" && !!reading;

  // volba napojení: přidat samo po N s ustálení (výchozí vypnuto)
  const [left, setLeft] = useState<number | null>(null);
  const added = useRef<string | null>(null);
  useEffect(() => {
    if (!stable || !autoAddSec || added.current === reading!.raw) return;
    let n = autoAddSec;
    const t = setInterval(() => {
      n -= 1;
      setLeft(n);
      if (n <= 0) {
        clearInterval(t);
        added.current = reading!.raw;
        setLeft(null);
        if (beepOn) beep();
        onAdd(reading!);
      }
    }, 1000);
    setLeft(n);
    return () => {
      clearInterval(t);
      setLeft(null);
    };
  }, [stable, reading, autoAddSec, onAdd, beepOn]);

  const conn =
    phase === "disconnected" ? (
      <Badge color="danger" appearance="tint">
        {L.ScaleDisconnected}
      </Badge>
    ) : phase === "error" ? (
      <Badge color="warning" appearance="tint">
        {L.ScaleError}
      </Badge>
    ) : (
      <Badge color="success" appearance="tint">
        {L.ScaleConnected}
      </Badge>
    );

  const problemText = problem
    ? {
        noResponse: L.ScaleNoResponse,
        belowMin: L.ScaleBelowMin,
        overload: L.ScaleOverloaded,
        negative: L.ScaleNegative,
        noPrice: L.ScaleNoPriceSet,
        priceMismatch: L.ScaleMismatch,
        disconnected: L.ScaleDisconnected,
        unstable: L.ScaleWeighing,
        noZero: L.ScaleRemoveGoods,
        error: L.ScaleOther,
      }[problem]
    : null;

  const message =
    phase === "disconnected"
      ? state.detail === "noPort"
        ? L.ScaleNoPort
        : state.detail === "busy"
          ? L.ScalePortBusy
          : state.detail
            ? `${L.ScaleConnectFailed} ${state.detail}`
            : null
      : phase === "ready"
        ? L.ScalePick
        : phase === "sending"
          ? L.ScaleSending
          : phase === "waiting"
            ? L.ScaleWaitGoods
            : phase === "needZero"
              ? // zboží leželo na váze dřív než cena (ověřená váha ho nepřijme): zvednout a vrátit, pokladna pokračuje sama
                product
                ? L.ScaleLiftReplace
                : L.ScaleRemoveGoods
              : phase === "weighing"
                ? L.ScaleWeighing
                : phase === "stable"
                  ? left
                    ? L.ScaleAutoIn.replace("{s}", String(left))
                    : L.ScaleStable
                  : null;

  // hmotnost a cena: text z váhy; neustáleno = šedě poslední hodnota, čekání = 0,000
  const weight = reading?.weight ?? "0.000";
  const total = reading?.total ?? null;

  return (
    <section className={st.panel} aria-label={L.ScalePanel}>
      <div className={st.head}>
        <Scales24Regular />
        <span className={st.product}>
          {product ? (
            <>
              {product.name} <span className={st.unit}>· {fmtMoney(product.unitPrice)} / kg</span>
            </>
          ) : (
            <span className={st.unit}>{L.ScalePick}</span>
          )}
        </span>
        {conn}
      </div>
      <div className={st.nums}>
        <div>
          <div className={st.label}>{L.Weight}</div>
          <div className={`${st.big} ${stable ? "" : st.dim}`} data-testid="scale-weight">
            {weight.replace(".", ",")} kg
          </div>
        </div>
        <div>
          <div className={st.label}>{L.ScaleTotal}</div>
          <div className={`${st.big} ${stable ? "" : st.dim}`} data-testid="scale-total">
            {total ? fmtMoney(total) : "—"}
          </div>
        </div>
      </div>
      <div className={st.msg}>
        {phase === "sending" && <Spinner size="tiny" style={{ display: "inline-flex", marginRight: 6 }} />}
        {problemText && phase !== "weighing" ? (
          <span className={st.problem}>
            {problemText}
            {phase === "disconnected" && message ? ` — ${message}` : ""}
          </span>
        ) : stable ? (
          <span className={st.stable}>
            <span className={st.dot} />
            {message}
          </span>
        ) : (
          message
        )}
      </div>
      <div className={st.actions}>
        {phase === "disconnected" ? (
          <Button appearance="primary" className={st.addBtn} onClick={() => void connectScalePort().then(() => driver.connect())}>
            {L.ScaleConnect}
          </Button>
        ) : phase === "error" && problem === "noResponse" ? (
          <Button appearance="primary" className={st.addBtn} onClick={() => void driver.retry()}>
            {L.ScaleRetry}
          </Button>
        ) : (
          <Button appearance="primary" className={st.addBtn} disabled={!stable} onClick={() => reading && (beepOn && beep(), onAdd(reading))}>
            {L.ScaleAdd}
          </Button>
        )}
        <Button disabled={!product} onClick={() => void driver.clear(false)}>
          {L.ScaleCancel}
        </Button>
      </div>
    </section>
  );
}
