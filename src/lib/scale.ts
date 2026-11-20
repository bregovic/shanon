/**
 * Pokladní váha přes sériový port (RS-232 / USB-serial, Web Serial v Chrome a Edge).
 *
 * Protokoly (nastavení na váze musí odpovídat napojení v Integraci):
 * - `toledo8217` — Mettler Toledo 8217 a kompatibilní („W“ → STX hmotnost [N] CR; STX ? stav CR = pohyb / chyba),
 * - `casEcr` — ECR protokol CAS a dalších (ENQ → ACK ustálená / NAK nebo BEL neustálená; DC1 → STX … hmotnost … ETX),
 * - `continuous` — váha sama posílá řádky („ST,GS,+  0.452kg“; ST = ustálená, US = neustálená, OL = přetížení).
 * Dialog 06 (ověřená váha počítá cenu) je zvlášť: src/lib/dialog06.ts + ScaleDriver + panel Váha.
 *
 * Hmotnost se bere jen ustálená a kladná; tárování a nulování dělá váha sama.
 */
export type ScaleProtocol = "toledo8217" | "casEcr" | "continuous";

export interface ScaleConfig {
  protocol: ScaleProtocol;
  baudRate: number;
  dataBits: 7 | 8;
  parity: "none" | "even" | "odd";
  stopBits: 1 | 2;
}

export interface ScaleReading {
  /** hmotnost v kg (null = zatím nic) */
  kg: number | null;
  stable: boolean;
  /** motion | overload | error | ok */
  status: "ok" | "motion" | "overload" | "error";
}

const STX = 0x02;
const ETX = 0x03;
const ENQ = 0x05;
const ACK = 0x06;
const BEL = 0x07;
const NAK = 0x15;
const DC1 = 0x11;
const CR = 0x0d;

/** Dotaz na hmotnost (u `continuous` nic — váha posílá sama). */
export function scaleRequest(protocol: ScaleProtocol): Uint8Array {
  if (protocol === "toledo8217") return Uint8Array.from([0x57]); // "W"
  if (protocol === "casEcr") return Uint8Array.from([ENQ, DC1]);
  return new Uint8Array();
}

const text = (b: number[]) => String.fromCharCode(...b.filter((c) => c >= 0x20 && c < 0x7f));
/** Číslo hmotnosti z textu: „ 0.452“, „0,452“, „00452“ s jednotkou g/kg/lb. */
function weightOf(s: string): number | null {
  const m = /([-+]?\s*\d+(?:[.,]\d+)?)\s*(kg|g|lb)?/i.exec(s);
  if (!m) return null;
  let v = Number(m[1].replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(v)) return null;
  const unit = (m[2] ?? "kg").toLowerCase();
  if (unit === "g") v /= 1000;
  if (unit === "lb") v *= 0.45359237;
  return Math.round(v * 1000) / 1000;
}

/**
 * Rozbor přijatých bajtů (od posledního dotazu). Vrací poslední úplnou odpověď, nebo null, když
 * odpověď ještě není celá.
 */
export function parseScale(protocol: ScaleProtocol, bytes: number[]): ScaleReading | null {
  if (protocol === "toledo8217") {
    // STX ? status CR  →  pohyb (bit 0), přetížení (bit 2 / 3), jinak chyba
    const s = bytes.lastIndexOf(STX);
    if (s < 0) return null;
    const end = bytes.indexOf(CR, s);
    if (end < 0) return null;
    const frame = bytes.slice(s + 1, end);
    if (frame[0] === 0x3f) {
      const st = frame[1] ?? 0;
      return { kg: null, stable: false, status: st & 0x01 ? "motion" : st & 0x0c ? "overload" : "error" };
    }
    const kg = weightOf(text(frame));
    return kg === null ? { kg: null, stable: false, status: "error" } : { kg, stable: true, status: "ok" };
  }
  if (protocol === "casEcr") {
    // ACK = ustálená, NAK / BEL = neustálená; data mezi STX a ETX (příznak S/U uvnitř rámce má přednost)
    const s = bytes.lastIndexOf(STX);
    const e = s >= 0 ? bytes.indexOf(ETX, s) : -1;
    if (s < 0 || e < 0) {
      if (bytes.includes(NAK) || bytes.includes(BEL)) return { kg: null, stable: false, status: "motion" };
      return null;
    }
    const body = text(bytes.slice(s + 1, e));
    const kg = weightOf(body.replace(/^[A-Z]{1,2}[,\s]*/i, ""));
    const flagUnstable = /\bU[ST]?\b|^U/i.test(body) && !/\bS[T]?\b|^S/i.test(body);
    const before = bytes.slice(0, s);
    const unstable = flagUnstable || before.includes(NAK) || before.includes(BEL) || (!before.includes(ACK) && /^U/i.test(body));
    if (/OL|overload/i.test(body)) return { kg: null, stable: false, status: "overload" };
    if (kg === null) return { kg: null, stable: false, status: "error" };
    return { kg, stable: !unstable, status: unstable ? "motion" : "ok" };
  }
  // continuous: poslední celý řádek (za posledním CR/LF může být řádek teprve rozepsaný)
  const all = String.fromCharCode(...bytes).split(/\r\n|\r|\n/);
  const complete = all.slice(0, -1).map((l) => text([...l].map((c) => c.charCodeAt(0))));
  const last = [...complete].reverse().find((l) => l.trim());
  if (!last) return null;
  if (/^\s*OL/i.test(last)) return { kg: null, stable: false, status: "overload" };
  const kg = weightOf(last.replace(/^\s*(ST|US|OL)\s*,\s*(GS|NT|TR)?\s*,?/i, ""));
  const unstable = /^\s*US/i.test(last);
  if (kg === null) return { kg: null, stable: false, status: "error" };
  return { kg, stable: !unstable, status: unstable ? "motion" : "ok" };
}

