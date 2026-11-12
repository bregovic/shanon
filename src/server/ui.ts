/**
 * Převod definic objektů na popis pro UI (serializovatelný pro klientské komponenty).
 */
import "server-only";
import type { FieldKind } from "@/core/edt";
import type { RecordData } from "@/core/module";
import type { FieldDef, ObjectDef } from "@/core/object";
import { registry } from "@/registry";
import type { Ctx } from "./data";
import { extFields } from "./data";
import type { T } from "./i18n";

export interface FieldMeta {
  name: string;
  label: string;
  kind: FieldKind;
  mandatory: boolean;
  readOnly: boolean;
  maxLength?: number;
  align: "left" | "right";
  options?: { value: string; label: string }[];
  refObject?: string;
  refHref?: string;
  /** pole rozšíření (hodnota v record.ext) */
  ext?: boolean;
}

export const objectHref = (objectId: string, id?: string) =>
  `/${objectId.replace(".", "/")}${id ? `/${id}` : ""}`;

function meta(name: string, f: FieldDef, t: T, ext = false): FieldMeta {
  const e = f.edt;
  return {
    name,
    label: t(f.label ?? e.label),
    kind: e.kind,
    mandatory: !!f.mandatory,
    readOnly: !!f.readOnly,
    maxLength: e.maxLength,
    align: e.align ?? (e.kind === "int" || e.kind === "decimal" ? "right" : "left"),
    options: e.enumId
      ? registry.enums.get(e.enumId)!.values.map((v) => ({ value: v.value, label: t(v.label) }))
      : undefined,
    refObject: e.refObject,
    refHref: e.refObject ? objectHref(e.refObject) : undefined,
    ext,
  };
}

export function fieldsMeta(ctx: Ctx, def: ObjectDef, t: T): Record<string, FieldMeta> {
  const out: Record<string, FieldMeta> = {};
  for (const [n, f] of Object.entries(def.fields)) out[n] = meta(n, f, t);
  for (const [n, f] of Object.entries(extFields(ctx, def.id))) out[n] = meta(n, f, t, true);
  return out;
}

/** Hodnota pro zobrazení v gridu. */
export function displayValue(f: FieldMeta, row: RecordData, lang: string): string {
  const v = f.ext ? (row.ext as RecordData | undefined)?.[f.name] : row[f.name];
  if (v === null || v === undefined || v === "") return "";
  const locale = lang === "cs" ? "cs-CZ" : "en-GB";
  switch (f.kind) {
    case "decimal":
      return Number(v).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    case "int":
      return Number(v).toLocaleString(locale);
    case "bool":
      return v ? "✓" : "";
    case "date":
      return new Date(`${v}T00:00:00Z`).toLocaleDateString(locale, { timeZone: "UTC" });
    case "datetime":
      return new Date(String(v)).toLocaleString(locale);
    case "enum":
      return f.options?.find((o) => o.value === v)?.label ?? String(v);
    case "ref":
      return String((row._titles as RecordData | undefined)?.[f.name] ?? "");
    default:
      return String(v);
  }
}
