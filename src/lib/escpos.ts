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

import { isScalePort } from "./scale";

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
  /** QR kód příkazem tiskárny (GS ( k, model 2, oprava M); text jen ASCII (QR platba) */
  qr(text: string, moduleSize = 6) {
    const data = [...text].map((c) => (c.charCodeAt(0) < 128 ? c.charCodeAt(0) : 63));
    const len = data.length + 3;
    return this.raw(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0) // model 2
      .raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, moduleSize) // velikost modulu
      .raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31) // oprava chyb M
      .raw(GS, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30, ...data) // uložit data
      .raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30); // vytisknout
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
  // zápis v rejstříku (spisová značka) — dlouhý text po řádcích šířky papíru
  if (r.company.registration) for (let i = 0; i < r.company.registration.length; i += opts.width) p.line(r.company.registration.slice(i, i + opts.width));
  p.align("left").sep();
  const known = !!r.customer && !r.customer.adhoc; // odběratel jen na účtenku fakturu nedělá
  p.pair(r.vatPayer === false ? (known ? L.InvoiceNonPayer : L.Receipt) : known ? L.InvoiceDoc : L.SimplifiedDoc, r.receiptNum);
  p.pair(r.register, new Date(r.issuedAt).toLocaleString(opts.locale));
  if (r.customer) {
    // odběratel (faktura – daňový doklad)
    p.sep().line(`${L.Customer}: ${r.customer.name}`.slice(0, opts.width));
    if (r.customer.address) p.line(r.customer.address.slice(0, opts.width));
    const ids = [r.customer.regNo && `IČO ${r.customer.regNo}`, r.customer.vatId && `DIČ ${r.customer.vatId}`].filter(Boolean).join("  ");
    if (ids) p.line(ids);
  }
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
  p.pair(r.payment === "cash" ? L.Cash : r.payment === "qr" ? L.QrPayment : L.Card, fmt(r.cashGiven ?? r.paid));
  if (r.change && Number(r.change) > 0) p.pair(L.ChangeDue, fmt(r.change));
  // QR platba čekající na úhradu: výzva, QR kód a VS
  if (r.qr) {
    p.sep().align("center").bold(true).line(L.QrAwaitingNote).bold(false).qr(r.qr).raw(0x0a);
    if (r.vs) p.line(`VS ${r.vs}`);
    p.align("left");
  }
  if (r.vatPayer === false) p.sep().line(L.NonPayerNote);
  else {
    p.sep().line(L.VatRecap);
    for (const v of r.vat) p.pair(`${v.rate} % ${L.Base} ${fmt(v.base)}`, `${L.Vat} ${fmt(v.tax)}`);
  }
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
  getInfo?(): { usbVendorId?: number; usbProductId?: number };
}
interface SerialLike {
  getPorts(): Promise<SerialPortLike[]>;
  requestPort(): Promise<SerialPortLike>;
}
const serial = () => (typeof navigator !== "undefined" ? (navigator as unknown as { serial?: SerialLike }).serial : undefined);

export const serialSupported = () => !!serial();

/** Dříve povolený port (bez dotazu); null = nutno připojit tlačítkem. */
export async function grantedPort(): Promise<SerialPortLike | null> {
  // port pokladní váhy tiskárna nepoužije (src/lib/scale.ts si ho pamatuje)
  return (await serial()?.getPorts())?.find((p) => !isScalePort(p)) ?? null;
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

// ---------------------------------------------------------------------------
// WebUSB – tiskárna připojená kabelem USB k tabletu s Androidem (Chrome). Web Serial tam USB tiskárnu nevidí
// (Epson TM není USB-sériový převodník), WebUSB ano: tiskárna se jednou vybere v nabídce prohlížeče a Chrome
// si povolení pamatuje (`getDevices`). Data jdou rovnou na výstupní koncový bod (bulk OUT) tiskového rozhraní.
// ---------------------------------------------------------------------------

interface UsbEndpointLike {
  endpointNumber: number;
  direction: "in" | "out";
  type: "bulk" | "interrupt" | "isochronous";
}
interface UsbInterfaceLike {
  interfaceNumber: number;
  claimed?: boolean;
  alternate: { interfaceClass: number; endpoints: UsbEndpointLike[] };
}
interface UsbDeviceLike {
  vendorId: number;
  productId: number;
  productName?: string;
  opened: boolean;
  configuration: { interfaces: UsbInterfaceLike[] } | null;
  configurations?: unknown[];
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(n: number): Promise<void>;
  claimInterface(n: number): Promise<void>;
  releaseInterface(n: number): Promise<void>;
  transferOut(endpoint: number, data: BufferSource): Promise<{ status: string }>;
}
interface UsbLike {
  getDevices(): Promise<UsbDeviceLike[]>;
  requestDevice(o: { filters: { vendorId?: number; classCode?: number }[] }): Promise<UsbDeviceLike>;
}
const usb = () => (typeof navigator !== "undefined" ? (navigator as unknown as { usb?: UsbLike }).usb : undefined);

/** Epson (vendor 0x04B8) a cokoli s rozhraním třídy tiskárna (7). */
const EPSON = 0x04b8;
const PRINTER_CLASS = 7;

export const usbSupported = () => !!usb();

/** Dříve povolená USB tiskárna (bez dotazu); null = nutno připojit tlačítkem. */
export async function grantedUsbPrinter(): Promise<UsbDeviceLike | null> {
  const list = (await usb()?.getDevices()) ?? [];
  return list.find((d) => d.vendorId === EPSON) ?? list[0] ?? null;
}

export async function requestUsbPrinter(): Promise<UsbDeviceLike | null> {
  return (await usb()?.requestDevice({ filters: [{ vendorId: EPSON }, { classCode: PRINTER_CLASS }] })) ?? null;
}

/** Rozhraní s výstupním koncovým bodem bulk – přednostně třída tiskárna, jinak první (Epson „vendor-defined“). */
function printInterface(dev: UsbDeviceLike): { iface: UsbInterfaceLike; endpoint: number } | null {
  const cands = (dev.configuration?.interfaces ?? [])
    .map((iface) => ({ iface, ep: iface.alternate.endpoints.find((e) => e.direction === "out" && e.type === "bulk") }))
    .filter((c): c is { iface: UsbInterfaceLike; ep: UsbEndpointLike } => !!c.ep);
  const best = cands.find((c) => c.iface.alternate.interfaceClass === PRINTER_CLASS) ?? cands[0];
  return best ? { iface: best.iface, endpoint: best.ep.endpointNumber } : null;
}

export async function writeToUsb(dev: UsbDeviceLike, data: Uint8Array) {
  if (!dev.opened) await dev.open();
  if (!dev.configuration) await dev.selectConfiguration(1);
  const target = printInterface(dev);
  if (!target) throw new Error("USB: tiskárna nemá tiskové rozhraní");
  const n = target.iface.interfaceNumber;
  if (!target.iface.claimed) await dev.claimInterface(n);
  try {
    // po částech – některé tiskárny na Androidu neunesou jeden velký přenos
    for (let i = 0; i < data.length; i += 16384) await dev.transferOut(target.endpoint, data.slice(i, i + 16384));
  } finally {
    await dev.releaseInterface(n).catch(() => undefined);
    await dev.close().catch(() => undefined);
  }
}
