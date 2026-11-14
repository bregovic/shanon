/**
 * Tisková sestava do PDF (na serveru, vektorově — text jde vybrat a hledat).
 * Stejná pravidla jako HTML vykreslovač (src/lib/print-render.tsx): prvky nad
 * tabulkou řádků = hlavička, tabulka teče přes stránky (záhlaví se opakuje),
 * prvky pod ní se posunou o její skutečnou výšku. Písmo DejaVu Sans (čeština).
 */
import { join } from "node:path";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { PAPERS, valueAt, type PrintData, type PrintElement, type PrintLayout } from "@/core/print";
import { fillText, formatValue } from "@/lib/print-render";

const MM = 72 / 25.4;
const FONT_DIR = join(process.cwd(), "node_modules", "dejavu-fonts-ttf", "ttf");
const MARGIN = 12; // mm nahoře a dole na pokračovacích stránkách
const LINE = 1.25;

type Doc = InstanceType<typeof PDFDocument>;

function font(doc: Doc, s: PrintElement["style"] | undefined, size: number) {
  doc.font(s?.bold ? "B" : s?.italic ? "I" : "R").fontSize(size);
}

const color = (c?: string) => (c && /^#[0-9a-f]{3,8}$/i.test(c) ? c : "#000000");

function imageSrc(el: PrintElement, data: PrintData): Buffer | null {
  const src = el.src || (el.field ? String(valueAt(data, el.field) ?? "") : "");
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(src);
  return m ? Buffer.from(m[2], "base64") : null;
}

/** Prvek na pozici (mm, y relativně k `dy`). */
/** Vykreslí prvek; vrací skutečnou výšku v pt (text a tabulky podle obsahu). */
function drawElement(doc: Doc, el: PrintElement, data: PrintData, locale: string, fontSize: number, dy = 0): number {
  const s = el.style ?? {};
  if (el.showIf) {
    const v = valueAt(data, el.showIf);
    if (v === null || v === undefined || v === "" || v === "0" || v === "0.00") return 0;
  }
  const x = el.x * MM;
  const y = (el.y + dy) * MM;
  const w = el.w * MM;
  const h = el.h * MM;
  // u tabulek je výplň barva záhlaví
  if (s.fill && el.type !== "line" && el.type !== "vat" && el.type !== "table") doc.save().rect(x, y, w, h).fill(color(s.fill)).restore();
  switch (el.type) {
    case "text": {
      font(doc, s, s.size ?? fontSize);
      const pad = s.fill || s.border ? 1.2 * MM : 0;
      const txt = fillText(el.text ?? "", data, locale);
      const opts = { width: w - 2 * pad, align: s.align ?? "left", lineGap: (s.size ?? fontSize) * (LINE - 1.15) } as const;
      doc.fillColor(color(s.color)).text(txt, x + pad, y + pad, opts);
      if (s.border) doc.lineWidth(0.3 * MM).strokeColor("#000").rect(x, y, w, h).stroke();
      return doc.heightOfString(txt || " ", opts) + 2 * pad;
    }
    case "line":
      doc.lineWidth(0.3 * MM).strokeColor(color(s.color)).moveTo(x, y).lineTo(x + w, y).stroke();
      return h;
    case "rect":
      doc.lineWidth(0.3 * MM).strokeColor(color(s.color)).rect(x, y, w, h).stroke();
      return h;
    case "image": {
      const img = imageSrc(el, data);
      if (img) doc.image(img, x, y, { fit: [w, h], align: s.align === "right" ? "right" : s.align === "center" ? "center" : undefined, valign: "center" });
      return h;
    }
    case "qr": {
      const text = String(valueAt(data, el.field || "qr") ?? "");
      if (!text) return h;
      const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
      const n = qr.modules.size;
      const size = Math.min(w, h);
      const cell = size / (n + 4);
      doc.save().rect(x, y, size, size).fill("#ffffff");
      doc.fillColor("#000000");
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.modules.get(r, c)) doc.rect(x + (c + 2) * cell, y + (r + 2) * cell, cell + 0.05, cell + 0.05);
      doc.fill().restore();
      return h;
    }
    case "vat":
      return drawTable(doc, el, (valueAt(data, "vat") as Record<string, unknown>[]) ?? [], locale, fontSize, y, Infinity) - y;
    case "table":
      return drawTable(doc, el, (valueAt(data, "lines") as Record<string, unknown>[]) ?? [], locale, fontSize, y, Infinity) - y;
  }
  return h;
}

/**
 * Tabulka od `y0` (pt); stránkuje, když řádek přesáhne `limit` (pt).
 * Vrací y (pt) pod posledním řádkem.
 */
