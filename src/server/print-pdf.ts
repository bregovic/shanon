/**
 * Tisková sestava do PDF (na serveru, vektorově — text jde vybrat a hledat).
 * Stejná pravidla jako HTML vykreslovač (src/lib/print-render.tsx): prvky nad
 * tabulkou řádků = hlavička, tabulka teče přes stránky (záhlaví se opakuje),
 * prvky pod ní se posunou o její skutečnou výšku. Písmo DejaVu Sans (čeština).
 */
import { join } from "node:path";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { PAPERS, flowGroups, textBlocks, valueAt, type PrintData, type PrintElement, type PrintLayout } from "@/core/print";
import { fillText, formatValue } from "@/lib/print-render";

const MM = 72 / 25.4;
const FONT_DIR = join(process.cwd(), "node_modules", "dejavu-fonts-ttf", "ttf");
const MARGIN = 15; // mm nahoře a dole na pokračovacích stránkách (tiskárny netisknou ~5 mm u okraje)
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
  const vpad = (el.style?.rowPad ?? 0.6) * MM;
  const headFill = el.style?.fill;
  let y = y0;
  const cellText = (c: (typeof cols)[number], r: Record<string, unknown>) => formatValue(r[c.field], c.format, locale);
  const rowHeight = (texts: string[], bold: boolean) => {
    doc.font(bold ? "B" : "R").fontSize(size);
    return Math.max(...cols.map((c, i) => doc.heightOfString(texts[i] || " ", { width: c.width * MM - 2 * pad }))) + 2 * vpad + 0.2 * MM;
  };
  const header = () => {
    const texts = cols.map((c) => c.label);
    const hh = rowHeight(texts, true);
    if (headFill) doc.save().rect(x0, y, el.w * MM, hh).fill(color(headFill)).restore();
    let x = x0;
    doc.font("B").fontSize(size).fillColor(color(el.style?.color));
    cols.forEach((c, i) => {
      doc.text(texts[i], x + pad, y + vpad + 0.1 * MM, { width: c.width * MM - 2 * pad, align: c.align ?? "left" });
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
      doc.text(texts[i], x + pad, y + vpad, { width: c.width * MM - 2 * pad, align: c.align ?? "left" });
      x += c.width * MM;
    });
    y += rh;
    doc.lineWidth(0.1 * MM).strokeColor("#cccccc").moveTo(x0, y).lineTo(x0 + el.w * MM, y).stroke();
  });
  return y;
}

/** PDF sestavy (A4/A5/štítek; účtenka jako jedna dlouhá stránka). */
export async function renderPdf(
  layout: PrintLayout,
  data: PrintData,
  opts: { locale?: string; title?: string; attachments?: { name: string; mime: string; data: string | Buffer }[] } = {},
): Promise<Buffer> {
  return renderPdfMany([{ layout, data, attachments: opts.attachments }], opts);
}

/**
 * Víc dokladů do jednoho PDF (hromadný tisk ze seznamu) — každý doklad začíná
 * na nové stránce. Spojit hotová PDF by chtělo další knihovnu; kreslit je do
 * jednoho dokumentu vyjde nastejno.
 */
export async function renderPdfMany(
  jobs: { layout: PrintLayout; data: PrintData; attachments?: { name: string; mime: string; data: string | Buffer }[] }[],
  opts: { locale?: string; title?: string } = {},
): Promise<Buffer> {
  const locale = opts.locale ?? "cs-CZ";
  const doc = newPdf({ Title: opts.title ?? "", Producer: "Shanon" });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));
  for (const job of jobs) drawJob(doc, job.layout, job.data, locale);
  // vložené soubory (ISDOC faktury — účetní programy odběratelů si ho načtou samy)
  for (const a of jobs.flatMap((j) => j.attachments ?? [])) doc.file(Buffer.isBuffer(a.data) ? a.data : Buffer.from(a.data, "utf8"), { name: a.name, type: a.mime, description: a.name });
  doc.end();
  return done;
}

