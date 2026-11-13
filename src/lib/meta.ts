/**
 * Popis polí pro UI a formátování hodnot — sdílí server i klientské komponenty.
 */
import type { FieldKind } from "@/core/edt";

type RecordData = Record<string, unknown>;

export interface FieldMeta {
  name: string;
  label: string;
  kind: FieldKind;
  mandatory: boolean;
  readOnly: boolean;
  maxLength?: number;
  align: "left" | "right" | "center";
  options?: { value: string; label: string; color?: string }[];
  refObject?: string;
  refHref?: string;
  /** cíl odkazu se otevírá v seznamu (číselník) — „Otevřít“ vede do přehledu s vybraným záznamem */
  refList?: boolean;
  /** číslo se nesčítá v řádku Celkem */
  noTotal?: boolean;
  /** pole rozšíření (hodnota v record.ext) */
  ext?: boolean;
  /** tajný údaj — zadává se, nezobrazuje */
  secret?: boolean;
  /** obrázek (hodnota = id souboru, /api/files/<id>) */
  image?: boolean;
  visibleWhen?: { field: string; in: unknown[] };
  /** mřížka řádků: sdílený sloupec vzájemně se vylučujících polí */
  gridColumn?: string;
}

export const objectHref = (objectId: string, id?: string) =>
  `/${objectId.replace(".", "/")}${id ? `/${id}` : ""}`;

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

/** Odkaz na odkazovaný záznam: číselník = seznam s vybraným řádkem, doklad = jeho stránka. */
export function refLink(f: Pick<FieldMeta, "refHref" | "refList">, id: string): string {
  return f.refList ? `${f.refHref}?focus=${encodeURIComponent(id)}` : `${f.refHref}/${id}`;
}