function drawTable(doc: Doc, el: PrintElement, rows: Record<string, unknown>[], locale: string, fontSize: number, y0: number, limit: number, onNewPage?: () => number): number {
  const cols = el.columns ?? [];
  const size = el.style?.size ?? fontSize - 1;
  const x0 = el.x * MM;
  const pad = 1 * MM;
  const headFill = el.style?.fill;
  let y = y0;
  const cellText = (c: (typeof cols)[number], r: Record<string, unknown>) => formatValue(r[c.field], c.format, locale);
  const rowHeight = (texts: string[], bold: boolean) => {
    doc.font(bold ? "B" : "R").fontSize(size);
    return Math.max(...cols.map((c, i) => doc.heightOfString(texts[i] || " ", { width: c.width * MM - 2 * pad }))) + 1.4 * MM;
  };
  const header = () => {
    const texts = cols.map((c) => c.label);
    const hh = rowHeight(texts, true);
    if (headFill) doc.save().rect(x0, y, el.w * MM, hh).fill(color(headFill)).restore();
    let x = x0;
    doc.font("B").fontSize(size).fillColor(color(el.style?.color));
    cols.forEach((c, i) => {
      doc.text(texts[i], x + pad, y + 0.7 * MM, { width: c.width * MM - 2 * pad, align: c.align ?? "left" });
      x += c.width * MM;
    });
    y += hh;
    doc.lineWidth(0.3 * MM).strokeColor("#000").moveTo(x0, y).lineTo(x0 + el.w * MM, y).stroke();
  };
  header();
  rows.forEach((r) => {
    const texts = cols.map((c) => cellText(c, r));
    const rh = rowHeight(texts, false);
    if (y + rh > limit && onNewPage) {
      y = onNewPage();
      header();
    }
    let x = x0;
    doc.font("R").fontSize(size).fillColor("#000");
    cols.forEach((c, i) => {
      doc.text(texts[i], x + pad, y + 0.6 * MM, { width: c.width * MM - 2 * pad, align: c.align ?? "left" });
      x += c.width * MM;
    });
    y += rh;
    doc.lineWidth(0.1 * MM).strokeColor("#cccccc").moveTo(x0, y).lineTo(x0 + el.w * MM, y).stroke();
  });
  return y;
}

/** PDF sestavy (A4/A5/štítek; účtenka jako jedna dlouhá stránka). */
export async function renderPdf(layout: PrintLayout, data: PrintData, opts: { locale?: string; title?: string } = {}): Promise<Buffer> {
  const locale = opts.locale ?? "cs-CZ";
  const paper = PAPERS[layout.paper] ?? PAPERS.a4;
  const fs = layout.fontSize || 9;
  const flow = !paper.h;
  // účtenka: výška podle obsahu (odhad — dole se ořízne)
  const pageH = flow ? Math.max(60, ...layout.elements.map((e) => e.y + e.h)) + 20 + ((valueAt(data, "lines") as unknown[] | undefined)?.length ?? 0) * 5 : paper.h;
  const doc = new PDFDocument({ size: [paper.w * MM, pageH * MM], margin: 0, autoFirstPage: true, info: { Title: opts.title ?? "", Producer: "Shanon" } });
  doc.registerFont("R", join(FONT_DIR, "DejaVuSans.ttf"));
  doc.registerFont("B", join(FONT_DIR, "DejaVuSans-Bold.ttf"));
  doc.registerFont("I", join(FONT_DIR, "DejaVuSans-Oblique.ttf"));
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));

  const table = layout.elements.find((e) => e.type === "table");
  if (flow) {
    // účtenka: prvky pod sebou, delší obsah posune vše pod ním; skryté prvky nezabírají místo
    const visible = layout.elements.filter((e) => {
      if (!e.showIf) return true;
      const v = valueAt(data, e.showIf);
      return !(v === null || v === undefined || v === "" || v === "0" || v === "0.00");
    });
    const top = Math.min(...visible.map((e) => e.y));
    let shift = -top;
    for (const el of [...visible].sort((a, b) => a.y - b.y || a.x - b.x)) {
      const real = drawElement(doc, el, data, locale, fs, shift) / MM;
      shift += Math.max(0, real - el.h);
    }
  } else if (!table) {
    for (const el of layout.elements) drawElement(doc, el, data, locale, fs);
  } else {
    const head = layout.elements.filter((e) => e !== table && e.y < table.y);
    const rest = layout.elements.filter((e) => e !== table && e.y >= table.y);
    for (const el of head) drawElement(doc, el, data, locale, fs);
    const bottomLimit = (pageH - MARGIN) * MM;
    const newPage = () => {
      doc.addPage({ size: [paper.w * MM, pageH * MM], margin: 0 });
      return MARGIN * MM;
    };
    const rows = (valueAt(data, "lines") as Record<string, unknown>[]) ?? [];
    const endY = drawTable(doc, table, rows, locale, fs, table.y * MM, flow ? Infinity : bottomLimit, newPage) / MM;
    // zbytek pod tabulkou; když se nevejde, na novou stránku
    const bottom = table.y + table.h;
    const restH = Math.max(0, ...rest.map((e) => e.y - bottom + e.h));
    // prvky pod tabulkou zůstanou na navržené pozici (dolní část stránky), posunou se jen při přetečení
    let base = Math.max(endY + 2, bottom);
    if (!flow && base + restH > pageH - MARGIN / 2) base = newPage() / MM;
    for (const el of rest) drawElement(doc, el, data, locale, fs, base - bottom);
  }
  doc.end();
  return done;
}