/**
 * Účtenka v toku: skupiny prvků pod sebou (ve skupině sloupce vedle sebe, `flowGroups`), delší obsah posune
 * vše pod ním. Vrací spodní okraj obsahu v mm.
 */
function drawFlow(doc: Doc, layout: PrintLayout, data: PrintData, locale: string, fs: number, ox: number, top: number): number {
  let cursor = top;
  for (const g of flowGroups(layout, data)) {
    const gTop = cursor + g.gap;
    let bottom = gTop;
    for (const c of g.columns) {
      let y = gTop;
      for (const { el, gap } of c.items) {
        y += gap;
        const real = drawElement(doc, { ...el, x: el.x + ox }, data, locale, fs, y - el.y) / MM;
        y += el.type === "text" ? real : Math.max(real, el.h);
      }
      bottom = Math.max(bottom, y);
    }
    cursor = bottom;
  }
  return cursor;
}

/** Dokument na měření výšky účtenky (vysoká stránka, nikam se neukládá). */
function scratchPdf(widthMm: number): Doc {
  const doc = newPdf();
  doc.addPage({ size: [widthMm * MM, 14000], margin: 0 });
  return doc;
}

function newPdf(info: { Title?: string; Producer?: string } = {}): Doc {
  const doc = new PDFDocument({ margin: 0, autoFirstPage: false, info });
  doc.registerFont("R", join(FONT_DIR, "DejaVuSans.ttf"));
  doc.registerFont("B", join(FONT_DIR, "DejaVuSans-Bold.ttf"));
  doc.registerFont("I", join(FONT_DIR, "DejaVuSans-Oblique.ttf"));
  return doc;
}

/** Jeden doklad od nové stránky. */
function drawJob(doc: Doc, layout: PrintLayout, data: PrintData, locale: string) {
  const paper = PAPERS[layout.paper] ?? PAPERS.a4;
  const fs = layout.fontSize || 9;
  const flow = !paper.h;
  const pageW = paper.sheet?.w ?? paper.w;
  // účtenka: výška přesně podle obsahu (nanečisto vykreslená) — na roli bez prázdného papíru;
  // účtenka na listu (A6) aspoň celý list, obsah na střed
  const ox = paper.sheet ? (paper.sheet.w - paper.w) / 2 : 0;
  const top = paper.sheet?.margin ?? 0;
  const pageH = flow ? Math.max(Math.ceil(drawFlow(scratchPdf(pageW), layout, data, locale, fs, ox, top)) + 3, paper.sheet?.h ?? 0) : paper.h;
  doc.addPage({ size: [pageW * MM, pageH * MM], margin: 0 });

  const table = layout.elements.find((e) => e.type === "table");
  if (flow) {
    drawFlow(doc, layout, data, locale, fs, ox, top);
  } else if (!table && layout.elements.some((e) => e.style?.flow || e.style?.pageBreak)) {
    drawFlowing(doc, layout, data, locale, fs, pageW, pageH);
  } else if (!table) {
    for (const el of layout.elements) drawElement(doc, el, data, locale, fs);
  } else {
    const head = layout.elements.filter((e) => e !== table && e.y < table.y);
    const rest = layout.elements.filter((e) => e !== table && e.y >= table.y);
    for (const el of head) drawElement(doc, el, data, locale, fs);
    const bottomLimit = (pageH - MARGIN) * MM;
    const newPage = () => {
      doc.addPage({ size: [pageW * MM, pageH * MM], margin: 0 });
      return MARGIN * MM;
    };
    const rows = (valueAt(data, "lines") as Record<string, unknown>[]) ?? [];
    const endY = drawTable(doc, table, rows, locale, fs, table.y * MM, flow ? Infinity : bottomLimit, newPage) / MM;
    // zbytek pod tabulkou; když se nevejde, na novou stránku
    const bottom = table.y + table.h;
    const restH = Math.max(0, ...rest.map((e) => e.y - bottom + e.h));
    // prvky pod tabulkou zůstanou na navržené pozici (dolní část stránky), posunou se jen při přetečení
    // role (účtenka): souhrn hned pod tabulkou, bez navržené mezery
    let base = flow ? endY + 2 : Math.max(endY + 2, bottom);
    if (!flow && base + restH > pageH - MARGIN / 2) base = newPage() / MM;
    for (const el of rest) drawElement(doc, el, data, locale, fs, base - bottom);
  }
}

