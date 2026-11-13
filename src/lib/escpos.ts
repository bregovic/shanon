/**
 * Tisk účtenky na termotiskárně ESC/POS (Epson a kompatibilní) přímo
 * z prohlížeče pokladny přes Web Serial (Chrome, Edge; USB-sériové nebo
 * sériové tiskárny). Čeština v kódové stránce PC852 (ESC t 18), případně
 * bez diakritiky. Pokladní zásuvka připojená k tiskárně: ESC p.
 */
import type { ReceiptPrint } from "@/modules/pos/sale";

const CP852: Record<string, number> = {
  á: 0xa0, č: 0x9f, ď: 0xd4, é: 0x82, ě: 0xd8, í: 0xa1, ň: 0xe5, ó: 0xa2, ř: 0xfd, š: 0xe7, ť: 0x9c, ú: 0xa3, ů: 0x85, ý: 0xec, ž: 0xa7,
  Á: 0xb5, Č: 0xac, Ď: 0xd2, É: 0x90, Ě: 0xb7, Í: 0xd6, Ň: 0xd5, Ó: 0xe0, Ř: 0xfc, Š: 0xe6, Ť: 0x9b, Ú: 0xe9, Ů: 0xde, Ý: 0xed, Ž: 0xa6,
  ä: 0x84, ö: 0x94, ü: 0x81, ô: 0x93, Ä: 0x8e, Ö: 0x99, Ü: 0x9a,
};
const REPLACE: Record<string, string> = { "×": "x", "–": "-", "—": "-", " ": " ", " ": " ", "„": '"', "“": '"', "€": "EUR", "•": "*" };

export type CodePage = "cp852" | "ascii";

export function encodeText(s: string, cp: CodePage): number[] {
  const out: number[] = [];
  for (const ch0 of s) {
    const ch = REPLACE[ch0] ?? ch0;
    for (const ch1 of ch) {
      const code = ch1.charCodeAt(0);
      if (code < 128) out.push(code);
      else if (cp === "cp852" && CP852[ch1] !== undefined) out.push(CP852[ch1]);
      else {
        const plain = ch1.normalize("NFD").replace(/[̀-ͯ]/g, "");
        out.push(plain.length && plain.charCodeAt(0) < 128 ? plain.charCodeAt(0) : 63);
      }
    }
  }
  return out;
}

const ESC = 0x1b;
const GS = 0x1d;

export class EscPos {
  bytes: number[] = [ESC, 0x40];
  constructor(
    public width: number,
    private cp: CodePage,
  ) {
    if (cp === "cp852") this.bytes.push(ESC, 0x74, 18);
  }
  text(s: string) {
    this.bytes.push(...encodeText(s, this.cp));
    return this;
  }
  line(s = "") {
    return this.text(s).raw(0x0a);
  }
  raw(...b: number[]) {
    this.bytes.push(...b);
    return this;
  }
  align(a: "left" | "center" | "right") {
    return this.raw(ESC, 0x61, a === "left" ? 0 : a === "center" ? 1 : 2);
  }
  bold(on: boolean) {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }
  big(on: boolean) {
    return this.raw(GS, 0x21, on ? 0x11 : 0);
  }
  /** levý a pravý text na jeden řádek */
  pair(l: string, r: string) {
    const space = this.width - l.length - r.length;
    if (space >= 1) return this.line(l + " ".repeat(space) + r);
    return this.line(l).line(" ".repeat(Math.max(0, this.width - r.length)) + r);
  }
  sep() {
    return this.line("-".repeat(this.width));
  }
  cut() {
    return this.raw(0x0a, 0x0a, 0x0a, GS, 0x56, 66, 0);
  }
  drawer() {
    return this.raw(ESC, 0x70, 0, 25, 250);
  }
}

export function receiptEscPos(
  r: ReceiptPrint,
  L: Record<string, string>,
  fmt: (v: string | number) => string,
  opts: { width: 48 | 32; codePage: CodePage; drawer: boolean; locale: string },
): Uint8Array {
  const p = new EscPos(opts.width, opts.codePage);
  if (opts.drawer) p.drawer();
  p.align("center");
  if (r.company.tradeName) p.bold(true).line(r.company.tradeName).bold(false).line(r.company.name);
  else p.bold(true).line(r.company.name).bold(false);
  if (r.company.address) p.line(r.company.address);
  p.line([r.company.regNo && `IČO ${r.company.regNo}`, r.company.vatId && `DIČ ${r.company.vatId}`].filter(Boolean).join("  "));
  p.align("left").sep();
  p.pair(L.SimplifiedDoc, r.receiptNum);
  p.pair(r.register, new Date(r.issuedAt).toLocaleString(opts.locale));
  p.sep();
  const n = (v: string) => new Intl.NumberFormat(opts.locale, { maximumFractionDigits: 3 }).format(Number(v));
  for (const l of r.lines) {
    p.line(l.description.slice(0, opts.width));
    p.pair(`  ${n(l.qty)} ${l.unit.toLowerCase()} x ${fmt(l.unitPrice)} ${l.rate}%`, fmt(l.amount));
    if (l.originalPrice) p.line(`  ${L.Discount} z ${fmt(l.originalPrice)}`);
  }
  p.sep();
  if (Number(r.rounding) !== 0) p.pair(L.Rounding, fmt(r.rounding));
  p.bold(true).big(true).pair(L.Total, fmt(r.paid)).big(false).bold(false);
  p.pair(r.payment === "cash" ? L.Cash : L.Card, fmt(r.cashGiven ?? r.paid));
  if (r.change && Number(r.change) > 0) p.pair(L.ChangeDue, fmt(r.change));
  p.sep().line(L.VatRecap);
  for (const v of r.vat) p.pair(`${v.rate} % ${L.Base} ${fmt(v.base)}`, `${L.Vat} ${fmt(v.tax)}`);
  if (r.eet) {
    p.sep();
    if (r.eet.pok) p.line(`POK: ${r.eet.pok}`);
    else p.line(L.EetLater);
  }
  if (r.footer) p.sep().align("center").line(r.footer).align("left");
  p.cut();
  return Uint8Array.from(p.bytes);
}

// ---------------------------------------------------------------------------
// Web Serial (typy nejsou ve standardní knihovně TypeScriptu)
// ---------------------------------------------------------------------------

interface SerialPortLike {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  writable: WritableStream<Uint8Array> | null;
}
interface SerialLike {
  getPorts(): Promise<SerialPortLike[]>;
  requestPort(): Promise<SerialPortLike>;
}
const serial = () => (typeof navigator !== "undefined" ? (navigator as unknown as { serial?: SerialLike }).serial : undefined);

export const serialSupported = () => !!serial();

/** Dříve povolený port (bez dotazu); null = nutno připojit tlačítkem. */
export async function grantedPort(): Promise<SerialPortLike | null> {
  return (await serial()?.getPorts())?.[0] ?? null;
}

export async function requestPort(): Promise<SerialPortLike | null> {
  return (await serial()?.requestPort()) ?? null;
}

export async function writeToPort(port: SerialPortLike, data: Uint8Array, baudRate: number) {
  await port.open({ baudRate });
  try {
    const w = port.writable!.getWriter();
    await w.write(data);
    w.releaseLock();
  } finally {
    await port.close();
  }
}
