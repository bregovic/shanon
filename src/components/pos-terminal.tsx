"use client";

/**
 * Prodejní terminál — šablona „Pult s váhou“.
 *
 * Dlaždice zboží podle skupin, hledání a čtečka EAN (Enter), zboží na váhu
 * se zadáním hmotnosti, platba hotově (vrácení) nebo kartou, účtenka
 * k tisku (80 mm), otevření směny a uzávěrka. Ceny a DPH počítá server;
 * terminál ukazuje jen orientační součet z cen s DPH.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
  Person24Regular,
  DocumentText24Regular,
  Mail24Regular,
  Backspace24Regular,
  Box20Regular,
  Dismiss24Regular,
  CloudArrowUp24Regular,
  Delete24Regular,
  LockClosed24Regular,
  FullScreenMaximize24Regular,
  FullScreenMinimize24Regular,
  Money24Regular,
  Payment24Regular,
  QrCode24Regular,
  Print24Regular,
  Receipt24Regular,
  Scales24Regular,
  Search24Regular,
} from "@fluentui/react-icons";
import {
  posBasketCancelAction,
  posBasketOpenAction,
  posBasketSaveAction,
  posBasketsAction,
  posCardStartAction,
  posCardStatusAction,
  posCloseShiftAction,
  posEetResendAction,
  posOpenShiftAction,
  posSellAction,
  posCustomersAction,
  posInvoiceAction,
  posMailAction,
  posShiftSummaryAction,
  posLockAction,
  posShiftReceiptsAction,
  posReceiptPrintAction,
  posStornoAction,
  posRewriteAction,
  posReceiptCustomerAction,
  deleteRecordsAction,
  type ActionResult,
  type PosReceiptRow,
} from "@/app/actions";
import type { BasketView } from "@/modules/pos/basket";
import type { PrintLayout } from "@/core/print";
import { PrintDocument, QrSvg } from "@/lib/print-render";
import { printInFrame } from "@/lib/print-frame";
import { printViaStation } from "@/lib/station-print";
import { ToastHost, toast } from "./toast";
import {
  addOfflineSale,
  dropOfflineSale,
  newClientId,
  nextOfflineNumber,
  parseQueue,
  queueRaw,
  registerPosWorker,
  serverReachable,
  subscribeOnline,
  subscribeQueue,
  syncOfflineQueue,
  type OfflineSaleRec,
} from "@/lib/pos-offline";
import { receiptData } from "@/lib/receipt-data";
import {
  EscPos,
  grantedPort,
  grantedUsbPrinter,
  receiptEscPos,
  requestPort,
  requestUsbPrinter,
  serialSupported,
  usbSupported,
  writeToPort,
  writeToUsb,
  type CodePage,
} from "@/lib/escpos";
import type { ReceiptPrint } from "@/modules/pos/sale";
import { connectScalePort, readScale, readScaleSim, scalePort, type ScaleConfig, type ScaleReading } from "@/lib/scale";
import type { ScaleWeighing } from "@/lib/scale-driver";
import type { ScaleLine } from "@/modules/pos/scale-line";
import { ScalePanel, scalePending, useVerifiedScale, type VerifiedScaleConfig } from "./pos-scale-panel";

export interface PosItem {
  id: string;
  num: string;
  name: string;
  groupId: string;
  /** kategorie prodeje (strom); bez kategorií se kasa člení podle skupin položek */
  categoryId?: string | null;
  unit: string;
  price: string;
  /** sazba DPH v % (účtenka vystavená bez připojení) */
  rate?: string;
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
  /** vážení z ověřené váhy: hmotnost a cena přesně z váhy, řádek nejde upravit (jen smazat a zvážit znovu) */
  scale?: ScaleLine | null;
}

/** Spustí čtení váhy jednou po otevření dialogu hmotnosti (připojená váha zadá hmotnost sama). */
function ScaleAutoStart({ onStart }: { onStart: () => void }) {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    onStart();
  }, [onStart]);
  return null;
}

/** Známý odběratel nákupu (Odběratelé). */
/** odběratel bez evidence — jen vytisknout na účtenku */
interface Buyer {
  name: string;
  street: string;
  zip: string;
  city: string;
}
const NO_BUYER: Buyer = { name: "", street: "", zip: "", city: "" };
const hasBuyer = (b: Buyer | null) => !!b && Object.values(b).some((v) => v.trim());

interface CustomerPick {
  id: string;
  name: string;
  regNo: string;
  vatId: string;
  email: string;
}

/** Odeslání dokladu e-mailem: adresa (předvyplněná z odběratele) + Odeslat. */
function MailRow({ st, L, value, onChange, busy, state, onSend }: { st: ReturnType<typeof useStyles>; L: Record<string, string>; value: string; onChange: (v: string) => void; busy: boolean; state: { ok: boolean; text: string } | null; onSend: () => void }) {
  return (
    <div className={st.mailRow}>
      <Input type="email" value={value} placeholder={L.Email} onChange={(_, d) => onChange(d.value)} style={{ flex: 1, minWidth: 0 }} aria-label={L.Email} />
      <Button icon={<Mail24Regular />} disabled={busy || !value.trim()} onClick={onSend}>
        {L.SendEmail}
      </Button>
      {state && <div className={st.mailState} style={{ color: state.ok ? tokens.colorPaletteGreenForeground1 : tokens.colorPaletteRedForeground1 }}>{state.text}</div>}
    </div>
  );
}