/**
 * Sestava s tekoucími texty (`style.flow`): prvky v pořadí shora; tekoucí text pokračuje na dalších stránkách
 * a vše pod ním se posune o jeho skutečnou výšku. Nadpis nezůstane sám na konci stránky, `pageBreak` = od nové stránky.
 */
function drawFlowing(doc: Doc, layout: PrintLayout, data: PrintData, locale: string, fs: number, pageW: number, pageH: number) {
  const els = [...layout.elements].sort((a, b) => a.y - b.y);
  const bottom = pageH - MARGIN;
  let dy = 0;
  const newPage = () => {
    doc.addPage({ size: [pageW * MM, pageH * MM], margin: 0 });
    return MARGIN;
  };
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    if (el.style?.pageBreak && el.y + dy > MARGIN + 1) dy = newPage() - el.y;
    if (!el.style?.flow) {
      drawElement(doc, el, data, locale, fs, dy);
      continue;
    }
    const end = drawParagraphs(doc, el, data, locale, fs, (el.y + dy) * MM, bottom * MM, () => newPage() * MM) / MM;
    // pevné prvky do dalšího tekoucího textu (podpisy) se drží pohromadě
    const next = els.findIndex((e, j) => j > i && (e.style?.flow || e.style?.pageBreak));
    const block = els.slice(i + 1, next < 0 ? undefined : next);
    const elEnd = el.y + el.h;
    const blockH = Math.max(0, ...block.map((e) => e.y + e.h - elEnd));
    // prvky pod textem hned za jeho skutečným koncem; nevejdou-li se, od nové stránky
    dy = end + 2 + blockH > bottom ? newPage() - elEnd : end + 2 - elEnd;
  }
}

/** Odstavce tekoucího textu prvku sestavy od `y0` (pt) – stejná sazba jako samostatné podmínky (`drawRichText`). */
function drawParagraphs(doc: Doc, el: PrintElement, data: PrintData, locale: string, fs: number, y0: number, bottom: number, newPage: () => number): number {
  return drawRichText(doc, fillText(el.text ?? "", data, locale), { x: el.x * MM, w: el.w * MM, size: el.style?.size ?? fs, color: color(el.style?.color), y0, bottom, newPage });
}

/**
 * Sazba textu podmínek (`textBlocks`): nadpisy podle úrovně (nezůstanou samy dole na stránce), bod s předsazeným
 * číslem, odstavec uvnitř bodu odsazený, mezery mezi body, do bloku (řádky s adresou webu vlevo); odstavec se
 * dělí mezi stránky tak, aby na žádné nezůstal jediný řádek. Vrací y pod textem (pt).
 */
