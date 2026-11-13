/**
 * Reporty (obdoba Financial reports / SSRS sestav v AX): definice v modulu,
 * jedna obecná stránka /report/<modul>/<report> s parametry, výsledkem,
 * řádkem Celkem a exportem do Excelu. Výpočet jen přes DataApi — oprávnění
 * hlídá datová služba (`requires` = objekty, které uživatel musí smět číst).
 */
import type { DataApi, RecordData } from "./module";
import type { LabelRef } from "./labels";

export type ReportParamKind = "date" | "bool" | "dimension";

export interface ReportParam {
  name: string;
  label: LabelRef;
  kind: ReportParamKind;
  /** výchozí: "$monthStart", "$today", "$yearStart" nebo hodnota */
  default?: string | boolean;
}

export interface ReportColumn {
  name: string;
  label: LabelRef;
  kind: "string" | "amount";
  /** sloupec se sčítá v řádku Celkem */
  total?: boolean;
}

export interface ReportResult {
  columns: ReportColumn[];
  rows: RecordData[];
  /** mezisoučty / oddíly (zvýrazněné řádky) mají `_level` 1 */
}

export interface ReportDef {
  id: string;
  label: LabelRef;
  description?: LabelRef;
  /** objekty, které uživatel musí smět číst */
  requires: string[];
  params: ReportParam[];
  run(data: DataApi, params: RecordData, ctx: { companyId: string | null; t: (ref: LabelRef, p?: Record<string, string>) => string }): Promise<ReportResult>;
}

export function defineReport(def: ReportDef): ReportDef {
  return def;
}

/** Výchozí hodnoty parametrů ($today, $monthStart, $yearStart). */
export function defaultParams(def: ReportDef, today = new Date()): RecordData {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const map: Record<string, string> = {
    $today: iso(today),
    $monthStart: iso(new Date(Date.UTC(y, m, 1))),
    $yearStart: `${y}-01-01`,
  };
  return Object.fromEntries(def.params.map((p) => [p.name, typeof p.default === "string" && p.default in map ? map[p.default] : (p.default ?? null)]));
}