const useStyles = makeStyles({
  root: { height: "100dvh", display: "flex", flexDirection: "column", backgroundColor: tokens.colorNeutralBackground2, color: tokens.colorNeutralForeground1 },
  mobileHide: { "@media (max-width: 900px)": { display: "none" } },
  mobileBar: {
    display: "none",
    "@media (max-width: 900px)": { display: "flex", gap: "8px", padding: "8px 12px", borderTop: `1px solid ${tokens.colorNeutralStroke2}`, backgroundColor: tokens.colorNeutralBackground1 },
  },
  bar: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "8px 16px",
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    flexWrap: "wrap",
    // mobil: lišta v jednom řádku, posouvá se do strany
    "@media (max-width: 600px)": { flexWrap: "nowrap", overflowX: "auto", gap: "8px", padding: "6px 8px", "& > *": { flexShrink: 0 } },
  },
  barTitle: { fontSize: tokens.fontSizeBase500, fontWeight: tokens.fontWeightSemibold },
  barInfo: { opacity: 0.85, fontSize: tokens.fontSizeBase300 },
  spacer: { flex: 1 },
  main: {
    flex: 1,
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: "1fr 380px",
    "@media (max-width: 900px)": { gridTemplateColumns: "1fr", gridTemplateRows: "1fr auto" },
  },
  // s panelem Váha: zboží | váha (~320 px) | nákup
  catalog: { display: "flex", flexDirection: "column", minHeight: 0, padding: "12px 16px", gap: "8px" },
  tabs: { overflowX: "auto", flexShrink: 0 },
  boxPickRow: { display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "8px", maxHeight: "120px", overflowY: "auto" },
  subTabs: { marginTop: "-6px", paddingLeft: "12px", borderLeft: `2px solid ${tokens.colorNeutralStroke2}` },
  // jedna posuvná řada (i při mnoha boxech zůstane místo pro zboží a košík)
  baskets: { display: "flex", gap: "6px", flexWrap: "nowrap", overflowX: "auto", flexShrink: 0, padding: "8px 12px 4px", "& > *": { flexShrink: 0 } },
  wUnits: { display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "12px", alignItems: "center" },
  wSep: { width: "8px" },
  chips: { display: "flex", gap: "8px", overflowX: "auto", flexShrink: 0, paddingBottom: "4px" },
  searchInfo: { color: tokens.colorNeutralForeground3 },
  tiles: {
    flex: 1,
    overflowY: "auto",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
    "@media (max-width: 600px)": { gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: "8px" },
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
    // dotyk: bez zpoždění a přiblížení dvojitým ťuknutím, bez výběru textu
    touchAction: "manipulation",
    userSelect: "none",
    minHeight: "104px",
    "@media (max-width: 600px)": { minHeight: "84px", padding: "8px 10px", fontSize: tokens.fontSizeBase300 },
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
  tileWeighed: { border: `1px dashed ${tokens.colorBrandStroke2}` },
  tileWeighing: { border: `2px solid ${tokens.colorBrandStroke1}`, backgroundColor: tokens.colorBrandBackground2 },
  regular: { color: tokens.colorNeutralForeground3, fontWeight: tokens.fontWeightRegular },
  tileImg: {
    "@media (max-width: 600px)": { height: "64px" },
    width: "100%",
    height: "96px",
    objectFit: "contain",
    borderRadius: tokens.borderRadiusMedium,
    flexShrink: 0,
    // podklad = barva dlaždice: fotka jiného poměru stran (čtverec v obdélníku) nemá po stranách šedé pruhy;
    // obrázek se plynule objeví po načtení
    backgroundColor: tokens.colorNeutralBackground1,
    opacity: 0,
    transitionProperty: "opacity",
    transitionDuration: "150ms",
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
  custName: { marginLeft: "8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  scaleRow: { display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px", fontSize: tokens.fontSizeBase400 },
  custList: { display: "flex", flexDirection: "column", gap: "4px", marginTop: "12px", maxHeight: "50vh", overflowY: "auto" },
  custRow: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "2px",
    padding: "10px 12px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
    cursor: "pointer",
    textAlign: "left",
    fontSize: tokens.fontSizeBase300,
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  mailRow: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", paddingTop: "12px", width: "100%" },
  mailState: { flexBasis: "100%", fontSize: tokens.fontSizeBase200 },
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

// náhradní tisk vestavěné účtenky (bez šablony): jen účtenka, od horního okraje, na střed papíru role
// (bez okrajů prohlížeče — viz printCss v lib/print-render.tsx), stránka se může zalomit
const PRINT_CSS = `@page { margin: 0; }
@media print {
  body * { visibility: hidden !important; }
  .pos-receipt, .pos-receipt * { visibility: visible !important; }
  .pos-receipt { position: absolute; left: 50%; transform: translateX(-50%); top: 0; width: 72mm; border: none !important; box-shadow: none !important; }
}`;

export function PosTerminal(p: {
  register: { id: string; code: string; name: string; cashRounding: { unit: number; method: "nearest" | "up" | "down" } };
  shift: { id: string; num: string } | null;
  items: PosItem[];
  groups: { id: string; name: string }[];
  categories: { id: string; name: string; parentId: string | null }[];
  /** nejčastěji prodávané položky (id) */
  top: string[];
  /** odložené nákupy (boxy) sdílené pokladnami firmy */
  baskets: BasketView[];
  /** druh pokladny: pult s váhou, kasa bez váhy, vážení do boxů (bez plateb a směny) */
  template?: "counter" | "till" | "boxes";
  /** výběr boxu při odložení: kód / QR, seznam aktivních boxů, nebo obojí */
  boxPick?: "both" | "qr" | "list";
  boxes?: { code: string; name: string }[];
  /** tisková šablona účtenky (Tiskové sestavy); bez ní vestavěná účtenka */
  receiptLayout?: PrintLayout | null;
  printer: { driver: string; paperWidth: string; codePage: CodePage; baudRate: number; openDrawer: boolean; autoPrint: boolean } | null;
  payment: { driver: string } | null;
  eet: { pending: number } | null;
  /** testovací server: kódy ručně povolených ostrých napojení (upozornění nahoře) */
  liveOnTest?: string[];
  /** prodej bez připojení: hlavička účtenky, plátce DPH, patička; karta jen na samostatném terminálu */
  offline?: { company: ReceiptPrint["company"]; vatPayer: boolean; footer: string | null; card: boolean } | null;
  /** pokladní váha (Integrace): sériový port v prohlížeči nebo simulátor */
  scale?: ({ driver: string } & ScaleConfig) | null;
  /** ověřená váha (Dialog 06): panel Váha, cenu počítá váha */
  verifiedScale?: VerifiedScaleConfig | null;
  /** zapnuté Odběratele: prodej známému odběrateli a na fakturu */
  customers?: boolean;
  /** zapnutá Integrace: odeslání dokladu e-mailem */
  mail?: boolean;
  user: string;
  /** pokladna má PIN — jde zamknout bez uzávěrky */
  canLock?: boolean;
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
  // výpadek spojení se serverem: hláška místo neošetřené výjimky (tlačítka se neodblokovala)
  const netError = L.NetworkError;
  const safe = useCallback(<T,>(pr: Promise<ActionResult<T>>): Promise<ActionResult<T>> => pr.catch(() => ({ ok: false as const, message: netError })), [netError]);
  // mobil (do 900 px): jen jeden sloupec — zboží, nebo nákup (spodní lišta)
  const [mobileCart, setMobileCart] = useState(false);
  // celá obrazovka jen tlačítkem v liště (automatické zapnutí rušilo klepání na tabletu)
  const [fullscreen, setFullscreen] = useState(false);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };
  useEffect(() => {
    const sync = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const [lines, setLines] = useState<Line[]>([]);
  // ověřená váha (Dialog 06): klepnutí na vážené zboží pošle cenu za kg do váhy, panel Váha převezme výsledek
  const { driver: vDriver, state: vState } = useVerifiedScale(p.verifiedScale ?? null);
  const verified = !!p.verifiedScale;

  // zadání množství / hmotnosti: nový řádek (idx = null) nebo úprava řádku nákupu
  const [weigh, setWeigh] = useState<{ item: PosItem; value: string; idx?: number | null; auto?: boolean } | null>(null);
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
  // pokladní váha: port (zapamatovaný), stav čtení v dialogu hmotnosti
  const scaleSim = p.scale?.driver === "scaleSim";
  const [scaleReady, setScaleReady] = useState(false);
  const [scaleState, setScaleState] = useState<{ busy: boolean; reading: ScaleReading | null; error?: string } | null>(null);
  const scaleLoop = useRef(0);
  useEffect(() => {
    if (p.scale && !scaleSim) void scalePort().then((port) => setScaleReady(!!port));
  }, [p.scale, scaleSim]);
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
  // známý odběratel nákupu; prodej na fakturu → vystavená faktura
  const [customer, setCustomer] = useState<CustomerPick | null>(null);
  const [custDlg, setCustDlg] = useState(false);
  const [custQ, setCustQ] = useState("");
  const [buyer, setBuyer] = useState<Buyer | null>(null);
  const [buyerDraft, setBuyerDraft] = useState<Buyer>(NO_BUYER);
  const [custRows, setCustRows] = useState<CustomerPick[]>([]);
  const [invoiceDone, setInvoiceDone] = useState<{ id: string; invoiceNum: string; amount: string; dueDate: string; email: string } | null>(null);
  // odeslání dokladu e-mailem (účtenka / faktura)
  const [mailTo, setMailTo] = useState("");
  const [mailState, setMailState] = useState<{ ok: boolean; text: string } | null>(null);
  const [opening, setOpening] = useState("");
  const [summary, setSummary] = useState<Record<string, string | number> | null>(null);
  const search = useRef<HTMLInputElement>(null);
  // platební terminál: stav čekání na kartu
  const [card, setCard] = useState<{ ref: string; state: "waiting" | "declined"; message?: string; qr?: string } | null>(null);
  // --- odložené nákupy: aktivní nákup se průběžně ukládá, volný prodej čeká stranou
  const [baskets, setBaskets] = useState<BasketView[]>(p.baskets);
  const [active, setActive] = useState<{ id: string; label: string; version: number } | null>(null);
  const [parkDlg, setParkDlg] = useState<string | null>(null);
  const freeStash = useRef<Line[]>([]);
  const skipSave = useRef(false);
  const dirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const itemById = useMemo(() => new Map(p.items.map((i) => [i.id, i])), [p.items]);
  const toLines = useCallback(
    (b: BasketView): Line[] => b.lines.flatMap((l) => (itemById.has(l.itemId) ? [{ item: itemById.get(l.itemId)!, qty: Number(l.qty), scale: l.scale ?? null }] : [])),
    [itemById],
  );
  /** nastavit řádky ze serveru (bez zpětného uložení) */
  const loadLines = (ls: Line[]) => {
    skipSave.current = true;
    setLines(ls);
  };
  /** načíst seznam; změnil-li aktivní nákup jiný terminál, převzít jeho stav */
  const refreshBaskets = useCallback(
    async (force = false) => {
      const r = await safe(posBasketsAction());
      if (!r.ok) return;
      setBaskets(r.data);
      setActive((a) => {
        if (!a || (dirty.current && !force)) return a;
        const b = r.data.find((x) => x.id === a.id);
        if (!b) {
          // zaplaceno nebo zrušeno jinde → zpět na volný prodej
          loadLines(freeStash.current);
          freeStash.current = [];
          return null;
        }
        if (b.version !== a.version || force) {
          loadLines(toLines(b));
          return { ...a, version: b.version };
        }
        return a;
      });
    },
    [toLines, safe],
  );
  const saveActive = async (ls: Line[], a: { id: string; version: number }) => {
    const r = await safe(posBasketSaveAction({
      id: a.id,
      registerId: p.register.id,
      version: a.version,
      lines: ls.map((l) => ({ itemId: l.item.id, qty: l.scale ? l.scale.weight : String(Number(l.qty.toFixed(3))), scale: l.scale ?? null })),
    }));
    dirty.current = false;
    if (r.ok) {
      setActive((x) => (x && x.id === r.data.id ? { ...x, version: r.data.version } : x));
      setBaskets((bs) => bs.map((b) => (b.id === r.data.id ? r.data : b)));
    } else {
      setError(r.message);
      await refreshBaskets(true);
    }
  };
  // změna řádků aktivního nákupu → uložit (s odstupem, ať se neukládá každé ťuknutí)
  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    if (!active) return;
    dirty.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const a = active;
    saveTimer.current = setTimeout(() => void saveActive(lines, a), 600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);
  /** dokončit čekající uložení (před přepnutím nákupu) */
  const flush = async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (active && dirty.current) await saveActive(lines, active);
  };
  useEffect(() => {
    const t = setInterval(() => void refreshBaskets(), 10_000);
    const onFocus = () => void refreshBaskets();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshBaskets]);
  const openBasket = async (b: BasketView) => {
    if (active?.id === b.id) return;
    await flush();
    if (!active) freeStash.current = lines;
    loadLines(toLines(b));
    setActive({ id: b.id, label: b.label, version: b.version });
    setBaskets((bs) => (bs.some((x) => x.id === b.id) ? bs.map((x) => (x.id === b.id ? b : x)) : [...bs, b]));
  };
  // vážení do boxů: vybraný box = otevřený nákup boxu (ukládá se sám), Hotovo = další box
  const boxesMode = p.template === "boxes";
  const activeBox = active ? (baskets.find((b) => b.id === active.id)?.boxCode ?? "").toUpperCase() : "";
  const boxTaken = (code: string) => baskets.some((x) => x.boxCode && x.boxCode.toUpperCase() === code.toUpperCase() && x.lines.length > 0);
  const selectBox = async (code: string) => {
    setBusy(true);
    const r = await safe(posBasketOpenAction(p.register.id, code));
    setBusy(false);
    if (!r.ok) return setError(r.message);
    if (r.data) await openBasket(r.data);
  };
  const boxDone = async () => {
    if (!active) return;
    // prázdný box se uvolní (nic se do něj nezvážilo)
    if (!lines.length) {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const id = active.id;
      if ((await safe(posBasketCancelAction(id))).ok) setBaskets((bs) => bs.filter((b) => b.id !== id));
    } else await flush();
    const list = p.boxes ?? [];
    const cur = list.findIndex((b) => b.code.toUpperCase() === activeBox);
    setActive(null);
    loadLines([]);
    freeStash.current = [];
    // další box v pořadí: přednostně prázdný, jinak prostě další
    const order = list.map((_, i) => list[(cur + 1 + i) % list.length]).filter((b) => b.code.toUpperCase() !== activeBox);
    const next = order.find((b) => !boxTaken(b.code)) ?? order[0];
    if (next) await selectBox(next.code);
  };
  const boxStarted = useRef(false);
  useEffect(() => {
    if (!boxesMode || boxStarted.current || active) return;
    boxStarted.current = true;
    const first = (p.boxes ?? []).find((b) => !boxTaken(b.code)) ?? p.boxes?.[0];
    // eslint-disable-next-line react-hooks/set-state-in-effect -- otevření boxu na serveru (vnější zdroj)
    if (first) void selectBox(first.code);
    // jen jednou po otevření pokladny
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const openFree = async () => {
    if (!active) return;
    await flush();
    loadLines(freeStash.current);
    freeStash.current = [];
    setActive(null);
  };
  /** odložit volný prodej pod box (kód / QR) nebo jméno */
  const park = async (value: string) => {
    const v = value.trim();
    if (!v) return;
    setBusy(true);
    const r = await safe(posBasketSaveAction({ label: v, boxCode: v, registerId: p.register.id, lines: lines.map((l) => ({ itemId: l.item.id, qty: l.scale ? l.scale.weight : String(Number(l.qty.toFixed(3))), scale: l.scale ?? null })) }));
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setParkDlg(null);
    setError(undefined);
    setLines([]);
    setBaskets((bs) => [...bs, r.data]);
  };
  /** uvolnit prázdný box (nákup zrušen) */
  const release = async () => {
    if (!active || lines.length) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const r = await safe(posBasketCancelAction(active.id));
    if (!r.ok) return setError(r.message);
    setBaskets((bs) => bs.filter((b) => b.id !== active.id));
    loadLines(freeStash.current);
    freeStash.current = [];
    setActive(null);
  };
  const cardLoop = useRef(0);
  const [eetPending, setEetPending] = useState(p.eet?.pending ?? 0);
  // účtenky směny (oprava, storno, tisk) a oprava otevřené účtenky v nákupu
  const [rcpts, setRcpts] = useState<PosReceiptRow[] | null>(null);
  const [amend, setAmend] = useState<{ id: string; num: string; paid: string; payment: string; sig: string; canRewrite: boolean } | null>(null);
  const lineSig = (ls: { item?: PosItem; itemId?: string; qty: number | string }[]) =>
    ls
      .map((l) => `${l.item?.id ?? l.itemId}:${Number(l.qty)}`)
      .sort()
      .join("|");
  const openReceipts = async () => {
    setBusy(true);
    const r = await safe(posShiftReceiptsAction(p.register.id));
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setRcpts(r.data);
  };
  /** opakovaný tisk / odeslání účtenky */
  const reprint = async (id: string) => {
    setBusy(true);
    const r = await safe(posReceiptPrintAction(id));
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setRcpts(null);
    setMailTo(r.data.customer?.email ?? "");
    setMailState(null);
    setReceipt(r.data);
  };
  const stornoRcpt = async (row: PosReceiptRow) => {
    if (!window.confirm(L.StornoConfirm.replace("{num}", row.receiptNum))) return;
    setBusy(true);
    const r = await safe(posStornoAction(row.id));
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setRcpts(null);
    afterSale(r.data, row.payment === "card" ? "card" : row.payment === "qr" ? "qr" : "cash");
  };
  const deleteRcpt = async (row: PosReceiptRow) => {
    if (!window.confirm(L.RcptDeleteConfirm.replace("{num}", row.receiptNum))) return;
    setBusy(true);
    const r = await safe(deleteRecordsAction("pos.receipt", [row.id]));
    setBusy(false);
    if (!r.ok) return setError(r.message);
    toast(L.RcptDeleted.replace("{num}", row.receiptNum));
    await openReceipts();
  };
  /** Otevřít účtenku v nákupu: změnit odběratele (bez nové účtenky) nebo položky (storno + nová účtenka) */
  const openAmend = async (row: PosReceiptRow) => {
    if (lines.length || active) return setError(L.AmendBusy);
    const ls: Line[] = row.lines.flatMap((l) => (itemById.has(l.itemId) ? [{ item: itemById.get(l.itemId)!, qty: Number(l.qty), scale: l.scale ?? null }] : []));
    if (ls.length < row.lines.length) setError(L.AmendMissing);
    else setError(undefined);
    setRcpts(null);
    loadLines(ls);
    setCustomer(row.customerId ? { id: row.customerId, name: row.customerName, regNo: "", vatId: "", email: "" } : null);
    setBuyer(row.buyer);
    setBuyerDraft(row.buyer ?? NO_BUYER);
    setAmend({ id: row.id, num: row.receiptNum, paid: row.paid, payment: row.payment, sig: lineSig(row.lines), canRewrite: row.canRewrite });
    setMobileCart(true);
  };
  const cancelAmend = () => {
    setAmend(null);
    loadLines([]);
    setCustomer(null);
    setBuyer(null);
    setBuyerDraft(NO_BUYER);
    setError(undefined);
  };
  /** jen jiný odběratel: stejná účtenka (bez storna), znovu k tisku */
  const saveAmendCustomer = async () => {
    if (!amend) return;
    setBusy(true);
    const r = await safe(posReceiptCustomerAction(amend.id, customer?.id ?? null, customer ? null : hasBuyer(buyer) ? buyer : null));
    setBusy(false);
    if (!r.ok) return setError(r.message);
    const pay = amend.payment === "card" ? "card" : amend.payment === "qr" ? "qr" : "cash";
    setAmend(null);
    afterSale(r.data, pay);
  };
  const amendSameLines = !!amend && amend.sig === lineSig(lines);
  /** jiné položky na stejném čísle (bez storna) — jen účtenka, která nikam neodešla */
  const rewriteAmend = async () => {
    if (!amend || !lines.length) return;
    if (scalePending(vState)) return setError(L.ScalePending);
    if (!window.confirm(L.RcptRewriteConfirm.replace("{num}", amend.num))) return;
    setBusy(true);
    const r = await safe(posRewriteAction({ registerId: p.register.id, payment: "cash", replacesId: amend.id, customerId: customer?.id ?? null, buyer: customer ? null : hasBuyer(buyer) ? buyer : null, lines: saleLines() }));
    setBusy(false);
    if (!r.ok) return setError(r.message);
    const pay = amend.payment === "card" ? "card" : amend.payment === "qr" ? "qr" : "cash";
    toast(L.RcptRewritten.replace("{num}", amend.num));
    setAmend(null);
    afterSale(r.data, pay);
  };

  // prodej bez připojení: fronta v prohlížeči pokladny (src/lib/pos-offline.ts), odešle se sama
  const offlineRaw = useSyncExternalStore(subscribeQueue, () => queueRaw(p.register.id), () => "[]");
  const offlineQ = useMemo(() => parseQueue(offlineRaw), [offlineRaw]);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [netDown, setNetDown] = useState(false);
  const offlineMode = !online || netDown;
  const [offlineDlg, setOfflineDlg] = useState(false);
  const syncing = useRef(false);
  const syncOffline = useCallback(
    async (manual = false) => {
      if (syncing.current) return;
      syncing.current = true;
      try {
        if (!parseQueue(queueRaw(p.register.id)).length) {
          if (await serverReachable()) setNetDown(false);
          return;
        }
        const r = await syncOfflineQueue(p.register.id);
        setNetDown(false);
        if (r.sent) toast(L.OfflineSent.replace("{n}", String(r.sent)), "success");
        if (typeof r.eetQueue === "number") setEetPending(r.eetQueue);
        if (manual && r.failed) setOfflineDlg(true);
      } catch {
        setNetDown(true);
        if (manual) toast(netError, "warning");
      } finally {
        syncing.current = false;
      }
    },
    [p.register.id, L.OfflineSent, netError],
  );
  useEffect(() => {
    registerPosWorker();
  }, []);
  useEffect(() => {
    const tick = () => {
      if (parseQueue(queueRaw(p.register.id)).length || netDown) void syncOffline();
    };
    const first = setTimeout(tick, 1500);
    const t = setInterval(tick, 20_000);
    window.addEventListener("online", tick);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      window.removeEventListener("online", tick);
    };
  }, [p.register.id, netDown, syncOffline]);
  // tiskárna ESC/POS přímo z kasy: sériový port (Web Serial) nebo USB kabel k tabletu (WebUSB)
  const usbPrinter = p.printer?.driver === "escposUsb";
  const serialPrinter = p.printer?.driver === "escposSerial" || usbPrinter;
  const [portReady, setPortReady] = useState(false);
  const terminalPay = !!p.payment && p.payment.driver !== "manual";

  useEffect(() => {
    if (usbPrinter) void grantedUsbPrinter().then((d) => setPortReady(!!d));
    else if (serialPrinter) void grantedPort().then((port) => setPortReady(!!port));
  }, [serialPrinter, usbPrinter]);

  const escpos = async (r: ReceiptPrint | null, drawerOnly = false) => {
    const pr = p.printer!;
    const usbDev = usbPrinter ? await grantedUsbPrinter() : null;
    const port = usbPrinter ? null : await grantedPort();
    if (!usbDev && !port) {
      setPortReady(false);
      return;
    }
    const width = pr.paperWidth === "58" ? 32 : 48;
    const bytes =
      drawerOnly || !r
        ? Uint8Array.from(new EscPos(width, pr.codePage).drawer().bytes)
        : receiptEscPos(r, L, fmt, { width, codePage: pr.codePage, drawer: pr.openDrawer && r.payment === "cash", locale });
    await (usbDev ? writeToUsb(usbDev, bytes) : writeToPort(port!, bytes, pr.baudRate || 9600)).catch((e) => setError(String(e)));
  };
  // tisk z prohlížeče: stejná tisková stránka jako ze seznamu účtenek (šablona, papír) — skrytým rámem
  // tisková stanice: účtenka do fronty stanice (bez dialogu); bez ní / jinak skrytým rámem
  const browserPrint = async (r: ReceiptPrint) => {
    if (r.id && p.printer?.driver === "station" && (await printViaStation("pos.receipt", [r.id]))) return;
    return r.id && p.receiptLayout ? printInFrame(`/print/pos.receipt/${r.id}`) : window.print();
  };
  const printReceipt = (r: ReceiptPrint) => (serialPrinter ? escpos(r) : browserPrint(r));
  const connectScale = async () => {
    if (!serialSupported()) return setError(L.PrinterUnsupported);
    setScaleReady(!!(await connectScalePort()));
  };
  /** Zvážit: čte váhu, dokud není hmotnost ustálená (nejvýš ~10 s); ustálenou zapíše do dialogu. */
  const weighNow = async () => {
    if (!p.scale) return;
    const loop = ++scaleLoop.current;
    setScaleState({ busy: true, reading: null });
    const port = scaleSim ? null : await scalePort();
    if (!scaleSim && !port) return setScaleState({ busy: false, reading: null, error: L.ScaleNotConnected });
    for (let i = 0; i < 20; i++) {
      if (scaleLoop.current !== loop) return;
      let r: ScaleReading;
      try {
        r = scaleSim ? await readScaleSim(i) : await readScale(port as Parameters<typeof readScale>[0], p.scale);
      } catch (e) {
        return setScaleState({ busy: false, reading: null, error: String((e as Error).message ?? e) });
      }
      if (scaleLoop.current !== loop) return;
      if (r.status === "overload") return setScaleState({ busy: false, reading: r, error: L.ScaleOverload });
      if (r.stable && r.kg !== null && r.kg > 0) {
        // hmotnost v kg → zvolená jednotka zadání (dkg, g)
        const v = Math.round((r.kg / W_FACTOR[wUnit]) * 1000) / 1000;
        setWeigh((w) => (w ? { ...w, value: num.format(v).replace(/\s/g, "") } : w));
        return setScaleState({ busy: false, reading: r });
      }
      setScaleState({ busy: true, reading: r });
      await new Promise((res) => setTimeout(res, 400));
    }
    setScaleState({ busy: false, reading: null, error: L.ScaleNotStable });
  };
  const connectPrinter = async () => {
    if (usbPrinter) {
      if (!usbSupported()) return setError(L.PrinterUsbUnsupported);
      return setPortReady(!!(await requestUsbPrinter().catch(() => null)));
    }
    if (!serialSupported()) return setError(L.PrinterUnsupported);
    const port = await requestPort().catch(() => null);
    setPortReady(!!port);
  };

  // vážený řádek z ověřené váhy: cena z váhy (jen součet řádků, nic se nepřepočítává)
  const total = lines.reduce((a, l) => a + (l.scale ? Math.round(Number(l.scale.total) * 100) : Math.round(Number(l.item.price) * l.qty * 100)), 0) / 100;
  const startPay = (m: "cash" | "card") => {
    setError(undefined);
    if (scalePending(vState)) return setError(L.ScalePending);
    setMethod(m);
    setDue(m === "cash" ? roundCash(total, p.register.cashRounding) : total);
    setPayDlg(m);
    void vDriver?.forgetLast();
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

  // po zavření dialogů vrátit fokus do hledání (čtečka EAN píše tam) — jen s klávesnicí/myší;
  // na dotykovém zařízení by vyskočila klávesnice přes zboží (čtečka funguje i bez fokusu)
  useEffect(() => {
    if (!weigh && !payDlg && !receipt && !summary && !touchOnly()) search.current?.focus();
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
  /** Přidat do nákupu z panelu Váha: vždy nový řádek s hodnotami z váhy, váha se vymaže a čeká na nulu */
  const addWeighed = useCallback(
    (r: ScaleWeighing) => {
      const prod = vDriver?.snapshot.product;
      const item = prod ? itemById.get(prod.id) : null;
      if (!item || !vDriver) return;
      setLines((ls) => [...ls, { item, qty: Number(r.weight), scale: { weight: r.weight, unitPrice: r.unitPrice, total: r.total, raw: r.raw, weighedAt: r.at } }]);
      setFlash((f) => ({ id: item.id, n: (f?.n ?? 0) + 1 }));
      // další zboží: hledání od začátku
      setQ("");
      void vDriver.clear(true);
    },
    [vDriver, itemById],
  );
  /** zavřít dialog množství (a ukončit čtení váhy) */
  const closeWeigh = () => {
    scaleLoop.current++;
    setScaleState(null);
    setWeigh(null);
  };
  /** potvrzení dialogu množství */
  const confirmQty = () => {
    if (!weigh) return;
    const v = qtyOf(weigh);
    if (!(v >= 0)) return;
    if (weigh.idx !== undefined && weigh.idx !== null) setQty(weigh.idx, v);
    else if (v > 0) add(weigh.item, v);
    closeWeigh();
  };

  const pick = (item: PosItem) => {
    setError(undefined);
    // ověřená váha: cena za kg (ceníková, ne akční — sleva by šla samostatným řádkem) do váhy
    // ověřená váha nepřipojená: hmotnost ručně (původní dialog), řádek jde jako ruční
    if (verified && item.weighed && isKg(item) && vDriver && vState?.phase !== "disconnected") {
      void vDriver.setUnitPrice({ id: item.id, name: item.name, unitPrice: item.regular || item.price });
      // mobil: panel Váha je v Nákupu
      setMobileCart(true);
      return;
    }
    if (item.weighed) {
      // připojená váha (nebo simulátor): hmotnost se po otevření dialogu načte sama (ScaleAutoStart)
      setWeigh({ item, value: "", auto: !!p.scale && isKg(item) && (scaleSim || scaleReady) });
      setScaleState(null);
    } else add(item);
  };
  /** podržení dlaždice: zadat množství rovnou */
  const pickQty = (item: PosItem) => {
    setError(undefined);
    if (verified && item.weighed && isKg(item) && vDriver && vState?.phase !== "disconnected") return pick(item);
    setWeigh({ item, value: "", idx: null });
  };

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    const n = q.trim().toLowerCase();
    const hit = p.items.find((i) => i.ean === n || i.num.toLowerCase() === n) ?? (visible.length === 1 ? visible[0] : null);
    if (hit) {
      pick(hit);
      setQ("");
      return;
    }
    // není to zboží: kód boxu (QR nebo ručně) otevře jeho nákup
    const code = q.trim();
    if (!code) return;
    void safe(posBasketOpenAction(p.register.id, code)).then((r) => {
      if (r.ok && r.data) {
        setQ("");
        void openBasket(r.data);
      } else if (!r.ok) setError(r.message);
    });
  };

  // vážený řádek z ověřené váhy: hmotnost a cena jdou na server tak, jak je vrátila váha
  const saleLines = () =>
    lines.map((l) => ({
      itemId: l.item.id,
      qty: l.scale ? l.scale.weight : String(Number(l.qty.toFixed(3))),
      scale: l.scale ?? null,
      // vážené kg bez údajů z ověřené váhy = hmotnost zadaná ručně (váha nebyla připojená)
      manual: !!verified && !l.scale && l.item.weighed && isKg(l.item),
    }));

  /** prodej jde zapsat bez připojení: hotově / kartou na samostatném terminálu, bez odběratele a boxu */
  const canOffline = (payment: "cash" | "card" | "qr"): payment is "cash" | "card" =>
    !!p.offline && (payment === "cash" || (payment === "card" && p.offline.card)) && !customer && !hasBuyer(buyer) && !active && !amend;

  const finishSale = async (payment: "cash" | "card" | "qr", paymentRef: string | null) => {
    setError(undefined);
    // id prodeje z kasy: ztracená odpověď + uložení bez připojení nikdy neudělá dva prodeje
    const clientId = newClientId();
    if (offlineMode && canOffline(payment)) return saleOffline(payment, clientId);
    setBusy(true);
    const res = await safe(posSellAction({
      registerId: p.register.id,
      payment,
      cashGiven: payment === "cash" && given ? given.replace(",", ".") : null,
      paymentRef,
      basketId: active?.id ?? null,
      customerId: customer?.id ?? null,
      buyer: customer ? null : hasBuyer(buyer) ? buyer : null,
      lines: saleLines(),
      clientId,
      replacesId: amend?.id ?? null,
    }));
    setBusy(false);
    if (!res.ok) {
      if (res.message === netError) {
        setNetDown(true);
        if (canOffline(payment)) return saleOffline(payment, clientId);
        setError(`${netError} ${L.OfflineCashOnly}`);
        return;
      }
      setError(res.message);
      return;
    }
    afterSale(res.data, payment);
  };

  /** po zaplacení: vyčistit nákup, ukázat účtenku, vytisknout / otevřít zásuvku */
  const afterSale = (r: ReceiptPrint, payment: "cash" | "card" | "qr") => {
    setPayDlg(null);
    setAmend(null);
    setCard(null);
    setGiven("");
    setMailTo(customer?.email ?? "");
    setMailState(null);
    setCustomer(null);
    setBuyer(null);
    setBuyerDraft(NO_BUYER);
    if (active) {
      // zaplacený nákup boxu: box volný, zpět na volný prodej
      if (saveTimer.current) clearTimeout(saveTimer.current);
      dirty.current = false;
      setBaskets((bs) => bs.filter((b) => b.id !== active.id));
      setActive(null);
      loadLines(freeStash.current);
      freeStash.current = [];
    } else setLines([]);
    setReceipt(r);
    if (typeof r.eetQueue === "number") setEetPending(r.eetQueue);
    if (p.printer?.autoPrint) {
      if (serialPrinter) void escpos(r);
      else setTimeout(() => void browserPrint(r), 300);
    } else if (serialPrinter && p.printer?.openDrawer && payment === "cash") void escpos(null, true);
  };

  /**
   * Prodej bez připojení: ceny z kasy, číslo z offline řady kasy, uložit do fronty v prohlížeči
   * a vystavit účtenku na místě (tisk z prohlížeče / tiskárna na sériovém portu). EET se odešle dodatečně.
   */
  const saleOffline = (payment: "cash" | "card", clientId: string) => {
    const o = p.offline!;
    const ls = lines.map((l) => {
      const qty = l.scale ? l.scale.weight : String(Number(l.qty.toFixed(3)));
      const unitPrice = l.scale ? l.scale.unitPrice : l.item.price;
      // stejný výpočet jako server (haléře × množství na 4 místa, zaokrouhlení na haléře)
      const cents = l.scale ? Math.round(Number(l.scale.total) * 100) : Math.round((Math.round(Number(unitPrice) * 100) * Math.round(Number(qty) * 10000)) / 10000);
      return { l, qty, unitPrice, cents };
    });
    const total = ls.reduce((a, x) => a + x.cents, 0);
    const paid = payment === "cash" ? Math.round(roundCash(total / 100, p.register.cashRounding) * 100) : total;
    const g = payment === "cash" && given ? Math.round(Number(given.replace(",", ".")) * 100) : null;
    if (g !== null && (!Number.isFinite(g) || g < paid)) return setError(L.NotEnoughCash);
    const receiptNum = nextOfflineNumber();
    if (!receiptNum) return setError(netError);
    const soldAt = new Date().toISOString();
    const rec: OfflineSaleRec = {
      clientId,
      registerId: p.register.id,
      shiftId: shift?.id ?? null,
      receiptNum,
      soldAt,
      payment,
      cashGiven: g === null ? null : (g / 100).toFixed(2),
      lines: ls.map((x) => ({ itemId: x.l.item.id, qty: x.qty, unitPrice: x.unitPrice, scale: x.l.scale ?? null })),
      paid: (paid / 100).toFixed(2),
    };
    if (!addOfflineSale(rec)) return setError(netError);
    const vat = new Map<string, { base: number; tax: number }>();
    for (const x of ls) {
      const rate = x.l.item.rate ?? "0";
      const net = Math.round((x.cents * 100) / (100 + Number(rate)));
      const v = vat.get(rate) ?? { base: 0, tax: 0 };
      v.base += net;
      v.tax += x.cents - net;
      vat.set(rate, v);
    }
    afterSale(
      {
        receiptNum,
        issuedAt: soldAt,
        register: p.register.name,
        company: o.company,
        vatPayer: o.vatPayer,
        customer: null,
        lines: ls.map((x) => ({
          description: x.l.item.name,
          qty: x.l.scale ? Number(x.qty).toFixed(3) : String(Number(x.qty)),
          unit: x.l.item.unit,
          unitPrice: x.unitPrice,
          amount: (x.cents / 100).toFixed(2),
          rate: x.l.item.rate ?? "0",
          originalPrice: x.l.scale ? null : (x.l.item.regular ?? null),
        })),
        vat: [...vat].map(([rate, v]) => ({ rate, base: (v.base / 100).toFixed(2), tax: (v.tax / 100).toFixed(2) })),
        gross: (total / 100).toFixed(2),
        rounding: ((paid - total) / 100).toFixed(2),
        paid: (paid / 100).toFixed(2),
        payment,
        cashGiven: rec.cashGiven,
        change: g === null ? null : ((g - paid) / 100).toFixed(2),
        footer: o.footer,
        eet: p.eet ? { status: "pending", pok: null } : null,
      },
      payment,
    );
    toast(L.OfflineSaved.replace("{num}", receiptNum), "warning");
  };

  /** Karta přes terminál: zahájit, čekat na výsledek, pak vystavit účtenku. */
  const payByTerminal = async () => {
    setBusy(true);
    setError(undefined);
    const start = await safe(posCardStartAction({ registerId: p.register.id, payment: "card", lines: saleLines() }));
    setBusy(false);
    if (!start.ok) return setError(start.message);
    const ref = start.data.ref;
    const loop = ++cardLoop.current;
    const qr = start.data.qr;
    setCard({ ref, state: "waiting", qr });
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      if (cardLoop.current !== loop) return; // zrušeno
      const st = await safe(posCardStatusAction(p.register.id, ref));
      if (cardLoop.current !== loop) return;
      if (!st.ok) return setCard({ ref, state: "declined", message: st.message, qr });
      if (st.data?.state === "successful") return finishSale("card", ref);
      if (st.data?.state === "failed") return setCard({ ref, state: "declined", message: st.data.message });
    }
  };

  /** QR platba: účtenka s QR kódem a VS, zákazník zaplatí převodem (zaplacení spáruje bankovní výpis). */
  const payByQr = () => {
    setError(undefined);
    if (scalePending(vState)) return setError(L.ScalePending);
    return finishSale("qr", null);
  };

  /** Prodej na fakturu: zaúčtovaná vydaná faktura odběrateli (bez platby na pokladně). */
  const payOnInvoice = async () => {
    if (!customer) return;
    setBusy(true);
    setError(undefined);
    const res = await safe(posInvoiceAction({ registerId: p.register.id, payment: "invoice", customerId: customer.id, basketId: active?.id ?? null, lines: saleLines() }));
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setMailTo(res.data.email || customer.email || "");
    setMailState(null);
    setInvoiceDone(res.data);
    setCustomer(null);
    if (active) {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      dirty.current = false;
      setBaskets((bs) => bs.filter((b) => b.id !== active.id));
      setActive(null);
      loadLines(freeStash.current);
      freeStash.current = [];
    } else setLines([]);
  };
  const findCustomers = async (q: string) => {
    setCustQ(q);
    const r = await safe(posCustomersAction(q));
    if (r.ok) setCustRows(r.data);
  };
  const sendMail = async (kind: "receipt" | "invoice", id: string) => {
    setBusy(true);
    setMailState(null);
    const r = await safe(posMailAction(kind, id, mailTo));
    setBusy(false);
    // testovací prostředí: zákazníkovi nic neodešlo, zpráva šla přihlášenému
    setMailState(r.ok ? { ok: true, text: r.data?.test ? (L.EmailSentTest ?? "").replace("{to}", r.data.testTo ?? "—") : `${L.EmailSent} ${mailTo}` } : { ok: false, text: r.message });
  };

  const cancelCard = async () => {
    const ref = card?.ref;
    cardLoop.current++;
    setCard(null);
    if (ref) await safe(posCardStatusAction(p.register.id, ref, true));
  };

  const pay = async () => {
    if (!payDlg) return;
    if (payDlg === "card" && terminalPay) return payByTerminal();
    return finishSale(payDlg, null);
  };

  const resendEet = async () => {
    setBusy(true);
    const res = await safe(posEetResendAction(p.register.id));
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setEetPending(res.data.pending);
  };

  const openShift = async () => {
    setBusy(true);
    const res = await safe(posOpenShiftAction(p.register.id, opening.replace(",", ".") || "0"));
    setBusy(false);
    if (!res.ok) return setError(res.message);
    window.location.reload();
  };

  const showSummary = async () => {
    if (offlineQ.length) return setError(L.OfflineCloseBlocked.replace("{n}", String(offlineQ.length)));
    setBusy(true);
    const res = await safe(posShiftSummaryAction(p.register.id));
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setSummary(res.data);
  };

  const closeShift = async () => {
    if (offlineQ.length) return setError(L.OfflineCloseBlocked.replace("{n}", String(offlineQ.length)));
    setBusy(true);
    const res = await safe(posCloseShiftAction(p.register.id));
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setSummary(null);
    setShift(null);
  };

  return (
    <div className={st.root}>
      <ToastHost />
      <style>{PRINT_CSS.replace("72mm", p.printer?.paperWidth === "58" ? "48mm" : p.printer?.paperWidth === "a6" ? "93mm" : "72mm")}</style>
      <header className={st.bar}>
        <Button as="a" appearance="transparent" href="/pos" icon={<ArrowLeft24Regular />} aria-label={L.Back} style={{ color: "inherit" }} />
        <span className={st.barTitle}>{p.register.name}</span>
        <span className={st.barInfo}>
          {shift ? `${L.Shift} ${shift.num}` : L.Closed} · {p.user}
        </span>
        <span className={st.spacer} />
        {(offlineQ.length > 0 || offlineMode) && (
          <Button
            icon={<CloudArrowUp24Regular />}
            onClick={() => setOfflineDlg(true)}
            title={L.OfflineQueueInfo.replace("{n}", String(offlineQ.length))}
            style={offlineMode ? { color: tokens.colorPaletteMarigoldForeground1 } : undefined}
          >
            {L.OfflineQueue.replace("{n}", String(offlineQ.length))}
          </Button>
        )}
        {eetPending > 0 && (
          <Button icon={<CloudArrowUp24Regular />} onClick={resendEet} disabled={busy} title={L.EetPendingInfo.replace("{n}", String(eetPending))}>
            {L.EetResend} ({eetPending})
          </Button>
        )}
        {p.scale && !scaleSim && !scaleReady && (
          <Button icon={<Scales24Regular />} onClick={connectScale}>
            {L.ConnectScale}
          </Button>
        )}
        {serialPrinter && !portReady && (
          <Button icon={<Print24Regular />} onClick={connectPrinter}>
            {L.PrinterConnect}
          </Button>
        )}
        <Button
          appearance="subtle"
          icon={fullscreen ? <FullScreenMinimize24Regular /> : <FullScreenMaximize24Regular />}
          title={fullscreen ? L.FullscreenExit : L.Fullscreen}
          aria-label={fullscreen ? L.FullscreenExit : L.Fullscreen}
          onClick={toggleFullscreen}
          style={{ color: "inherit" }}
        />
        {p.canLock && (
          <Button
            icon={<LockClosed24Regular />}
            disabled={busy}
            onClick={async () => {
              await safe(posLockAction(p.register.id));
              window.location.reload();
            }}
          >
            {L.Lock}
          </Button>
        )}
        {shift && !boxesMode && (
          <Button icon={<Receipt24Regular />} onClick={() => void openReceipts()} disabled={busy}>
            {L.Receipts}
          </Button>
        )}
        {shift && !boxesMode && (
          <Button icon={<LockClosed24Regular />} onClick={showSummary} disabled={busy || lines.length > 0}>
            {L.CloseShift}
          </Button>
        )}
      </header>

      {!!p.liveOnTest?.length && (
        <MessageBar intent="warning">
          <MessageBarBody>{L.LiveOnTest.replace("{codes}", p.liveOnTest.join(", "))}</MessageBarBody>
        </MessageBar>
      )}
      {offlineMode && (
        <MessageBar intent="warning">
          <MessageBarBody>{L.OfflineMode}</MessageBarBody>
        </MessageBar>
      )}
      {error && !payDlg && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      {/* účtenky směny: otevřít (oprava), tisk, storno, smazat poslední */}
      <Dialog open={!!rcpts} onOpenChange={(_, d) => !d.open && setRcpts(null)}>
        <DialogSurface style={{ maxWidth: "min(720px, 96vw)" }}>
          <DialogBody>
            <DialogTitle>{L.ShiftReceipts}</DialogTitle>
            <DialogContent>
              {error && (
                <MessageBar intent="error">
                  <MessageBarBody>{error}</MessageBarBody>
                </MessageBar>
              )}
              {!rcpts?.length && <Text block>{L.RcptNone}</Text>}
              {rcpts?.map((r) => (
                <div key={r.id} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` }}>
                  <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                    <div>
                      <b>{r.receiptNum}</b> · {r.at ? new Date(r.at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : ""} ·{" "}
                      <span style={Number(r.paid) < 0 ? { color: tokens.colorPaletteRedForeground1 } : undefined}>{fmt(r.paid)}</span> ·{" "}
                      {r.payment === "card" ? L.Card : r.payment === "qr" ? L.QrPayment : L.Cash}
                      {r.storno && <span style={{ color: tokens.colorNeutralForeground3 }}> · {r.storno === "of" ? L.RcptStornoOf : L.RcptStornoBy}</span>}
                    </div>
                    {(r.customerName || r.buyer?.name) && <div style={{ color: tokens.colorNeutralForeground3 }}>{r.customerName || r.buyer?.name}</div>}
                  </div>
                  <Button size="small" icon={<Print24Regular />} disabled={busy} onClick={() => void reprint(r.id)}>
                    {L.Print}
                  </Button>
                  {!r.storno && (
                    <>
                      <Button size="small" disabled={busy} onClick={() => void openAmend(r)}>
                        {L.RcptOpen}
                      </Button>
                      <Button size="small" disabled={busy} onClick={() => void stornoRcpt(r)}>
                        {L.Storno}
                      </Button>
                    </>
                  )}
                  {r.canDelete && (
                    <Button size="small" icon={<Delete24Regular />} disabled={busy} onClick={() => void deleteRcpt(r)}>
                      {L.RcptDelete}
                    </Button>
                  )}
                </div>
              ))}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setRcpts(null)}>{L.Cancel}</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* prodeje uložené bez připojení: přehled, odeslání, zahození */}
      <Dialog open={offlineDlg} onOpenChange={(_, d) => setOfflineDlg(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{L.OfflineTitle}</DialogTitle>
            <DialogContent>
              <Text block>{L.OfflineQueueInfo.replace("{n}", String(offlineQ.length))}</Text>
              {offlineQ.map((q) => (
                <div key={q.clientId} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` }}>
                  <div style={{ flex: 1 }}>
                    <div>
                      <b>{q.receiptNum}</b> · {new Date(q.soldAt).toLocaleString(locale)} · {fmt(q.paid)}
                    </div>
                    {q.error && <div style={{ color: tokens.colorPaletteRedForeground1 }}>{q.error}</div>}
                  </div>
                  <Button
                    size="small"
                    icon={<Delete24Regular />}
                    onClick={() => {
                      if (window.confirm(L.OfflineDropConfirm.replace("{num}", q.receiptNum))) dropOfflineSale(p.register.id, q.clientId);
                    }}
                  >
                    {L.OfflineDrop}
                  </Button>
                </div>
              ))}
            </DialogContent>
            <DialogActions>
              <Button appearance="primary" disabled={!offlineQ.length} onClick={() => void syncOffline(true)}>
                {L.OfflineSend}
              </Button>
              <Button onClick={() => setOfflineDlg(false)}>{L.Cancel}</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {!shift && p.template !== "boxes" ? (
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
          <section className={mergeClasses(st.catalog, mobileCart && st.mobileHide)}>
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
              // podkategorie: druhá řada záložek stejného vzhledu, odsazená pod hlavní kategorií
              <TabList className={mergeClasses(st.tabs, st.subTabs)} selectedValue={sub ?? "__all"} onTabSelect={(_, d) => setSub(d.value === "__all" ? null : String(d.value))}>
                <Tab value="__all">{L.All}</Tab>
                {children(group).map((c) => (
                  <Tab key={c.id} value={c.id}>
                    {c.name}
                  </Tab>
                ))}
              </TabList>
            )}
            {q.trim() && <Text className={st.searchInfo}>{L.SearchResults.replace("{n}", String(visible.length))}</Text>}
            {!p.items.length && <p className={st.empty}>{L.NoItems}</p>}
            <div className={st.tiles}>
              {visible.map((i, idx) => (
                <button
                  key={i.id}
                  type="button"
                  // vážené zboží: čárkované ohraničení; právě vážené: plná linka
                  className={mergeClasses(st.tile, i.weighed && st.tileWeighed, verified && vState?.product?.id === i.id && st.tileWeighing)}
                  {...pressHandlers(() => pick(i), () => pickQty(i))}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  {i.image && (
                    // eslint-disable-next-line @next/next/no-img-element -- soubor za přihlášením, prohlížeč ho cachuje
                    <img
                      src={`/api/files/${i.image}?w=320`}
                      alt=""
                      // první obrazovka hned, zbytek při posunu; objeví se až načtený (bez postupného vykreslování)
                      loading={idx < 24 ? "eager" : "lazy"}
                      decoding="async"
                      className={st.tileImg}
                      ref={(el) => {
                        if (el?.complete) el.style.opacity = "1";
                      }}
                      onLoad={(e) => (e.currentTarget.style.opacity = "1")}
                    />
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

          <aside className={mergeClasses(st.cart, !mobileCart && st.mobileHide)} aria-label={L.Cart}>
            {/* Váha (Dialog 06): kompaktně nahoře v Nákupu */}
            {verified && vDriver && vState && <ScalePanel driver={vDriver} state={vState} autoAddSec={p.verifiedScale?.autoAddSec ?? 0} beepOn={p.verifiedScale?.beep !== false} confirmMode={!!p.verifiedScale?.confirm} L={L} fmtMoney={(v) => fmt(v)} onAdd={addWeighed} />}
            <div className={st.baskets}>
              <Button size="small" shape="circular" appearance={active ? "secondary" : "primary"} onClick={() => void openFree()}>
                {L.FreeSale}
                {!active && lines.length ? ` · ${lines.length}` : ""}
              </Button>
              {baskets.map((b) => (
                <Button key={b.id} size="small" shape="circular" appearance={active?.id === b.id ? "primary" : "secondary"} onClick={() => void openBasket(b)}>
                  {b.label} · {active?.id === b.id ? lines.length : b.lines.length}
                </Button>
              ))}
              {!active && lines.length > 0 && (
                <Button size="small" shape="circular" appearance="outline" icon={<Box20Regular />} onClick={() => setParkDlg("")}>
                  {L.Park}
                </Button>
              )}
            </div>
            {p.customers && (
              <div className={st.cartHead}>
                {customer ? (
                  <>
                    <Person24Regular />
                    <span className={st.custName}>{customer.name}</span>
                    <span className={st.spacer} />
                    <Button appearance="subtle" size="small" icon={<Dismiss24Regular />} aria-label={L.Remove} onClick={() => setCustomer(null)} />
                  </>
                ) : hasBuyer(buyer) ? (
                  <>
                    <Person24Regular />
                    {/* odběratel jen na účtenku: klik = upravit */}
                    <button type="button" className={st.custName} style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: "inherit", font: "inherit", textAlign: "left" }} onClick={() => (setBuyerDraft(buyer!), setCustDlg(true), void findCustomers(""))}>
                      {buyer!.name || [buyer!.street, buyer!.city].filter(Boolean).join(", ")}
                    </button>
                    <span className={st.spacer} />
                    <Button appearance="subtle" size="small" icon={<Dismiss24Regular />} aria-label={L.Remove} onClick={() => (setBuyer(null), setBuyerDraft(NO_BUYER))} />
                  </>
                ) : (
                  <Button appearance="subtle" size="small" icon={<Person24Regular />} onClick={() => (setCustDlg(true), void findCustomers(""))}>
                    {L.ChooseCustomer}
                  </Button>
                )}
              </div>
            )}
            {amend && (
              <div className={st.cartHead} style={{ flexWrap: "wrap", color: tokens.colorPaletteMarigoldForeground1 }}>
                <span>{L.Amending.replace("{num}", amend.num)}</span>
                <span className={st.spacer} />
                {amendSameLines && (
                  <Button size="small" appearance="primary" disabled={busy} onClick={() => void saveAmendCustomer()}>
                    {L.AmendSaveCustomer}
                  </Button>
                )}
                {!amendSameLines && amend.canRewrite && (
                  <Button size="small" appearance="primary" disabled={busy || !lines.length} onClick={() => void rewriteAmend()}>
                    {L.RcptRewrite}
                  </Button>
                )}
                <Button size="small" appearance="subtle" disabled={busy} onClick={cancelAmend}>
                  {L.AmendCancel}
                </Button>
              </div>
            )}
            <div className={st.cartHead}>
              {active ? active.label : L.Cart}
              <span className={st.spacer} />
              {lines.length > 0 && (
                <Button appearance="subtle" size="small" onClick={() => setLines([])}>
                  {L.Clear}
                </Button>
              )}
              {active && !lines.length && (
                <Button appearance="subtle" size="small" onClick={() => void release()}>
                  {L.ReleaseBox}
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
                  qtyText={l.scale ? `${l.scale.weight.replace(".", ",")} kg` : l.item.weighed ? `${num.format(l.qty)} ${l.item.unit.toLowerCase()}` : `${l.qty}×`}
                  name={l.item.name}
                  unitPrice={l.scale ? `${fmt(l.scale.unitPrice)} / kg` : `${fmt(l.item.price)}${l.item.unit && l.item.unit !== "KS" ? ` / ${l.item.unit.toLowerCase()}` : ""}`}
                  amount={l.scale ? fmt(l.scale.total) : fmt(Math.round(Number(l.item.price) * l.qty * 100) / 100)}
                  stepper={!l.item.weighed}
                  labels={{ minus: L.Less, plus: L.More, remove: L.Remove, qty: L.Quantity }}
                  onMinus={() => setQty(idx, l.qty - 1)}
                  onPlus={() => setQty(idx, l.qty + 1)}
                  onEdit={() => (l.scale ? setError(L.WeighedLocked) : setWeigh({ item: l.item, value: num.format(isKg(l.item) ? l.qty / W_FACTOR[wUnit] : l.qty).replace(/\s/g, ""), idx }))}
                  onRemove={() => remove(idx)}
                />
              ))}
            </div>
            <div className={st.total}>
              <div className={st.totalRow}>
                <span>{L.Total}</span>
                <span>{fmt(total)}</span>
              </div>
              {boxesMode ? (
                <>
                  <div className={st.boxPickRow}>
                    {(p.boxes ?? []).map((b) => (
                      <Button key={b.code} shape="circular" appearance={activeBox === b.code.toUpperCase() ? "primary" : boxTaken(b.code) ? "outline" : "secondary"} disabled={busy} onClick={() => void selectBox(b.code)} title={b.name || undefined}>
                        {b.code}
                      </Button>
                    ))}
                  </div>
                  <Button appearance="primary" className={st.payBtn} style={{ width: "100%" }} icon={<Box20Regular />} disabled={busy || !active} onClick={() => void boxDone()}>
                    {L.BoxDone}
                  </Button>
                </>
              ) : (
                <>
              <div className={st.pay}>
                <Button appearance="primary" className={st.payBtn} icon={<Money24Regular />} disabled={!lines.length} onClick={() => startPay("cash")}>
                  {L.PayCash}
                </Button>
                <Button className={st.payBtn} icon={<Payment24Regular />} disabled={!lines.length} onClick={() => startPay("card")}>
                  {L.PayCard}
                </Button>
              </div>
              {/* QR platba převodem: účtenka s QR kódem, čeká na platbu (spáruje bankovní výpis) */}
              <Button className={st.payBtn} style={{ marginTop: 8, width: "100%" }} icon={<QrCode24Regular />} disabled={!lines.length || busy} onClick={() => void payByQr()}>
                {L.PayQr}
              </Button>
              {customer && !amend && (
                <Button className={st.payBtn} style={{ marginTop: 8, width: "100%" }} icon={<DocumentText24Regular />} disabled={!lines.length || busy} onClick={() => void payOnInvoice()}>
                  {L.OnInvoice}
                </Button>
              )}
              {error && customer && !payDlg && <div style={{ color: "var(--colorPaletteRedForeground1)", marginTop: 6 }}>{error}</div>}
                </>
              )}
            </div>
          </aside>
          <div className={st.mobileBar}>
            <Button appearance={mobileCart ? "secondary" : "primary"} size="large" style={{ flex: 1 }} onClick={() => setMobileCart((v) => !v)}>
              {mobileCart ? L.MobileGoods : `${L.Cart} · ${lines.length} · ${fmt(total)}`}
            </Button>
          </div>
        </div>
      )}

      {/* hmotnost */}
      <Dialog open={!!weigh} onOpenChange={(_, d) => !d.open && closeWeigh()}>
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
              {weigh?.auto && <ScaleAutoStart key={weigh.item.id} onStart={weighNow} />}
              {p.scale && isKg(weigh?.item) && (
                <div className={st.scaleRow}>
                  <Button appearance="primary" icon={<Scales24Regular />} disabled={scaleState?.busy} onClick={() => void weighNow()}>
                    {scaleState?.busy ? L.ScaleWaiting : L.Weigh}
                  </Button>
                  <span>
                    {scaleState?.error ??
                      (scaleState?.reading?.kg != null ? `${num.format(scaleState.reading.kg)} kg${scaleState.reading.stable ? "" : ` · ${L.ScaleUnstable}`}` : "")}
                  </span>
                </div>
              )}
              <Input
                value={weigh?.value ?? ""}
                onChange={(_, d) => setWeigh((w) => (w ? { ...w, value: d.value } : w))}
                onKeyDown={(e) => e.key === "Enter" && confirmQty()}
                inputMode="decimal"
                size="large"
                // dotyk: zadává se klávesnicí v dialogu, ne systémovou
                autoFocus={!touchOnly()}
                aria-label={weigh?.item.weighed ? L.Weight : L.Quantity}
                placeholder={weigh?.item.weighed ? L.Weight : L.Quantity}
                contentAfter={isKg(weigh?.item) ? wUnit : weigh?.item.unit.toLowerCase()}
              />
              <div className={st.big}>{fmt(qtyOf(weigh) * Number(weigh?.item.price ?? 0))}</div>
              <Numpad st={st} set={(f) => setWeigh((w) => (w ? { ...w, value: f(w.value) } : w))} />
            </DialogContent>
            <DialogActions>
              <Button onClick={closeWeigh}>{L.Cancel}</Button>
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

      {/* odložit nákup do boxu / pod jméno */}
      <Dialog open={parkDlg !== null} onOpenChange={(_, d) => !d.open && setParkDlg(null)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{L.ParkTitle}</DialogTitle>
            <DialogContent>
              {p.boxPick !== "list" && (
                <>
                  <Text block style={{ marginBottom: 8 }}>
                    {L.ParkHint}
                  </Text>
                  <Input
                    size="large"
                    autoFocus={p.boxPick === "qr"}
                    value={parkDlg ?? ""}
                    onChange={(_, d) => setParkDlg(d.value)}
                    onKeyDown={(e) => e.key === "Enter" && void park(parkDlg ?? "")}
                    aria-label={L.BasketLabel}
                  />
                </>
              )}
              {p.boxPick !== "qr" && (
                <>
                  <Text block weight="semibold" style={{ margin: "12px 0 8px" }}>
                    {L.BoxPickFree}
                  </Text>
                  {!p.boxes?.length && <Text block>{L.NoBoxes}</Text>}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8, maxHeight: "40vh", overflowY: "auto" }}>
                    {(p.boxes ?? []).map((b) => {
                      // obsazený = box už má odložený nákup
                      const taken = baskets.some((x) => x.boxCode && x.boxCode.toUpperCase() === b.code.toUpperCase());
                      return (
                        <Button
                          key={b.code}
                          size="large"
                          disabled={busy || taken}
                          onClick={() => void park(b.code)}
                          title={b.name || undefined}
                          // výchozí fokus na první volný box (ne do pole — bez klávesnice na tabletu)
                          autoFocus={b.code === (p.boxes ?? []).find((x) => !baskets.some((y) => y.boxCode && y.boxCode.toUpperCase() === x.code.toUpperCase()))?.code}
                        >
                          <span style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                            <span>{b.code}</span>
                            {(taken || b.name) && <Text size={200}>{taken ? L.BoxTaken : b.name}</Text>}
                          </span>
                        </Button>
                      );
                    })}
                  </div>
                </>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setParkDlg(null)}>{L.Cancel}</Button>
              {p.boxPick !== "list" && (
                <Button appearance="primary" disabled={busy || !(parkDlg ?? "").trim()} onClick={() => void park(parkDlg ?? "")}>
                  {L.Park}
                </Button>
              )}
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
              {amend && (
                <MessageBar intent="warning">
                  <MessageBarBody>
                    {L.AmendInfo.replace("{num}", amend.num).replace("{paid}", fmt(amend.paid))}
                    {method === "cash" && amend.payment === "cash" && ` ${L.AmendDiff.replace("{diff}", fmt(Math.round((toPay - Number(amend.paid)) * 100) / 100))}`}
                  </MessageBarBody>
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
                  {card.qr ? (
                    // platební brána: zákazník naskenuje QR a zaplatí v telefonu (QR generuje server)
                    <div style={{ width: 240, maxWidth: "100%", margin: "0 auto", background: "#fff", padding: 8 }} dangerouslySetInnerHTML={{ __html: card.qr }} />
                  ) : (
                    <Spinner />
                  )}
                  <p style={{ textAlign: "center" }}>{card.qr ? L.CardQrInfo : L.CardWaitingInfo}</p>
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
              {receipt?.qr ? L.PayAwaiting : L.Paid}
              {receipt?.change && Number(receipt.change) > 0 ? ` · ${L.ChangeDue} ${fmt(receipt.change)}` : ""}
            </DialogTitle>
            <DialogContent>
              {receipt &&
                (p.receiptLayout ? (
                  <div className={mergeClasses("pos-receipt", st.receipt)} style={{ width: "auto" }}>
                    <PrintDocument layout={p.receiptLayout} data={receiptData(receipt, {}, { cash: L.Cash, card: L.Card, qr: L.QrPayment })} locale={locale} />
                  </div>
                ) : (
                  <Receipt r={receipt} L={L} fmt={fmt} st={st} locale={locale} />
                ))}
              {p.mail && receipt?.id && (
                <MailRow st={st} L={L} value={mailTo} onChange={setMailTo} busy={busy} state={mailState} onSend={() => void sendMail("receipt", receipt.id!)} />
              )}
            </DialogContent>
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

      {/* výběr odběratele */}
      <Dialog open={custDlg} onOpenChange={(_, d) => !d.open && setCustDlg(false)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{L.ChooseCustomer}</DialogTitle>
            <DialogContent>
              <Input autoFocus value={custQ} placeholder={L.SearchCustomer} onChange={(_, d) => void findCustomers(d.value)} style={{ width: "100%" }} />
              <div className={st.custList}>
                {!custRows.length && <p className={st.empty}>{L.NoCustomers}</p>}
                {custRows.map((c) => (
                  <button key={c.id} className={st.custRow} onClick={() => (setCustomer(c), setBuyer(null), setCustDlg(false))}>
                    <strong>{c.name}</strong>
                    <span>{[c.regNo && `IČO ${c.regNo}`, c.vatId && `DIČ ${c.vatId}`].filter(Boolean).join("  ")}</span>
                  </button>
                ))}
              </div>
              {/* odběratel bez evidence: jméno / adresa jen na účtenku, vše nepovinné */}
              <div style={{ marginTop: 16, display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                <div style={{ gridColumn: "1 / -1" }}>
                  <strong>{L.Buyer}</strong>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>{L.BuyerHint}</div>
                </div>
                <Input style={{ gridColumn: "1 / -1" }} placeholder={L.BuyerName} aria-label={L.BuyerName} value={buyerDraft.name} onChange={(_, d) => setBuyerDraft({ ...buyerDraft, name: d.value })} />
                <Input style={{ gridColumn: "1 / -1" }} placeholder={L.BuyerStreet} aria-label={L.BuyerStreet} value={buyerDraft.street} onChange={(_, d) => setBuyerDraft({ ...buyerDraft, street: d.value })} />
                <Input placeholder={L.BuyerZip} aria-label={L.BuyerZip} value={buyerDraft.zip} onChange={(_, d) => setBuyerDraft({ ...buyerDraft, zip: d.value })} />
                <Input placeholder={L.BuyerCity} aria-label={L.BuyerCity} value={buyerDraft.city} onChange={(_, d) => setBuyerDraft({ ...buyerDraft, city: d.value })} />
              </div>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setCustDlg(false)}>{L.Cancel}</Button>
              <Button appearance="primary" disabled={!hasBuyer(buyerDraft)} onClick={() => (setBuyer({ ...buyerDraft }), setCustomer(null), setCustDlg(false))}>
                {L.BuyerUse}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* faktura z prodeje na fakturu */}
      <Dialog open={!!invoiceDone} onOpenChange={(_, d) => !d.open && setInvoiceDone(null)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              {L.InvoiceIssued} {invoiceDone?.invoiceNum}
            </DialogTitle>
            <DialogContent>
              {invoiceDone && (
                <div className={st.sumGrid}>
                  <span>{L.Total}</span>
                  <strong>{fmt(invoiceDone.amount)}</strong>
                  <span>{L.DueDate}</span>
                  <span>{invoiceDone.dueDate ? new Date(invoiceDone.dueDate).toLocaleDateString(locale) : ""}</span>
                </div>
              )}
              {p.mail && invoiceDone && <MailRow st={st} L={L} value={mailTo} onChange={setMailTo} busy={busy} state={mailState} onSend={() => void sendMail("invoice", invoiceDone.id)} />}
            </DialogContent>
            <DialogActions>
              <Button icon={<Print24Regular />} onClick={() => invoiceDone && window.open(`/api/pdf/ar.invoice/${invoiceDone.id}`, "_blank")}>
                {L.PrintInvoice}
              </Button>
              <Button appearance="primary" size="large" onClick={() => setInvoiceDone(null)}>
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
                  {Number(summary.qr) ? (
                    <>
                      <span>{L.QrTotal}</span>
                      <span>{fmt(summary.qr)}</span>
                    </>
                  ) : null}
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

/** Orientační zaokrouhlení hotovosti podle měny (závazně počítá server, roundCents). */
function roundCash(total: number, r: { unit: number; method: "nearest" | "up" | "down" }): number {
  const step = Math.round(r.unit * 100);
  const c = Math.round(Math.abs(total) * 100);
  if (step <= 1) return total;
  const rest = c % step;
  const v = c - rest + (rest > 0 && (r.method === "up" || (r.method === "nearest" && rest * 2 >= step)) ? step : 0);
  return (Math.sign(total) * v) / 100;
}

type WeightUnit = "kg" | "dkg" | "g";
const W_FACTOR: Record<WeightUnit, number> = { kg: 1, dkg: 0.01, g: 0.001 };
/** rychlé volby hmotnosti podle jednotky zadání */
const W_PRESETS: Record<WeightUnit, string[]> = { kg: ["0,25", "0,5", "1"], dkg: ["10", "15", "20", "30", "50"], g: ["100", "150", "200", "300", "500"] };
const SWIPE_REMOVE_PX = 90;

/**
 * Ťuknutí vs. podržení prstu (myš i dotyk). Ťuknutí = běžné kliknutí (spolehlivé
 * i při překreslení kasy, funguje i z klávesnice); podržení spustí časovač a
 * následné kliknutí se pak ignoruje. Stav drží prvek, ne render.
 */
/**
 * Dotykové zařízení (telefon, tablet) – fokus do pole by tam vysunul klávesnici přes zboží, takže se píše jen
 * po ťuknutí do pole. Android/iPad se berou podle systému: tablet se stylusem nebo připojenou myší hlásí
 * i jemný ukazatel (`any-pointer: fine`) a dřív se tak choval jako počítač – kasa po otevření skočila do
 * hledání a vysunula klávesnici. Počítač s dotykovým displejem a myší zůstává počítačem (čtečka píše do hledání).
 */
function touchOnly(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  const nav = window.navigator;
  const mobileOs = /Android|iPhone|iPad|iPod/i.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1);
  if (mobileOs && nav.maxTouchPoints > 0) return true;
  return window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(any-pointer: fine)").matches;
}

/** Po podržení zahodit jedno následné kliknutí (trefilo by pozadí otevřeného dialogu). */
function swallowNextClick() {
  const swallow = (ev: Event) => {
    ev.stopPropagation();
    ev.preventDefault();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", swallow, true), 1000);
}

type PressState = { timer: ReturnType<typeof setTimeout> | null; long: boolean; x: number; y: number };
const pressOf = (el: EventTarget) => {
  const t = el as HTMLElement & { _press?: PressState };
  return (t._press ??= { timer: null, long: false, x: 0, y: 0 });
};
function pressHandlers(onTap: () => void, onLong: () => void) {
  const clear = (st: PressState) => {
    if (st.timer) clearTimeout(st.timer);
    st.timer = null;
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      const st = pressOf(e.currentTarget);
      clear(st);
      st.long = false;
      st.x = e.clientX;
      st.y = e.clientY;
      st.timer = setTimeout(() => {
        st.timer = null;
        st.long = true;
        swallowNextClick();
        onLong();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const st = pressOf(e.currentTarget);
      // posun prstu = posouvání seznamu, ne podržení
      if (Math.abs(e.clientX - st.x) > 10 || Math.abs(e.clientY - st.y) > 10) clear(st);
    },
    onPointerUp: (e: React.PointerEvent) => clear(pressOf(e.currentTarget)),
    onPointerCancel: (e: React.PointerEvent) => clear(pressOf(e.currentTarget)),
    onClick: (e: React.MouseEvent) => {
      const st = pressOf(e.currentTarget);
      if (st.long) {
        st.long = false;
        return;
      }
      onTap();
    },
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
            swallowNextClick();
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
      {r.company.registration && <div className={st.rCenter} style={{ fontSize: "0.85em" }}>{r.company.registration}</div>}
      <div className={st.rSep} />
      <div className={st.rRow}>
        <span>{r.vatPayer === false ? (r.customer && !r.customer.adhoc ? L.InvoiceNonPayer : L.Receipt) : r.customer && !r.customer.adhoc ? L.InvoiceDoc : L.SimplifiedDoc}</span>
        <span>{r.receiptNum}</span>
      </div>
      {r.customer && (
        <div>
          {L.Customer}: {r.customer.name}
          {r.customer.address && <div>{r.customer.address}</div>}
          <div>{[r.customer.regNo && `IČO ${r.customer.regNo}`, r.customer.vatId && `DIČ ${r.customer.vatId}`].filter(Boolean).join("  ")}</div>
        </div>
      )}
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
        <span>{r.payment === "cash" ? L.Cash : r.payment === "qr" ? L.QrPayment : L.Card}</span>
        <span>{fmt(r.cashGiven ?? r.paid)}</span>
      </div>
      {r.qr && (
        <div className={st.rCenter} style={{ marginTop: 6 }}>
          <div className={st.rBold}>{L.QrAwaitingNote}</div>
          <div style={{ display: "flex", justifyContent: "center" }}><QrSvg text={r.qr} size={34} /></div>
          {r.vs && <div>VS {r.vs}</div>}
        </div>
      )}
      {r.change && Number(r.change) > 0 && (
        <div className={st.rRow}>
          <span>{L.ChangeDue}</span>
          <span>{fmt(r.change)}</span>
        </div>
      )}
      <div className={st.rSep} />
      {r.vatPayer === false && <div>{L.NonPayerNote}</div>}
      {r.vatPayer !== false && <div>{L.VatRecap}</div>}
      {r.vatPayer !== false && r.vat.map((v) => (
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