export function drawRichText(doc: Doc, text: string, o: { x: number; w: number; size: number; color?: string; y0: number; bottom: number; newPage: () => number }): number {
  const { x, w, size } = o;
  const ink = o.color ?? "#1f2a37";
  const indent = size * 3.2;
  let y = o.y0;
  const top = o.y0;
  const lineH = (f: number) => {
    doc.font("R").fontSize(f);
    return doc.heightOfString("Xg", { width: w });
  };
  for (const [bi, b] of textBlocks(text).entries()) {
    const head = b.kind === "title" || b.kind === "h" || b.kind === "sub";
    const fsz = b.kind === "title" ? size + 3 : b.kind === "h" ? size + 1.5 : size;
    const before = b.kind === "title" ? size * 1.4 : b.kind === "h" ? size * 1.0 : b.kind === "sub" ? size * 0.6 : b.kind === "point" || b.gap ? size * 0.4 : b.kind === "bullet" ? size * 0.1 : size * 0.25;
    if (bi > 0 && y > top + 1) y += before;
    const tx = b.kind === "point" || b.kind === "cont" ? x + indent : b.kind === "bullet" ? x + indent + size * 1.2 : x;
    const tw = w - (tx - x);
    const font = head ? "B" : "R";
    const opts = { width: tw, align: head || /https?:\/\/|www\./.test(b.text) ? "left" : "justify", lineGap: fsz * (LINE - 1.15) } as const;
    doc.font(font).fontSize(fsz);
    const lh = lineH(fsz);
    // nadpis s aspoň třemi řádky textu pod sebou
    if (head && y + doc.heightOfString(b.text, opts) + lh * 3 > o.bottom) y = o.newPage();
    // na konci stránky aspoň dva řádky odstavce, jinak celý na další
    const full = doc.heightOfString(b.text, opts);
    if (!head && y + full > o.bottom && y + lh * 2 > o.bottom) y = o.newPage();
    const mark = (yy: number) => {
      if (b.kind === "point") doc.font("R").fontSize(fsz).fillColor(ink).text(b.num ?? "", x, yy, { width: indent - 2, lineBreak: false });
      if (b.kind === "bullet") doc.font("R").fontSize(fsz).fillColor(ink).text("–", x + indent, yy, { width: size, lineBreak: false });
    };
    let rest = b.text;
    let first = true;
    while (rest) {
      doc.font(font).fontSize(fsz);
      const h = doc.heightOfString(rest, opts);
      if (y + h <= o.bottom) {
        if (first) mark(y);
        doc.font(font).fontSize(fsz).fillColor(ink).text(rest, tx, y, opts);
        y += h;
        break;
      }
      const words = rest.split(" ");
      let lo = 0;
      let hi = words.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (y + doc.heightOfString(words.slice(0, mid).join(" "), opts) <= o.bottom) lo = mid;
        else hi = mid - 1;
      }
      // na další stránku aspoň dva řádky (bez „vdovy“)
      while (lo > 0 && doc.heightOfString(words.slice(lo).join(" "), opts) < lh * 1.9) lo = Math.max(0, lo - 4);
      if (lo > 0) {
        if (first) mark(y);
        doc.font(font).fontSize(fsz).fillColor(ink).text(words.slice(0, lo).join(" "), tx, y, { ...opts, align: "justify" });
        first = false;
      }
      rest = words.slice(lo).join(" ");
      y = o.newPage();
    }
  }
  return y;
}

/**
 * Dlouhý text (obchodní podmínky) jako PDF A4 na tolik stran, kolik je potřeba: nadpis, odstavce, řádky
 * „1. NÁZEV“ / velkými písmeny tučně. Pro přílohu smlouvy z portálu – sestava smlouvy má na znění jen jednu stranu.
 */
export async function renderTextPdf(title: string, text: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margins: { top: 56, bottom: 56, left: 56, right: 56 }, info: { Title: title, Producer: "Shanon" } });
  doc.registerFont("R", join(FONT_DIR, "DejaVuSans.ttf"));
  doc.registerFont("B", join(FONT_DIR, "DejaVuSans-Bold.ttf"));
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));
  const W = doc.page.width;
  const H = doc.page.height;
  let y = 56;
  if (title) {
    doc.font("B").fontSize(14).fillColor("#1f2a37").text(title, 56, y, { width: W - 112 });
    y = doc.y + 10;
  }
  drawRichText(doc, text, { x: 56, w: W - 112, size: 9, y0: y, bottom: H - 56, newPage: () => (doc.addPage(), 56) });
  doc.end();
  return done;
}
