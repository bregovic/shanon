/**
 * Vykreslení tiskové sestavy (šablona + data) do HTML — stejné pro náhled
 * v návrháři, tiskovou stránku i účtenku v kase. Rozměry v mm.
 *
 * Stránkování: prvky nad tabulkou řádků tvoří hlavičku, tabulka teče
 * (prohlížeč ji rozdělí na stránky a zopakuje záhlaví), prvky pod tabulkou
 * se posunou o skutečnou výšku tabulky.
 */
import QRCode from "qrcode";
import { PAPERS, valueAt, type PrintData, type PrintElement, type PrintLayout, type ValueFormat } from "@/core/print";

export function formatValue(v: unknown, f: ValueFormat | undefined, locale: string): string {
  if (v === null || v === undefined || v === "") return "";
  switch (f) {
    case "money":
      return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v));
    case "qty":
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(Number(v));
    case "percent":
      return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(Number(v))} %`;
    case "date": {
      const s = String(v);
      const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(s);
      return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(locale);
    }
    default:
      return String(v);
  }
}

/** Text s vloženými poli: „Faktura {doc.number}“, „{doc.gross:money} Kč“. */
export function fillText(text: string, data: PrintData, locale: string): string {
  return text.replace(/\{([a-zA-Z0-9_.]+)(?::(\w+))?\}/g, (_, path: string, f?: string) => formatValue(valueAt(data, path), f as ValueFormat, locale));
}

/** QR kód jako SVG cesta (synchronně, bez canvasu). */
function QrSvg({ text, size }: { text: string; size: number }) {
  if (!text) return null;
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  let d = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.get(y, x)) d += `M${x} ${y}h1v1h-1z`;
  return (
    <svg viewBox={`-2 -2 ${n + 4} ${n + 4}`} width={`${size}mm`} height={`${size}mm`} shapeRendering="crispEdges">
      <rect x={-2} y={-2} width={n + 4} height={n + 4} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

const pt = (n?: number) => (n ? `${n}pt` : undefined);

function Table({ el, rows, locale, fontSize }: { el: PrintElement; rows: Record<string, unknown>[]; locale: string; fontSize: number }) {
  const cols = el.columns ?? [];
  const size = pt(el.style?.size ?? fontSize - 1);
  return (
    <table style={{ width: `${el.w}mm`, borderCollapse: "collapse", fontSize: size, tableLayout: "fixed" }}>
      <colgroup>
        {cols.map((c, i) => (
          <col key={i} style={{ width: `${c.width}mm` }} />
        ))}
      </colgroup>
      <thead style={{ display: "table-header-group" }}>
        <tr>
          {cols.map((c, i) => (
            <th key={i} style={{ textAlign: c.align ?? "left", borderBottom: "0.3mm solid #000", padding: "0.8mm 1mm", fontWeight: 700 }}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} style={{ breakInside: "avoid" }}>
            {cols.map((c, i) => (
              <td key={i} style={{ textAlign: c.align ?? "left", padding: "0.6mm 1mm", borderBottom: "0.1mm solid #ccc", verticalAlign: "top", overflowWrap: "anywhere" }}>
                {formatValue(r[c.field], c.format, locale)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Jeden prvek na absolutní pozici (mimo tabulku řádků). */
export function ElementView({ el, data, locale, fontSize, designMode = false }: { el: PrintElement; data: PrintData; locale: string; fontSize: number; designMode?: boolean }) {
  const s = el.style ?? {};
  const box: React.CSSProperties = {
    position: "absolute",
    left: `${el.x}mm`,
    top: `${el.y}mm`,
    width: `${el.w}mm`,
    height: el.type === "table" || el.type === "vat" ? undefined : `${el.h}mm`,
    fontSize: pt(s.size ?? fontSize),
    fontWeight: s.bold ? 700 : 400,
    fontStyle: s.italic ? "italic" : undefined,
    textAlign: s.align ?? "left",
    color: s.color,
    background: s.fill,
    border: s.border || el.type === "rect" ? "0.3mm solid #000" : undefined,
    boxSizing: "border-box",
    overflow: designMode ? "hidden" : "visible",
    whiteSpace: "pre-wrap",
    lineHeight: 1.25,
  };
  switch (el.type) {
    case "text":
      return <div style={box}>{fillText(el.text ?? "", data, locale)}</div>;
    case "line":
      return <div style={{ ...box, height: 0, borderTop: "0.3mm solid #000", border: undefined }} />;
    case "rect":
      return <div style={box} />;
    case "image":
      // eslint-disable-next-line @next/next/no-img-element
      return el.src ? <img alt="" src={el.src} style={{ ...box, objectFit: "contain" }} /> : <div style={{ ...box, border: designMode ? "0.2mm dashed #999" : undefined }} />;
    case "qr": {
      const text = String(valueAt(data, el.field || "qr") ?? "");
      return <div style={box}>{text ? <QrSvg text={text} size={Math.min(el.w, el.h)} /> : designMode ? "QR" : null}</div>;
    }
    case "table":
    case "vat": {
      const rows = (valueAt(data, el.type === "vat" ? "vat" : "lines") as Record<string, unknown>[]) ?? [];
      return (
        <div style={{ ...box, height: designMode ? `${el.h}mm` : undefined, overflow: designMode ? "hidden" : "visible" }}>
          <Table el={el} rows={designMode ? rows.slice(0, 50) : rows} locale={locale} fontSize={fontSize} />
        </div>
      );
    }
  }
}

/** Celý doklad: hlavička (absolutně), tabulka řádků (teče), zbytek pod ní. */
export function PrintDocument({ layout, data, locale = "cs-CZ" }: { layout: PrintLayout; data: PrintData; locale?: string }) {
  const paper = PAPERS[layout.paper] ?? PAPERS.a4;
  const table = layout.elements.find((e) => e.type === "table");
  const page: React.CSSProperties = { width: `${paper.w}mm`, position: "relative", fontFamily: "Arial, Helvetica, sans-serif", color: "#000", background: "#fff" };
  const fs = layout.fontSize || 9;
  if (!table) {
    const h = paper.h || Math.max(20, ...layout.elements.map((e) => e.y + e.h)) + 2;
    return (
      <div className="print-page" style={{ ...page, height: `${h}mm` }}>
        {layout.elements.map((el) => (
          <ElementView key={el.id} el={el} data={data} locale={locale} fontSize={fs} />
        ))}
      </div>
    );
  }
  const top = table.y;
  const bottom = table.y + table.h;
  // nad začátkem tabulky = hlavička; ostatní se posunou o skutečnou výšku tabulky
  const head = layout.elements.filter((e) => e !== table && e.y < top);
  const rest = layout.elements.filter((e) => e !== table && e.y >= top);
  const restH = Math.max(0, ...rest.map((e) => e.y - bottom + e.h));
  const rows = (valueAt(data, "lines") as Record<string, unknown>[]) ?? [];
  return (
    <div className="print-page" style={page}>
      <div style={{ position: "relative", height: `${top}mm` }}>
        {head.map((el) => (
          <ElementView key={el.id} el={el} data={data} locale={locale} fontSize={fs} />
        ))}
      </div>
      <div style={{ marginLeft: `${table.x}mm` }}>
        <Table el={table} rows={rows} locale={locale} fontSize={fs} />
      </div>
      <div style={{ position: "relative", height: `${restH + 2}mm`, breakInside: "avoid" }}>
        {rest.map((el) => (
          <ElementView key={el.id} el={{ ...el, y: el.y - bottom }} data={data} locale={locale} fontSize={fs} />
        ))}
      </div>
    </div>
  );
}

/** CSS pro tisk: velikost papíru, bez okrajů prohlížeče. */
export function printCss(layout: PrintLayout): string {
  const p = PAPERS[layout.paper] ?? PAPERS.a4;
  const size = p.h ? `${p.w}mm ${p.h}mm` : `${layout.paper === "receipt58" ? 58 : 80}mm auto`;
  return `@page { size: ${size}; margin: ${p.h ? "0" : "0 4mm"}; } @media print { body { margin: 0 !important; background: #fff !important; } .no-print { display: none !important; } }`;
}
