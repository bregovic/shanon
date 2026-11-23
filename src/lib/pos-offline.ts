/**
 * Kasa bez připojení (klient): prodej se uloží v prohlížeči pokladny a odešle se, jakmile je připojení
 * (POST /api/pos/offline → src/server/pos-offline.ts). Účtenka dostane číslo z offline řady této kasy
 * `OF-<kód kasy>-<pořadí>` (kód = 5 náhodných znaků uložených v prohlížeči). Každý prodej má id z kasy
 * (`clientId`) — server ho zapíše jen jednou, i když prodej přijde dvakrát.
 */

export interface OfflineLine {
  itemId: string;
  qty: string;
  unitPrice: string;
  scale?: { weight: string; unitPrice: string; total: string; raw?: string; weighedAt?: string } | null;
}

export interface OfflineSaleRec {
  clientId: string;
  registerId: string;
  shiftId: string | null;
  receiptNum: string;
  soldAt: string;
  payment: "cash" | "card";
  cashGiven: string | null;
  lines: OfflineLine[];
  /** zaplaceno (pro přehled v kase) */
  paid: string;
  /** poslední chyba při odeslání */
  error?: string;
}

const qKey = (registerId: string) => `shanon.posq.${registerId}`;
const TERM_KEY = "shanon.pos.term";
const SEQ_KEY = "shanon.pos.seq";
const EVENT = "shanon-posq";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** surová fronta (stabilní hodnota pro useSyncExternalStore) */
export function queueRaw(registerId: string): string {
  return read(qKey(registerId)) ?? "[]";
}

export function parseQueue(raw: string): OfflineSaleRec[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as OfflineSaleRec[]) : [];
  } catch {
    return [];
  }
}

export function subscribeQueue(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", fn);
  };
}

function write(registerId: string, q: OfflineSaleRec[]): boolean {
  try {
    if (q.length) localStorage.setItem(qKey(registerId), JSON.stringify(q));
    else localStorage.removeItem(qKey(registerId));
    window.dispatchEvent(new Event(EVENT));
    return true;
  } catch {
    return false;
  }
}

/** kód této kasy v offline řadě (5 znaků A–Z, 0–9) */
function terminalCode(): string {
  let t = read(TERM_KEY);
  if (!t || !/^[A-Z0-9]{5}$/.test(t)) {
    const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const r = crypto.getRandomValues(new Uint8Array(5));
    t = Array.from(r, (x) => a[x % a.length]).join("");
    localStorage.setItem(TERM_KEY, t);
  }
  return t;
}

/** další číslo offline účtenky této kasy; null = prohlížeč nedovolí ukládat (soukromé okno) */
export function nextOfflineNumber(): string | null {
  try {
    const term = terminalCode();
    const seq = (Number(read(SEQ_KEY)) || 0) % 99999 + 1;
    localStorage.setItem(SEQ_KEY, String(seq));
    return `OF-${term}-${String(seq).padStart(5, "0")}`;
  } catch {
    return null;
  }
}

export function newClientId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** uložit prodej do fronty; false = nejde uložit (pak prodej nevystavovat) */
export function addOfflineSale(rec: OfflineSaleRec): boolean {
  return write(rec.registerId, [...parseQueue(queueRaw(rec.registerId)), rec]);
}

export function dropOfflineSale(registerId: string, clientId: string): void {
  write(
    registerId,
    parseQueue(queueRaw(registerId)).filter((s) => s.clientId !== clientId),
  );
}

export interface SyncOutcome {
  sent: number;
  failed: number;
  eetQueue?: number;
}

/** Odeslat frontu pokladny. Výjimka = server nedostupný (fronta beze změny). */
export async function syncOfflineQueue(registerId: string): Promise<SyncOutcome> {
  const q = parseQueue(queueRaw(registerId));
  if (!q.length) return { sent: 0, failed: 0 };
  const batch = q.slice(0, 50);
  const res = await fetch("/api/pos/offline", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sales: batch.map((s) => ({ clientId: s.clientId, registerId: s.registerId, shiftId: s.shiftId, receiptNum: s.receiptNum, soldAt: s.soldAt, payment: s.payment, cashGiven: s.cashGiven, lines: s.lines })),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const out = (await res.json()) as { results: { clientId: string; ok: boolean; message?: string }[]; eetQueue?: number };
  const byId = new Map(out.results.map((r) => [r.clientId, r]));
  // fronta se mezitím mohla změnit (další prodej) — upravit čerstvou
  const now = parseQueue(queueRaw(registerId));
  const left = now
    .filter((s) => !byId.get(s.clientId)?.ok)
    .map((s) => {
      const r = byId.get(s.clientId);
      return r && !r.ok ? { ...s, error: r.message ?? "?" } : s;
    });
  write(registerId, left);
  const sent = out.results.filter((r) => r.ok).length;
  return { sent, failed: out.results.length - sent, eetQueue: out.eetQueue };
}

/** Je server dostupný? (po výpadku — kasa se vrátí k běžnému prodeji) */
export async function serverReachable(): Promise<boolean> {
  try {
    const r = await fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(8000) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Záloha stránky kasy pro otevření bez připojení (service worker /pos-sw.js). */
export function registerPosWorker(): void {
  if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.register("/pos-sw.js", { scope: "/kasa" }).catch(() => undefined);
}

export function subscribeOnline(fn: () => void): () => void {
  window.addEventListener("online", fn);
  window.addEventListener("offline", fn);
  return () => {
    window.removeEventListener("online", fn);
    window.removeEventListener("offline", fn);
  };
}
