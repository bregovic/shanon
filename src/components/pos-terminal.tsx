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
  Text,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowLeft24Regular,
  Backspace24Regular,
  Dismiss24Regular,
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
  /** kategorie prodeje (strom); bez kategorií se kasa člení podle skupin položek */
  categoryId?: string | null;
  unit: string;
  price: string;
  /** běžná cena, když platí akce */
  regular?: string | null;
  weighed: boolean;
  ean: string | null;
  /** id souboru obrázku (/api/files/<id>) */
  image?: string | null;
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
  wUnits: { display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "12px", alignItems: "center" },
  wSep: { width: "8px" },
  chips: { display: "flex", gap: "8px", overflowX: "auto", flexShrink: 0, paddingBottom: "4px" },
  searchInfo: { color: tokens.colorNeutralForeground3 },
  tiles: {
    flex: 1,
    overflowY: "auto",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
    gridAutoRows: "max-content",
    gap: "10px",
    alignContent: "start",
    paddingBottom: "8px",
  },
  tile: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "6px",
    minHeight: "104px",
    overflow: "hidden",
    textAlign: "left",
    padding: "10px 12px",
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
  regular: { color: tokens.colorNeutralForeground3, fontWeight: tokens.fontWeightRegular },
  tileImg: { width: "100%", height: "96px", objectFit: "contain", borderRadius: tokens.borderRadiusMedium, flexShrink: 0 },
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
  lineWrap: { position: "relative", overflow: "hidden", borderBottom: `1px solid ${tokens.colorNeutralStroke3}` },
  lineBehind: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingRight: "16px",
    backgroundColor: tokens.colorPaletteRedBackground3,
    color: tokens.colorNeutralForegroundOnBrand,
    fontWeight: tokens.fontWeightSemibold,
  },
  lineCard: {
    position: "relative",
    display: "grid",
    gridTemplateColumns: "auto 1fr auto",
    alignItems: "center",
    gap: "4px 12px",
    padding: "10px 8px",
    backgroundColor: tokens.colorNeutralBackground1,
    touchAction: "pan-y",
    userSelect: "none",
    transition: "transform 0.15s ease-out, background-color 0.6s",
  },
  lineFlash: { backgroundColor: tokens.colorBrandBackground2, transition: "none" },
  qtyBadge: {
    minWidth: "52px",
    padding: "6px 8px",
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightBold,
    textAlign: "center",
    cursor: "pointer",
    border: "none",
    fontFamily: "inherit",
  },
  stepper: { gridColumn: "2 / 4", display: "flex", gap: "8px", justifyContent: "flex-end" },
  stepBtn: { minWidth: "48px", minHeight: "40px", fontSize: tokens.fontSizeBase500 },
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
  categories: { id: string; name: string; parentId: string | null }[];
  /** nejčastěji prodávané položky (id) */
  top: string[];
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
  // záložka: "top" nejčastější, "all" vše, jinak id hlavní kategorie / skupiny; sub = podkategorie
  const [group, setGroup] = useState(p.top.length ? "top" : "all");
  const [sub, setSub] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  // zadání množství / hmotnosti: nový řádek (idx = null) nebo úprava řádku nákupu
  const [weigh, setWeigh] = useState<{ item: PosItem; value: string; idx?: number | null } | null>(null);
  // jednotka zadání hmotnosti u položek na kg (30 dkg = 0,3 kg); poslední volba se pamatuje
  const [wUnit, setWUnitState] = useState<WeightUnit>(() => {
    try {
      const v = typeof window !== "undefined" ? localStorage.getItem("pos.weightUnit") : null;
      return v === "kg" || v === "g" || v === "dkg" ? v : "dkg";
    } catch {
      return "dkg";
    }
  });
  const setWUnit = (u: WeightUnit) => {
    setWUnitState(u);
    try {
      localStorage.setItem("pos.weightUnit", u);
    } catch {
      /* bez úložiště jen pro tuto relaci */
    }
  };
  const isKg = (i?: PosItem) => !!i && i.weighed && i.unit.toUpperCase() === "KG";
  /** zadané množství přepočtené na jednotku položky */
  const qtyOf = (w: { item: PosItem; value: string } | null) => {
    const n = Number(w?.value.replace(",", ".")) || 0;
    return isKg(w?.item) ? Math.round(n * W_FACTOR[wUnit] * 1000) / 1000 : n;
  };
  // naposledy změněný řádek — krátce zvýrazněný
  const [flash, setFlash] = useState<{ id: string; n: number } | null>(null);
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

  // strom kategorií: bez kategorií záložky podle skupin položek
  const useCats = p.categories.length > 0 && p.items.some((i) => i.categoryId);
  const roots = useCats ? p.categories.filter((c) => !c.parentId) : p.groups.map((g) => ({ ...g, parentId: null }));
  const children = (id: string) => p.categories.filter((c) => c.parentId === id);
  const catName = useMemo(() => new Map(p.categories.map((c) => [c.id, c.name])), [p.categories]);
  /** kategorie a všichni její potomci */
  const subtree = (id: string): Set<string> => {
    const out = new Set([id]);
    for (const c of children(id)) for (const x of subtree(c.id)) out.add(x);
    return out;
  };

  const visible = useMemo(() => {
    const words = foldText(q).split(/\s+/).filter(Boolean);
    if (words.length) {
      // hledání napříč kategoriemi: všechna slova jako začátky slov názvu, nebo kód / EAN / kategorie
      const scored = p.items
        .map((i) => {
          const name = foldText(i.name);
          const hay = `${name} ${foldText(i.num)} ${i.ean ?? ""} ${foldText(catName.get(i.categoryId ?? "") ?? "")}`;
          const nameWords = name.split(/[^a-z0-9]+/);
          if (!words.every((w) => hay.includes(w))) return null;
          const score = words.reduce((a, w) => a + (nameWords.some((x) => x.startsWith(w)) ? 2 : 0) + (foldText(i.num) === w || i.ean === w ? 5 : 0), 0);
          return { i, score };
        })
        .filter((x): x is { i: PosItem; score: number } => !!x)
        .sort((a, b) => b.score - a.score || a.i.name.localeCompare(b.i.name, "cs"));
      return scored.map((x) => x.i);
    }
    if (group === "top") {
      const order = new Map(p.top.map((id, k) => [id, k]));
      return p.items.filter((i) => order.has(i.id)).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    }
    if (group === "all") return p.items;
    if (!useCats) return p.items.filter((i) => i.groupId === group);
    const ids = subtree(sub ?? group);
    return p.items.filter((i) => i.categoryId && ids.has(i.categoryId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.items, p.top, group, sub, q, useCats, catName]);

  // psaní kdekoli na stránce jde do hledání (pokud není otevřený dialog ani jiné pole)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (weigh || payDlg || receipt || summary || card) return;
      if (["INPUT", "TEXTAREA"].includes(el.tagName) || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      search.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [weigh, payDlg, receipt, summary, card]);

  // po zavření dialogů vrátit fokus do hledání (čtečka EAN píše tam)
  useEffect(() => {
    if (!weigh && !payDlg && !receipt && !summary) search.current?.focus();
  }, [weigh, payDlg, receipt, summary]);

  const add = (item: PosItem, qty = 1) => {
    setFlash((f) => ({ id: item.id, n: (f?.n ?? 0) + 1 }));
    setLines((ls) => {
      const i = ls.findIndex((l) => l.item.id === item.id && !item.weighed);
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + qty } : l));
      return [...ls, { item, qty }];
    });
  };
  const setQty = (idx: number, qty: number) => {
    if (qty <= 0) return setLines((ls) => ls.filter((_, j) => j !== idx));
    setLines((ls) => ls.map((x, j) => (j === idx ? { ...x, qty } : x)));
    const id = lines[idx]?.item.id;
    if (id) setFlash((f) => ({ id, n: (f?.n ?? 0) + 1 }));
  };
  const remove = (idx: number) => setLines((ls) => ls.filter((_, j) => j !== idx));
  /** potvrzení dialogu množství */
  const confirmQty = () => {
    if (!weigh) return;
    const v = qtyOf(weigh);
    if (!(v >= 0)) return;
    if (weigh.idx !== undefined && weigh.idx !== null) setQty(weigh.idx, v);
    else if (v > 0) add(weigh.item, v);
    setWeigh(null);
  };

  const pick = (item: PosItem) => {
    setError(undefined);
    if (item.weighed) setWeigh({ item, value: "" });
    else add(item);
  };
  /** podržení dlaždice: zadat množství rovnou */
  const pickQty = (item: PosItem) => {
    setError(undefined);
    setWeigh({ item, value: "", idx: null });
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
              contentAfter={
                q ? (
                  <Button appearance="transparent" size="small" icon={<Dismiss24Regular />} aria-label={L.Clear} onClick={() => (setQ(""), search.current?.focus())} />
                ) : undefined
              }
              placeholder={L.Search}
              aria-label={L.Search}
              size="large"
            />
            <TabList
              className={st.tabs}
              selectedValue={q.trim() ? "" : group}
              onTabSelect={(_, d) => {
                setGroup(String(d.value));
                setSub(null);
                setQ("");
              }}
            >
              {p.top.length > 0 && <Tab value="top">{L.Top}</Tab>}
              <Tab value="all">{L.All}</Tab>
              {roots.map((g) => (
                <Tab key={g.id} value={g.id}>
                  {g.name}
                </Tab>
              ))}
            </TabList>
            {useCats && !q.trim() && group !== "all" && group !== "top" && children(group).length > 0 && (
              <div className={st.chips}>
                <Button size="large" shape="circular" appearance={sub === null ? "primary" : "secondary"} onClick={() => setSub(null)}>
                  {L.All}
                </Button>
                {children(group).map((c) => (
                  <Button key={c.id} size="large" shape="circular" appearance={sub === c.id ? "primary" : "secondary"} onClick={() => setSub(c.id)}>
                    {c.name}
                  </Button>
                ))}
              </div>
            )}
            {q.trim() && <Text className={st.searchInfo}>{L.SearchResults.replace("{n}", String(visible.length))}</Text>}
            {!p.items.length && <p className={st.empty}>{L.NoItems}</p>}
            <div className={st.tiles}>
              {visible.map((i) => (
                <button key={i.id} type="button" className={st.tile} {...pressHandlers(() => pick(i), () => pickQty(i))} onContextMenu={(e) => e.preventDefault()}>
                  {i.image && (
                    // eslint-disable-next-line @next/next/no-img-element -- soubor za přihlášením, prohlížeč ho cachuje
                    <img src={`/api/files/${i.image}`} alt="" loading="lazy" className={st.tileImg} />
                  )}
                  <span className={st.tileName}>{i.name}</span>
                  <span className={st.tilePrice}>
                    {i.weighed && <Scales24Regular fontSize={16} />}
                    {i.regular && <s className={st.regular}>{fmt(i.regular)}</s>}
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
                <CartLine
                  key={`${l.item.id}-${idx}`}
                  st={st}
                  flash={flash?.id === l.item.id ? flash.n : 0}
                  qtyText={l.item.weighed ? `${num.format(l.qty)} ${l.item.unit.toLowerCase()}` : `${l.qty}×`}
                  name={l.item.name}
                  unitPrice={`${fmt(l.item.price)}${l.item.unit && l.item.unit !== "KS" ? ` / ${l.item.unit.toLowerCase()}` : ""}`}
                  amount={fmt(Math.round(Number(l.item.price) * l.qty * 100) / 100)}
                  stepper={!l.item.weighed}
                  labels={{ minus: L.Less, plus: L.More, remove: L.Remove, qty: L.Quantity }}
                  onMinus={() => setQty(idx, l.qty - 1)}
                  onPlus={() => setQty(idx, l.qty + 1)}
                  onEdit={() => setWeigh({ item: l.item, value: num.format(isKg(l.item) ? l.qty / W_FACTOR[wUnit] : l.qty).replace(/\s/g, ""), idx })}
                  onRemove={() => remove(idx)}
                />
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
              {isKg(weigh?.item) && (
                <div className={st.wUnits}>
                  {(["kg", "dkg", "g"] as const).map((u) => (
                    <Button key={u} size="large" shape="circular" appearance={wUnit === u ? "primary" : "secondary"} onClick={() => setWUnit(u)}>
                      {u}
                    </Button>
                  ))}
                  <span className={st.wSep} />
                  {W_PRESETS[wUnit].map((v) => (
                    <Button key={v} size="large" onClick={() => setWeigh((w) => (w ? { ...w, value: v } : w))}>
                      {v}
                    </Button>
                  ))}
                </div>
              )}
              <Input
                value={weigh?.value ?? ""}
                onChange={(_, d) => setWeigh((w) => (w ? { ...w, value: d.value } : w))}
                onKeyDown={(e) => e.key === "Enter" && confirmQty()}
                inputMode="decimal"
                size="large"
                autoFocus
                aria-label={weigh?.item.weighed ? L.Weight : L.Quantity}
                placeholder={weigh?.item.weighed ? L.Weight : L.Quantity}
                contentAfter={isKg(weigh?.item) ? wUnit : weigh?.item.unit.toLowerCase()}
              />
              <div className={st.big}>{fmt(qtyOf(weigh) * Number(weigh?.item.price ?? 0))}</div>
              <Numpad st={st} set={(f) => setWeigh((w) => (w ? { ...w, value: f(w.value) } : w))} />
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setWeigh(null)}>{L.Cancel}</Button>
              <Button
                appearance="primary"
                // úprava řádku smí i 0 (= odebrat), nový řádek jen kladné množství
                disabled={!(qtyOf(weigh) > 0 || (weigh?.idx != null && weigh?.value.trim() === "0"))}
                onClick={confirmQty}
              >
                {weigh?.idx != null ? L.Save : L.Add}
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

/** text bez diakritiky malými písmeny (hledání) */
const foldText = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const LONG_PRESS_MS = 500;

type WeightUnit = "kg" | "dkg" | "g";
const W_FACTOR: Record<WeightUnit, number> = { kg: 1, dkg: 0.01, g: 0.001 };
/** rychlé volby hmotnosti podle jednotky zadání */
const W_PRESETS: Record<WeightUnit, string[]> = { kg: ["0,25", "0,5", "1"], dkg: ["10", "15", "20", "30", "50"], g: ["100", "150", "200", "300", "500"] };
const SWIPE_REMOVE_PX = 90;

/** Ťuknutí vs. podržení prstu (myš i dotyk). */
function pressHandlers(onTap: () => void, onLong: () => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let long = false;
  let start = { x: 0, y: 0 };
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      long = false;
      start = { x: e.clientX, y: e.clientY };
      clear();
      timer = setTimeout(() => {
        long = true;
        onLong();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (Math.abs(e.clientX - start.x) > 10 || Math.abs(e.clientY - start.y) > 10) clear();
    },
    onPointerUp: () => {
      const wasTimer = !!timer;
      clear();
      if (!long && wasTimer) onTap();
    },
    onPointerLeave: clear,
    onPointerCancel: clear,
  };
}

/**
 * Řádek nákupu: výrazné množství, − / + pro kusy, podržení = zadat množství,
 * přejetí doleva = odebrat (myší i prstem). Změněný řádek krátce zabliká.
 */
function CartLine(p: {
  st: ReturnType<typeof useStyles>;
  flash: number;
  qtyText: string;
  name: string;
  unitPrice: string;
  amount: string;
  stepper: boolean;
  labels: { minus: string; plus: string; remove: string; qty: string };
  onMinus: () => void;
  onPlus: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { st } = p;
  const [dx, setDx] = useState(0);
  const [lit, setLit] = useState(false);
  // zvýraznění po přidání / změně: nová hodnota flash rozsvítí řádek (vzor „předchozí hodnota ve stavu“)
  const [seen, setSeen] = useState(p.flash);
  if (p.flash !== seen) {
    setSeen(p.flash);
    if (p.flash) setLit(true);
  }
  const drag = useRef<{ x: number; y: number; active: boolean; timer: ReturnType<typeof setTimeout> | null; long: boolean } | null>(null);
  useEffect(() => {
    if (!lit) return;
    const t = setTimeout(() => setLit(false), 450);
    return () => clearTimeout(t);
  }, [lit]);

  const end = () => {
    const d = drag.current;
    if (d?.timer) clearTimeout(d.timer);
    drag.current = null;
    if (dx <= -SWIPE_REMOVE_PX) p.onRemove();
    setDx(0);
  };

  return (
    <div className={st.lineWrap}>
      <div className={st.lineBehind} aria-hidden>
        {p.labels.remove}
      </div>
      <div
        className={mergeClasses(st.lineCard, lit && st.lineFlash)}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          const d = { x: e.clientX, y: e.clientY, active: false, long: false, timer: null as ReturnType<typeof setTimeout> | null };
          d.timer = setTimeout(() => {
            d.long = true;
            p.onEdit();
          }, LONG_PRESS_MS);
          drag.current = d;
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const mx = e.clientX - d.x;
          if (Math.abs(mx) > 10 || Math.abs(e.clientY - d.y) > 10) {
            if (d.timer) clearTimeout(d.timer);
            d.timer = null;
          }
          if (!d.long && mx < -10 && Math.abs(mx) > Math.abs(e.clientY - d.y)) {
            d.active = true;
            setDx(Math.max(mx, -160));
          }
        }}
        onPointerUp={end}
        onPointerLeave={() => drag.current && end()}
        onPointerCancel={end}
      >
        <button type="button" className={st.qtyBadge} onClick={p.onEdit} aria-label={p.labels.qty}>
          {p.qtyText}
        </button>
        <span>
          <span className={st.lineName}>{p.name}</span>
          <br />
          <span className={st.lineSub}>{p.unitPrice}</span>
        </span>
        <span className={st.lineAmt}>{p.amount}</span>
        <div className={st.stepper}>
          {p.stepper && (
            <>
              <Button className={st.stepBtn} onClick={p.onMinus} aria-label={p.labels.minus}>
                −
              </Button>
              <Button className={st.stepBtn} onClick={p.onPlus} aria-label={p.labels.plus}>
                +
              </Button>
            </>
          )}
          <Button className={st.stepBtn} appearance="subtle" icon={<Delete24Regular />} onClick={p.onRemove} aria-label={p.labels.remove} />
        </div>
      </div>
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
      {r.company.tradeName && <div className={mergeClasses(st.rCenter, st.rBold)}>{r.company.tradeName}</div>}
      <div className={mergeClasses(st.rCenter, r.company.tradeName ? undefined : st.rBold)}>{r.company.name}</div>
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
              {l.originalPrice ? ` · ${L.Discount} z ${fmt(l.originalPrice)}` : ""}
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