// ---------------------------------------------------------------------------
// Web Serial: port váhy zvlášť od tiskárny (zapamatovaný podle USB identifikace)
// ---------------------------------------------------------------------------

interface PortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}
interface ReadablePort {
  open(o: { baudRate: number; dataBits?: number; stopBits?: number; parity?: string }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  getInfo?(): PortInfo;
}
interface SerialApi {
  getPorts(): Promise<ReadablePort[]>;
  requestPort(): Promise<ReadablePort>;
}
const serialApi = () => (typeof navigator !== "undefined" ? (navigator as unknown as { serial?: SerialApi }).serial : undefined);
const KEY = "pos.port.scale";
const infoKey = (p: ReadablePort) => {
  const i = p.getInfo?.() ?? {};
  return `${i.usbVendorId ?? "-"}:${i.usbProductId ?? "-"}`;
};
function remembered(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Zapamatovaný port váhy (bez dotazu), null = připojit tlačítkem. */
export async function scalePort(): Promise<ReadablePort | null> {
  const want = remembered();
  if (!want) return null;
  return (await serialApi()?.getPorts())?.find((p) => infoKey(p) === want) ?? null;
}

/** Výběr portu váhy (dialog prohlížeče) a zapamatování. */
export async function connectScalePort(): Promise<ReadablePort | null> {
  const p = (await serialApi()?.requestPort().catch(() => null)) ?? null;
  if (p) {
    try {
      localStorage.setItem(KEY, infoKey(p));
    } catch {
      /* bez úložiště jen pro tuto relaci */
    }
  }
  return p;
}

/** Je daný port váha? (tiskárna ho pak nepoužije) */
export const isScalePort = (p: { getInfo?(): PortInfo }) => !!remembered() && infoKey(p as ReadablePort) === remembered();

/**
 * Jedno čtení hmotnosti: otevřít port, poslat dotaz, číst do úplné odpovědi (nejvýš `timeoutMs`), zavřít.
 */
export async function readScale(port: ReadablePort, cfg: ScaleConfig, timeoutMs = 1500): Promise<ScaleReading> {
  await port.open({ baudRate: cfg.baudRate || 9600, dataBits: cfg.dataBits || 8, stopBits: cfg.stopBits || 1, parity: cfg.parity || "none" });
  const reader = port.readable!.getReader();
  try {
    const req = scaleRequest(cfg.protocol);
    if (req.length) {
      const w = port.writable!.getWriter();
      await w.write(req);
      w.releaseLock();
    }
    const bytes: number[] = [];
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const chunk = await Promise.race([reader.read(), new Promise<{ value?: undefined; done: true }>((r) => setTimeout(() => r({ done: true }), Math.max(10, deadline - Date.now())))]);
      if (chunk.value) bytes.push(...chunk.value);
      const r = parseScale(cfg.protocol, bytes);
      // u plynulého posílání počkat na celý další řádek po otevření (první může být useknutý)
      if (r && (cfg.protocol !== "continuous" || bytes.filter((b) => b === 0x0a).length >= 2)) return r;
      if (chunk.done && !chunk.value) break;
    }
    return { kg: null, stable: false, status: "error" };
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    await port.close().catch(() => undefined);
  }
}

/** Simulátor váhy (testovací prostředí): po chvíli ustálená hmotnost 0,1–1,5 kg. */
export async function readScaleSim(attempt: number): Promise<ScaleReading> {
  await new Promise((r) => setTimeout(r, 300));
  if (attempt < 2) return { kg: Math.round((0.3 + Math.random()) * 1000) / 1000, stable: false, status: "motion" };
  return { kg: Math.round((0.1 + Math.random() * 1.4) * 1000) / 1000, stable: true, status: "ok" };
}

export type { ReadablePort };

export interface SerialSettings {
  baudRate: number;
  dataBits: 7 | 8;
  parity: "none" | "even" | "odd";
  stopBits: 1 | 2;
}

/**
 * Zkouška váhy: otevřít port s nastavením, poslat bajty (prázdné = jen poslouchat), sbírat vše `ms`, zavřít.
 * Vrací přijaté bajty — stránka Zkouška váhy z nich pozná protokol a nastavení.
 */
export async function serialExchange(port: ReadablePort, s: SerialSettings, send: Uint8Array, ms: number): Promise<number[]> {
  await port.open({ baudRate: s.baudRate, dataBits: s.dataBits, stopBits: s.stopBits, parity: s.parity });
  const reader = port.readable!.getReader();
  const bytes: number[] = [];
  try {
    if (send.length) {
      const w = port.writable!.getWriter();
      await w.write(send);
      w.releaseLock();
    }
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const chunk = await Promise.race([reader.read(), new Promise<{ value?: undefined; done: true }>((r) => setTimeout(() => r({ done: true }), Math.max(10, deadline - Date.now())))]);
      if (chunk.value) bytes.push(...chunk.value);
      else if (chunk.done && Date.now() >= deadline) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    await port.close().catch(() => undefined);
  }
  return bytes;
}
