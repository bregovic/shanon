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
  columns?: PrintColumn[];
  style?: { size?: number; bold?: boolean; italic?: boolean; align?: "left" | "center" | "right"; color?: string; border?: boolean; fill?: string };
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
