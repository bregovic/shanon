/**
 * Zákaznická obrazovka pokladny: kasa posílá stav nákupu (`publishDisplay`), stránka portálu „Zákaznická obrazovka“
 * ho čte dlouhým dotazem (`waitDisplay`). Jen v paměti serveru (stav je okamžitý, nic se neukládá) – jeden server;
 * po restartu obrazovka ukáže úvod, dokud kasa nepošle další změnu.
 */

export interface DisplayLine {
  name: string;
  qty: string;
  amount: string;
}

export interface DisplayState {
  /** idle = úvod (logo, text), cart = markuje se, pay = platí se, done = zaplaceno */
  phase: "idle" | "cart" | "pay" | "done";
  lines: DisplayLine[];
  total: string;
  customer: string;
  /** QR platba: řetězec SPAYD k naskenování */
  qr: string | null;
  paid: string | null;
  change: string | null;
}

interface Entry {
  version: number;
  at: number;
  state: DisplayState;
}

const g = globalThis as unknown as { __posDisplay?: { store: Map<string, Entry>; waiters: Map<string, Set<() => void>> } };
const mem = (g.__posDisplay ??= { store: new Map(), waiters: new Map() });
const key = (tenantId: string, registerId: string) => `${tenantId}:${registerId}`;

export const IDLE: DisplayState = { phase: "idle", lines: [], total: "0", customer: "", qr: null, paid: null, change: null };

export function publishDisplay(tenantId: string, registerId: string, state: DisplayState) {
  const k = key(tenantId, registerId);
  const prev = mem.store.get(k);
  mem.store.set(k, { version: (prev?.version ?? 0) + 1, at: Date.now(), state });
  for (const fn of [...(mem.waiters.get(k) ?? [])]) fn();
}

export function readDisplay(tenantId: string, registerId: string): { version: number; state: DisplayState } {
  const e = mem.store.get(key(tenantId, registerId));
  // stav starší než 12 h (zapomenutý nákup po zavření kasy) = úvod
  if (!e || Date.now() - e.at > 12 * 3600_000) return { version: e?.version ?? 0, state: IDLE };
  return { version: e.version, state: e.state };
}

/** Počká na změnu oproti `since` (nejvýš `waitMs`), pak vrátí aktuální stav. */
export async function waitDisplay(tenantId: string, registerId: string, since: number, waitMs = 20_000) {
  const k = key(tenantId, registerId);
  if (readDisplay(tenantId, registerId).version === since) {
    await new Promise<void>((resolve) => {
      const set = mem.waiters.get(k) ?? new Set();
      const done = () => {
        clearTimeout(t);
        set.delete(done);
        if (!set.size) mem.waiters.delete(k);
        resolve();
      };
      const t = setTimeout(done, waitMs);
      set.add(done);
      mem.waiters.set(k, set);
    });
  }
  return readDisplay(tenantId, registerId);
}
