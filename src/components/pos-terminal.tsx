"use client";

/**
 * Prodejní terminál — šablona „Pult s váhou“.
 *
 * Dlaždice zboží podle skupin, hledání a čtečka EAN (Enter), zboží na váhu
 * se zadáním hmotnosti, platba hotově (vrácení) nebo kartou, účtenka
 * k tisku (80 mm), otevření směny a uzávěrka. Ceny a DPH počítá server;
 * terminál ukazuje jen orientační součet z cen s DPH.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  MessageBar,
  MessageBarBody,
  Spinner,
  Tab,
  TabList,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowLeft24Regular,
  Backspace24Regular,
  CloudArrowUp24Regular,
  Delete24Regular,
  LockClosed24Regular,
  Money24Regular,
  Payment24Regular,
  Print24Regular,
  Scales24Regular,
  Search24Regular,
} from "@fluentui/react-icons";
import { posCardStartAction, posCardStatusAction, posCloseShiftAction, posEetResendAction, posOpenShiftAction, posSellAction, posShiftSummaryAction } from "@/app/actions";
import { EscPos, grantedPort, receiptEscPos, requestPort, serialSupported, writeToPort, type CodePage } from "@/lib/escpos";
import type { ReceiptPrint } from "@/modules/pos/sale";

export interface PosItem {
  id: string;
  num: string;
  name: string;
  groupId: string;
  unit: string;
  price: string;
  weighed: boolean;
  ean: string | null;
}

interface Line {
  item: PosItem;
  qty: number;
}

const useStyles = makeStyles({
  root: { height: "100dvh", display: "flex", flexDirection: "column", backgroundColor: tokens.colorNeutralBackground2, color: tokens.colorNeutralForeground1 },
  bar: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "8px 16px",
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    flexWrap: "wrap",
  },
  barTitle: { fontSize: tokens.fontSizeBase500, fontWeight: tokens.fontWeightSemibold },
  barInfo: { opacity: 0.85, fontSize: tokens.fontSizeBase300 },
  spacer: { flex: 1 },
  main: {
    flex: 1,
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: "1fr 380px",
    "@media (max-width: 900px)": { gridTemplateColumns: "1fr", gridTemplateRows: "1fr auto", overflowY: "auto" },
  },
  catalog: { display: "flex", flexDirection: "column", minHeight: 0, padding: "12px 16px", gap: "8px" },
  tabs: { overflowX: "auto", flexShrink: 0 },
  tiles: {
    flex: 1,
    overflowY: "auto",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
    gridAutoRows: "minmax(104px, auto)",
    gap: "10px",
    alignContent: "start",
    paddingBottom: "8px",
  },
  tile: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    alignItems: "flex-start",
    textAlign: "left",
    padding: "12px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    cursor: "pointer",
    fontSize: tokens.fontSizeBase400,
    fontFamily: "inherit",
    boxShadow: tokens.shadow2,
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
    ":active": { backgroundColor: tokens.colorBrandBackground2 },
  },
  tileName: { fontWeight: tokens.fontWeightSemibold, lineHeight: tokens.lineHeightBase400 },
  tilePrice: { display: "flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap", color: tokens.colorBrandForeground1, fontWeight: tokens.fontWeightSemibold },
  cart: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    backgroundColor: tokens.colorNeutralBackground1,
    borderLeft: `1px solid ${tokens.colorNeutralStroke2}`,
    "@media (max-width: 900px)": { borderLeft: "none", borderTop: `1px solid ${tokens.colorNeutralStroke2}`, minHeight: "320px" },
  },
  cartHead: { padding: "12px 16px", fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase400, display: "flex", alignItems: "center" },
  lines: { flex: 1, overflowY: "auto", padding: "0 8px" },
  line: { display: "grid", gridTemplateColumns: "1fr auto", gap: "2px 8px", padding: "8px", borderBottom: `1px solid ${tokens.colorNeutralStroke3}` },
  lineName: { fontWeight: tokens.fontWeightSemibold },
  lineSub: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, display: "flex", alignItems: "center", gap: "6px" },
  lineAmt: { textAlign: "right", fontWeight: tokens.fontWeightSemibold, alignSelf: "center" },
  empty: { color: tokens.colorNeutralForeground3, padding: "24px 8px", textAlign: "center" },
  total: { padding: "12px 16px", borderTop: `1px solid ${tokens.colorNeutralStroke2}`, display: "flex", flexDirection: "column", gap: "10px" },
  totalRow: { display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: tokens.fontSizeBase600, fontWeight: tokens.fontWeightBold },
  pay: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" },
  payBtn: { minHeight: "64px", fontSize: tokens.fontSizeBase500 },
  pad: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", marginTop: "12px" },
  padBtn: { minHeight: "56px", fontSize: tokens.fontSizeBase500 },
  big: { fontSize: tokens.fontSizeHero700, fontWeight: tokens.fontWeightBold, textAlign: "center", padding: "8px 0" },
  quick: { display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "8px" },
  sumGrid: { display: "grid", gridTemplateColumns: "1fr auto", gap: "6px 16px", fontSize: tokens.fontSizeBase400 },
  openBox: { margin: "auto", maxWidth: "360px", display: "flex", flexDirection: "column", gap: "12px", padding: "24px" },
  receipt: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    border: `1px dashed ${tokens.colorNeutralStroke1}`,
    padding: "12px",
    maxWidth: "320px",
    margin: "0 auto",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  rRow: { display: "flex", justifyContent: "space-between", gap: "8px" },
  rCenter: { textAlign: "center" },
  rSep: { borderTop: `1px dashed ${tokens.colorNeutralStroke1}`, margin: "6px 0" },
  rBold: { fontWeight: tokens.fontWeightBold, fontSize: tokens.fontSizeBase400 },
});

const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  .pos-receipt, .pos-receipt * { visibility: visible !important; }
  .pos-receipt { position: fixed; left: 0; top: 0; width: 72mm; border: none !important; }
}`;

export function PosTerminal(p: {
  register: { id: string; code: string; name: string; roundCash: boolean };
  shift: { id: string; num: string } | null;
  items: PosItem[];
  groups: { id: string; name: string }[];
  printer: { driver: string; paperWidth: string; codePage: CodePage; baudRate: number; openDrawer: boolean; autoPrint: boolean } | null;
  payment: { driver: string } | null;
  eet: { pending: number } | null;
  user: string;
  lang: string;
  labels: Record<string, string>;
}) {
  const st = useStyles();
  const L = p.labels;
  const locale = p.lang === "en" ? "en-GB" : "cs-CZ";
  const money = useMemo(() => new Intl.NumberFormat(locale, { style: "currency", currency: "CZK" }), [locale]);
  const num = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }), [locale]);
  const fmt = (v: string | number) => money.format(Number(v));

  const [shift, setShift] = useState(p.shift);
  const [group, setGroup] = useState("all");
  const [q, setQ] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [weigh, setWeigh] = useState<{ item: PosItem; value: string } | null>(null);
  const [payDlg, setPayDlg] = useState<"cash" | "card" | null>(null);
  // způsob a částka zůstanou i během zavírací animace dialogu
  const [method, setMethod] = useState<"cash" | "card">("cash");
  const [due, setDue] = useState(0);
  const [given, setGiven] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [receipt, setReceipt] = useState<ReceiptPrint | null>(null);
  const [opening, setOpening] = useState("");
  const [summary, setSummary] = useState<Record<string, string | number> | null>(null);
  const search = useRef<HTMLInputElement>(null);
  // platební terminál: stav čekání na kartu
  const [card, setCard] = useState<{ ref: string; state: "waiting" | "declined"; message?: string } | null>(null);
  const cardLoop = useRef(0);
  const [eetPending, setEetPending] = useState(p.eet?.pending ?? 0);
  const serialPrinter = p.printer?.driver === "escposSerial";
  const [portReady, setPortReady] = useState(false);
  const terminalPay = !!p.payment && p.payment.driver !== "manual";

  useEffect(() => {
    if (serialPrinter) void grantedPort().then((port) => setPortReady(!!port));
  }, [serialPrinter]);

  const escpos = async (r: ReceiptPrint | null, drawerOnly = false) => {
    const pr = p.printer!;
    const port = await grantedPort();
    if (!port) {
      setPortReady(false);
      return;
    }
    const width = pr.paperWidth === "58" ? 32 : 48;
    const bytes =
      drawerOnly || !r
        ? Uint8Array.from(new EscPos(width, pr.codePage).drawer().bytes)
        : receiptEscPos(r, L, fmt, { width, codePage: pr.codePage, drawer: pr.openDrawer && r.payment === "cash", locale });
    await writeToPort(port, bytes, pr.baudRate || 9600).catch((e) => setError(String(e)));
  };
  const printReceipt = (r: ReceiptPrint) => (serialPrinter ? escpos(r) : window.print());
  const connectPrinter = async () => {
    if (!serialSupported()) return setError(L.PrinterUnsupported);
    const port = await requestPort().catch(() => null);
    setPortReady(!!port);
  };

  const total = lines.reduce((a, l) => a + Math.round(Number(l.item.price) * l.qty * 100), 0) / 100;
  const startPay = (m: "cash" | "card") => {
    setError(undefined);
    setMethod(m);
    setDue(m === "cash" && p.register.roundCash ? Math.round(total) : total);
    setPayDlg(m);
  };
  const toPay = due;
  const givenNum = Number(given.replace(",", ".")) || 0;

  const visible = useMemo(() => {
    const n = q.trim().toLowerCase();
    return p.items.filter(
      (i) => (group === "all" || i.groupId === group) && (!n || i.name.toLowerCase().includes(n) || i.num.toLowerCase().includes(n) || i.ean === n),
    );
  }, [p.items, group, q]);

  // po zavření dialogů vrátit fokus do hledání (čtečka EAN píše tam)
  useEffect(() => {
    if (!weigh && !payDlg && !receipt && !summary) search.current?.focus();
  }, [weigh, payDlg, receipt, summary]);

  const add = (item: PosItem, qty = 1) =>
    setLines((ls) => {
      const i = ls.findIndex((l) => l.item.id === item.id && !item.weighed);
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + qty } : l));
      return [...ls, { item, qty }];
    });

  const pick = (item: PosItem) => {
    setError(undefined);
    if (item.weighed) setWeigh({ item, value: "" });
    else add(item);
  };

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    const n = q.trim().toLowerCase();
    const hit = p.items.find((i) => i.ean === n || i.num.toLowerCase() === n) ?? (visible.length === 1 ? visible[0] : null);
    if (hit) {
      pick(hit);
      setQ("");
    }
  };

  const saleLines = () => lines.map((l) => ({ itemId: l.item.id, qty: String(Number(l.qty.toFixed(3))) }));

  const finishSale = async (payment: "cash" | "card", paymentRef: string | null) => {
    setBusy(true);
    setError(undefined);
    const res = await posSellAction({
      registerId: p.register.id,
      payment,
      cashGiven: payment === "cash" && given ? given.replace(",", ".") : null,
      paymentRef,
      lines: saleLines(),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setPayDlg(null);
    setCard(null);
    setGiven("");
    setLines([]);
    setReceipt(res.data);
    if (typeof res.data.eetQueue === "number") setEetPending(res.data.eetQueue);
    if (p.printer?.autoPrint) {
      if (serialPrinter) void escpos(res.data);
      else setTimeout(() => window.print(), 300);
    } else if (serialPrinter && p.printer?.openDrawer && payment === "cash") void escpos(null, true);
  };

  /** Karta přes terminál: zahájit, čekat na výsledek, pak vystavit účtenku. */
  const payByTerminal = async () => {
    setBusy(true);
    setError(undefined);
    const start = await posCardStartAction({ registerId: p.register.id, payment: "card", lines: saleLines() });
    setBusy(false);
    if (!start.ok) return setError(start.message);
    const ref = start.data.ref;
    const loop = ++cardLoop.current;
    setCard({ ref, state: "waiting" });
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      if (cardLoop.current !== loop) return; // zrušeno
      const st = await posCardStatusAction(p.register.id, ref);
      if (cardLoop.current !== loop) return;
      if (!st.ok) return setCard({ ref, state: "declined", message: st.message });
      if (st.data?.state === "successful") return finishSale("card", ref);
      if (st.data?.state === "failed") return setCard({ ref, state: "declined", message: st.data.message });
    }
  };

  const cancelCard = async () => {
    const ref = card?.ref;
    cardLoop.current++;
    setCard(null);
    if (ref) await posCardStatusAction(p.register.id, ref, true);
  };

  const pay = async () => {
    if (!payDlg) return;
    if (payDlg === "card" && terminalPay) return payByTerminal();
    return finishSale(payDlg, null);
  };

  const resendEet = async () => {
    setBusy(true);
    const res = await posEetResendAction(p.register.id);
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setEetPending(res.data.pending);
  };

  const openShift = async () => {
    setBusy(true);
    const res = await posOpenShiftAction(p.register.id, opening.replace(",", ".") || "0");
    setBusy(false);
    if (!res.ok) return setError(res.message);
    window.location.reload();
  };

  const showSummary = async () => {
    setBusy(true);
    const res = await posShiftSummaryAction(p.register.id);
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setSummary(res.data);
  };

  const closeShift = async () => {
    setBusy(true);
    const res = await posCloseShiftAction(p.register.id);
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setSummary(null);
    setShift(null);
  };

  return (
    <div className={st.root}>
      <style>{PRINT_CSS.replace("72mm", p.printer?.paperWidth === "58" ? "48mm" : "72mm")}</style>
      <header className={st.bar}>
        <Button as="a" appearance="transparent" href="/pos" icon={<ArrowLeft24Regular />} aria-label={L.Back} style={{ color: "inherit" }} />
        <span className={st.barTitle}>{p.register.name}</span>
        <span className={st.barInfo}>
          {shift ? `${L.Shift} ${shift.num}` : L.Closed} · {p.user}
        </span>
        <span className={st.spacer} />
        {eetPending > 0 && (
          <Button icon={<CloudArrowUp24Regular />} onClick={resendEet} disabled={busy} title={L.EetPendingInfo.replace("{n}", String(eetPending))}>
            {L.EetResend} ({eetPending})
          </Button>
        )}
        {serialPrinter && !portReady && (
          <Button icon={<Print24Regular />} onClick={connectPrinter}>
            {L.PrinterConnect}
          </Button>
        )}
        {shift && (
          <Button icon={<LockClosed24Regular />} onClick={showSummary} disabled={busy || lines.length > 0}>
            {L.CloseShift}
          </Button>
        )}
      </header>

      {error && !payDlg && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      {!shift ? (
        <div className={st.openBox}>
          <p>{L.ShiftClosedInfo}</p>
          <Input value={opening} onChange={(_, d) => setOpening(d.value)} inputMode="decimal" contentAfter="Kč" aria-label={L.OpeningCash} placeholder={L.OpeningCash} size="large" />
          <Numpad st={st} set={setOpening} />
          <Button appearance="primary" size="large" disabled={busy} onClick={openShift}>
            {L.OpenShift}
          </Button>
        </div>
      ) : (
        <div className={st.main}>
          <section className={st.catalog}>
            <Input
              ref={search}
              value={q}
              onChange={(_, d) => setQ(d.value)}
              onKeyDown={onSearchKey}
              contentBefore={<Search24Regular />}
              placeholder={L.Search}
              aria-label={L.Search}
              size="large"
            />
            <TabList className={st.tabs} selectedValue={group} onTabSelect={(_, d) => setGroup(String(d.value))}>
              <Tab value="all">{L.All}</Tab>
              {p.groups.map((g) => (
                <Tab key={g.id} value={g.id}>
                  {g.name}
                </Tab>
              ))}
            </TabList>
            {!p.items.length && <p className={st.empty}>{L.NoItems}</p>}
            <div className={st.tiles}>
              {visible.map((i) => (
                <button key={i.id} type="button" className={st.tile} onClick={() => pick(i)}>
                  <span className={st.tileName}>{i.name}</span>
                  <span className={st.tilePrice}>
                    {i.weighed && <Scales24Regular fontSize={16} />}
                    {fmt(i.price)}
                    {i.unit && i.unit !== "KS" ? ` / ${i.unit.toLowerCase()}` : ""}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <aside className={st.cart} aria-label={L.Cart}>
            <div className={st.cartHead}>
              {L.Cart}
              <span className={st.spacer} />
              {lines.length > 0 && (
                <Button appearance="subtle" size="small" onClick={() => setLines([])}>
                  {L.Clear}
                </Button>
              )}
            </div>
            <div className={st.lines}>
              {!lines.length && <p className={st.empty}>{L.EmptyCart}</p>}
              {lines.map((l, idx) => (
                <div key={idx} className={st.line}>
                  <span className={st.lineName}>{l.item.name}</span>
                  <span className={st.lineAmt}>{fmt(Math.round(Number(l.item.price) * l.qty * 100) / 100)}</span>
                  <span className={st.lineSub}>
                    {l.item.weighed ? `${num.format(l.qty)} ${l.item.unit.toLowerCase()} ×` : `${l.qty} ×`} {fmt(l.item.price)}
                    {!l.item.weighed && (
                      <>
                        <Button size="small" onClick={() => setLines((ls) => ls.map((x, j) => (j === idx ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))} aria-label="−">
                          −
                        </Button>
                        <Button size="small" onClick={() => setLines((ls) => ls.map((x, j) => (j === idx ? { ...x, qty: x.qty + 1 } : x)))} aria-label="+">
                          +
                        </Button>
                      </>
                    )}
                  </span>
                  <Button
                    size="small"
                    appearance="subtle"
                    icon={<Delete24Regular />}
                    aria-label={L.Cancel}
                    onClick={() => setLines((ls) => ls.filter((_, j) => j !== idx))}
                  />
                </div>
              ))}
            </div>
            <div className={st.total}>
              <div className={st.totalRow}>
                <span>{L.Total}</span>
                <span>{fmt(total)}</span>
              </div>
              <div className={st.pay}>
                <Button appearance="primary" className={st.payBtn} icon={<Money24Regular />} disabled={!lines.length} onClick={() => startPay("cash")}>
                  {L.PayCash}
                </Button>
                <Button className={st.payBtn} icon={<Payment24Regular />} disabled={!lines.length} onClick={() => startPay("card")}>
                  {L.PayCard}
                </Button>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* hmotnost */}
      <Dialog open={!!weigh} onOpenChange={(_, d) => !d.open && setWeigh(null)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{weigh?.item.name}</DialogTitle>
            <DialogContent>
              <Input
                value={weigh?.value ?? ""}
                onChange={(_, d) => setWeigh((w) => (w ? { ...w, value: d.value } : w))}
                onKeyDown={(e) => e.key === "Enter" && Number(weigh?.value.replace(",", ".")) > 0 && (add(weigh!.item, Number(weigh!.value.replace(",", "."))), setWeigh(null))}
                inputMode="decimal"
                size="large"
                autoFocus
                aria-label={L.Weight}
                placeholder={L.Weight}
                contentAfter={weigh?.item.unit.toLowerCase()}
              />
              <div className={st.big}>{fmt((Number(weigh?.value.replace(",", ".")) || 0) * Number(weigh?.item.price ?? 0))}</div>
              <Numpad st={st} set={(f) => setWeigh((w) => (w ? { ...w, value: f(w.value) } : w))} />
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setWeigh(null)}>{L.Cancel}</Button>
              <Button
                appearance="primary"
                disabled={!(Number(weigh?.value.replace(",", ".")) > 0)}
                onClick={() => {
                  add(weigh!.item, Number(weigh!.value.replace(",", ".")));
                  setWeigh(null);
                }}
              >
                {L.Add}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* platba */}
      <Dialog open={!!payDlg} onOpenChange={(_, d) => !d.open && !busy && setPayDlg(null)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{method === "cash" ? L.PayCash : L.PayCard}</DialogTitle>
            <DialogContent>
              {error && (
                <MessageBar intent="error">
                  <MessageBarBody>{error}</MessageBarBody>
                </MessageBar>
              )}
              <div>{L.ToPay}</div>
              <div className={st.big}>{fmt(toPay)}</div>
              {method === "cash" && (
                <>
                  <Input value={given} onChange={(_, d) => setGiven(d.value)} inputMode="decimal" size="large" aria-label={L.Received} placeholder={L.Received} contentAfter="Kč" />
                  <div className={st.quick}>
                    {[toPay, 100, 200, 500, 1000, 2000, 5000]
                      .filter((v, i) => i === 0 || v > toPay)
                      .slice(0, 5)
                      .map((v) => (
                        <Button key={v} onClick={() => setGiven(String(v).replace(".", ","))}>
                          {fmt(v)}
                        </Button>
                      ))}
                  </div>
                  <Numpad st={st} set={setGiven} />
                  {givenNum > 0 && (
                    <div className={st.sumGrid} style={{ marginTop: 12 }}>
                      <span>{L.ChangeDue}</span>
                      <strong>{givenNum >= toPay ? fmt(givenNum - toPay) : "—"}</strong>
                    </div>
                  )}
                </>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setPayDlg(null)} disabled={busy}>
                {L.Cancel}
              </Button>
              <Button appearance="primary" size="large" disabled={busy || (payDlg === "cash" && givenNum > 0 && givenNum < toPay)} onClick={pay}>
                {busy ? <Spinner size="tiny" /> : L.Confirm}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* platba na terminálu */}
      <Dialog open={!!card} onOpenChange={(_, d) => !d.open && card?.state === "declined" && setCard(null)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{card?.state === "declined" ? L.CardDeclined : L.CardWaiting}</DialogTitle>
            <DialogContent>
              <div className={st.big}>{fmt(due)}</div>
              {card?.state === "waiting" ? (
                <>
                  <Spinner />
                  <p style={{ textAlign: "center" }}>{L.CardWaitingInfo}</p>
                </>
              ) : (
                <MessageBar intent="error">
                  <MessageBarBody>{card?.message ?? L.CardDeclined}</MessageBarBody>
                </MessageBar>
              )}
              {error && (
                <MessageBar intent="error">
                  <MessageBarBody>{error}</MessageBarBody>
                </MessageBar>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={cancelCard} disabled={busy}>
                {L.Cancel}
              </Button>
              {card?.state === "declined" && (
                <Button appearance="primary" onClick={() => (setCard(null), payByTerminal())} disabled={busy}>
                  {L.Retry}
                </Button>
              )}
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* účtenka */}
      <Dialog open={!!receipt} onOpenChange={(_, d) => !d.open && setReceipt(null)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              {L.Paid}
              {receipt?.change && Number(receipt.change) > 0 ? ` · ${L.ChangeDue} ${fmt(receipt.change)}` : ""}
            </DialogTitle>
            <DialogContent>{receipt && <Receipt r={receipt} L={L} fmt={fmt} st={st} locale={locale} />}</DialogContent>
            <DialogActions>
              <Button icon={<Print24Regular />} onClick={() => receipt && printReceipt(receipt)}>
                {L.PrintReceipt}
              </Button>
              <Button appearance="primary" size="large" onClick={() => setReceipt(null)}>
                {L.NewSale}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* uzávěrka */}
      <Dialog open={!!summary} onOpenChange={(_, d) => !d.open && !busy && setSummary(null)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              {L.ShiftSummary} {summary?.shiftNum}
            </DialogTitle>
            <DialogContent>
              {summary && (
                <div className={st.sumGrid}>
                  <span>{L.ReceiptCount}</span>
                  <strong>{summary.receiptCount}</strong>
                  <span>{L.SalesGross}</span>
                  <strong>{fmt(summary.gross)}</strong>
                  <span>{L.Vat}</span>
                  <span>{fmt(summary.tax)}</span>
                  <span>{L.CashTotal}</span>
                  <span>{fmt(summary.cash)}</span>
                  <span>{L.CardTotal}</span>
                  <span>{fmt(summary.card)}</span>
                  <span>{L.Rounding}</span>
                  <span>{fmt(summary.rounding)}</span>
                  <span>{L.OpeningCash}</span>
                  <span>{fmt(summary.openingCash)}</span>
                  <span>{L.ExpectedCash}</span>
                  <strong>{fmt(summary.expectedCash)}</strong>
                </div>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setSummary(null)} disabled={busy}>
                {L.Back}
              </Button>
              <Button appearance="primary" onClick={closeShift} disabled={busy}>
                {L.ConfirmClose}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}

const padKey = (k: string, v: string) =>
  k === "⌫" ? v.slice(0, -1) : k === "," ? (v.includes(",") ? v : (v || "0") + ",") : (v + k).replace(/^0(\d)/, "$1");

/** Číselník pro dotykové zadání hmotnosti a částek. */
function Numpad({ set, st }: { set: (f: (v: string) => string) => void; st: ReturnType<typeof useStyles> }) {
  return (
    <div className={st.pad}>
      {["7", "8", "9", "4", "5", "6", "1", "2", "3", ",", "0", "⌫"].map((k) => (
        <Button key={k} className={st.padBtn} onClick={() => set((v) => padKey(k, v))} aria-label={k === "⌫" ? "Backspace" : k}>
          {k === "⌫" ? <Backspace24Regular /> : k}
        </Button>
      ))}
    </div>
  );
}

function Receipt({
  r,
  L,
  fmt,
  st,
  locale,
}: {
  r: ReceiptPrint;
  L: Record<string, string>;
  fmt: (v: string | number) => string;
  st: ReturnType<typeof useStyles>;
  locale: string;
}) {
  const n = (v: string) => new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(Number(v));
  return (
    <div className={mergeClasses("pos-receipt", st.receipt)}>
      <div className={mergeClasses(st.rCenter, st.rBold)}>{r.company.name}</div>
      {r.company.address && <div className={st.rCenter}>{r.company.address}</div>}
      <div className={st.rCenter}>
        {r.company.regNo && `IČO ${r.company.regNo}`} {r.company.vatId && `DIČ ${r.company.vatId}`}
      </div>
      <div className={st.rSep} />
      <div className={st.rRow}>
        <span>{L.SimplifiedDoc}</span>
        <span>{r.receiptNum}</span>
      </div>
      <div className={st.rRow}>
        <span>{r.register}</span>
        <span>{new Date(r.issuedAt).toLocaleString(locale)}</span>
      </div>
      <div className={st.rSep} />
      {r.lines.map((l, i) => (
        <div key={i}>
          <div>{l.description}</div>
          <div className={st.rRow}>
            <span>
              {n(l.qty)} {l.unit.toLowerCase()} × {fmt(l.unitPrice)} ({l.rate} %)
            </span>
            <span>{fmt(l.amount)}</span>
          </div>
        </div>
      ))}
      <div className={st.rSep} />
      {Number(r.rounding) !== 0 && (
        <div className={st.rRow}>
          <span>{L.Rounding}</span>
          <span>{fmt(r.rounding)}</span>
        </div>
      )}
      <div className={mergeClasses(st.rRow, st.rBold)}>
        <span>{L.Total}</span>
        <span>{fmt(r.paid)}</span>
      </div>
      <div className={st.rRow}>
        <span>{r.payment === "cash" ? L.Cash : L.Card}</span>
        <span>{fmt(r.cashGiven ?? r.paid)}</span>
      </div>
      {r.change && Number(r.change) > 0 && (
        <div className={st.rRow}>
          <span>{L.ChangeDue}</span>
          <span>{fmt(r.change)}</span>
        </div>
      )}
      <div className={st.rSep} />
      <div>{L.VatRecap}</div>
      {r.vat.map((v) => (
        <div key={v.rate} className={st.rRow}>
          <span>
            {v.rate} % · {L.Base} {fmt(v.base)}
          </span>
          <span>
            {L.Vat} {fmt(v.tax)}
          </span>
        </div>
      ))}
      {r.eet && (
        <>
          <div className={st.rSep} />
          <div>{r.eet.pok ? `POK: ${r.eet.pok}` : L.EetLater}</div>
        </>
      )}
      {r.footer && (
        <>
          <div className={st.rSep} />
          <div className={st.rCenter}>{r.footer}</div>
        </>
      )}
    </div>
  );
}
