/**
 * Tiskové sestavy: šablona = rozvržení prvků na stránce (v milimetrech),
 * data = sada hodnot dokladu (`PrintData`). Moduly deklarují tisknutelné
 * doklady (`ModuleDef.printables`): odkud se berou data a jaká pole nabídnout
 * v návrháři. Vykresluje `src/lib/print-render.tsx` (náhled, tisk, kasa).
 */
import type { DataApi } from "./module";
import type { LabelRef } from "./labels";

export type PaperKind = "a4" | "a5" | "receipt80" | "receipt58" | "label";

/** Rozměry papíru v mm (výška 0 = podle obsahu, účtenka). */
export const PAPERS: Record<PaperKind, { w: number; h: number }> = {
  a4: { w: 210, h: 297 },
  a5: { w: 148, h: 210 },
  receipt80: { w: 72, h: 0 },
  receipt58: { w: 48, h: 0 },
  label: { w: 100, h: 60 },
};

export type ValueFormat = "text" | "money" | "date" | "qty" | "percent";

export interface PrintColumn {
  /** pole řádku (např. "description", "qty") */
  field: string;
  label: string;
  width: number;
  align?: "left" | "right" | "center";
  format?: ValueFormat;
}

export interface PrintElement {
  id: string;
  /** text = statický text s vloženými poli {doc.number} / {doc.gross:money} */
  type: "text" | "table" | "vat" | "qr" | "image" | "line" | "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  /** zdroj QR (výchozí "qr" = QR platba) */
  field?: string;
  /** obrázek jako data: URL (logo) */
  src?: string;
  /** prvek se vytiskne jen, když pole (cesta) má hodnotu — např. kód EET */
  showIf?: string;
  columns?: PrintColumn[];
  style?: { size?: number; bold?: boolean; italic?: boolean; align?: "left" | "center" | "right"; color?: string; border?: boolean; fill?: string; /** tabulka: svislý okraj buňky v mm (výchozí 0,6) */ rowPad?: number };
}

export interface PrintLayout {
  paper: PaperKind;
  /** výchozí písmo v bodech */
  fontSize: number;
  elements: PrintElement[];
}

export type PrintData = Record<string, unknown>;

export interface PrintField {
  path: string;
  label: LabelRef;
  format?: ValueFormat;
}

export interface PrintableDef {
  /** druh dokladu = id objektu (ar.invoice, pos.receipt) */
  id: string;
  label: LabelRef;
  defaultPaper: PaperKind;
  /** pole pro vkládání do textu: firma, doklad, partner */
  fields: PrintField[];
  /** pole řádku pro sloupce tabulky */
  lineFields: PrintField[];
  /** pole čísla dokladu (výběr v náhledu) */
  numberField: string;
  dataset(data: DataApi, companyId: string | null, id: string): Promise<PrintData>;
  /** výchozí šablona (zakládá výchozí nastavení) */
  defaultLayout: () => PrintLayout;
  /** dřívější výchozí rozvržení — neupravené šablony v této podobě se převedou na nové */
  legacyLayouts?: PrintLayout[];
  /** role, na kterou se doklad tiskne (tiskárna pokladny) — šablona navržená na jinou roli se přeskládá */
  rollPaper?: (data: DataApi, companyId: string | null, id: string) => Promise<PaperKind | null>;
  /** Tisk v seznamu / detailu tiskne rovnou (bez náhledu) — účtenka do účtenkové tiskárny */
  directPrint?: boolean;
  /** soubory vložené do PDF (ISDOC u faktury) */
  attachments?: (data: DataApi, companyId: string | null, id: string) => Promise<{ name: string; mime: string; data: string | Buffer }[]>;
}

/**
 * Šablona účtenky navržená na jinou roli (výchozí je 80 mm) přeskládaná na roli tiskárny.
 * Rozměry se přepočtou poměrem šířek, písmo méně (na 58 mm by poměrem bylo nečitelné) — účtenka
 * se skládá pod sebe podle obsahu, takže delší řádek se zalomí a nic se nepřekryje.
 * Bez toho prohlížeč 72 mm širokou účtenku na 48 mm roli zmenší, posune a kraj ořízne (XP-58).
 */
export function fitRoll(layout: PrintLayout, target: PaperKind | null | undefined): PrintLayout {
  const src = PAPERS[layout.paper], dst = target ? PAPERS[target] : undefined;
  if (!src || !dst || src.h || dst.h || src.w === dst.w) return layout;
  const k = dst.w / src.w;
  const f = k < 1 ? Math.min(1, k + (1 - k) * 0.55) : 1;
  const mm = (v: number) => Math.round(v * k * 100) / 100;
  // nejmenší písmo 6 bodů — menší termotisk na 203 dpi slévá
  const pt = (v: number | undefined) => (v === undefined ? v : Math.max(Math.min(v, 6), Math.round(v * f * 10) / 10));
  return {
    ...layout,
    paper: target!,
    fontSize: pt(layout.fontSize) ?? layout.fontSize,
    elements: layout.elements.map((e) => ({
      ...e,
      x: mm(e.x),
      y: mm(e.y),
      w: mm(e.w),
      h: mm(e.h),
      ...(e.columns ? { columns: fitColumns(e.columns, mm(e.w), k) } : {}),
      ...(e.style ? { style: { ...e.style, size: pt(e.style.size) } } : {}),
    })),
  };
}

/**
 * Sloupce tabulky na užší roli: čísla a krátké údaje (MJ, sazba) se zúží méně než poměrem — jinak se „kg“
 * nebo „12“ zlomí na dva řádky; zbytek dostane první textový sloupec (název položky se klidně zalomí).
 * Tabulka, která textem nezačíná (rekapitulace DPH), se zúží poměrem.
 */
function fitColumns(cols: PrintColumn[], width: number, k: number): PrintColumn[] {
  const scaled = cols.map((c) => ({ ...c, width: Math.round(c.width * k * 100) / 100 }));
  const first = cols[0];
  if (k >= 1 || !first || first.align === "right" || first.format === "money" || first.format === "qty") return scaled;
  const rest = scaled.slice(1).map((c, i) => ({ ...c, width: Math.round(Math.max(c.width, cols[i + 1].width * 0.8) * 100) / 100 }));
  const left = Math.round((width - rest.reduce((a, c) => a + c.width, 0)) * 100) / 100;
  return left >= first.width * k * 0.6 ? [{ ...scaled[0], width: left }, ...rest] : scaled;
}

/** Hodnota podle cesty "doc.number" / "company.name". */
export function valueAt(data: PrintData, path: string): unknown {
  let v: unknown = data;
  for (const k of path.split(".")) {
    if (v === null || v === undefined || typeof v !== "object") return undefined;
    v = (v as Record<string, unknown>)[k];
  }
  return v;
}

/** České číslo účtu (předčíslí-číslo/banka) → IBAN. */
export function czIban(account: string | null | undefined): string | null {
  const m = /^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/.exec(String(account ?? "").replace(/\s/g, ""));
  if (!m) return null;
  const bban = `${m[3]}${(m[1] ?? "").padStart(6, "0")}${m[2].padStart(10, "0")}`;
  // kontrolní číslice: (BBAN + "CZ00" převedené na čísla) mod 97
  const num = `${bban}123500`;
  let rem = 0;
  for (const ch of num) rem = (rem * 10 + Number(ch)) % 97;
  return `CZ${String(98 - rem).padStart(2, "0")}${bban}`;
}

/** Řetězec QR platby (SPAYD) pro bankovní aplikace. */
export function spayd(p: { iban: string; amount: string | number; currency?: string; vs?: string | null; date?: string | null; message?: string | null }): string {
  const clean = (s: string) => s.replace(/\*/g, " ").slice(0, 60);
  const parts = [`SPD*1.0*ACC:${p.iban.replace(/\s/g, "")}`, `AM:${Number(p.amount).toFixed(2)}`, `CC:${p.currency ?? "CZK"}`];
  if (p.vs) parts.push(`X-VS:${String(p.vs).replace(/\D/g, "").slice(0, 10)}`);
  if (p.date) parts.push(`DT:${p.date.replace(/-/g, "")}`);
  if (p.message) parts.push(`MSG:${clean(p.message)}`);
  return parts.join("*");
}
