/**
 * Labely — jediný zdroj textů v rozhraní (obdoba @SYS labelů v AX).
 *
 * Label se odkazuje jako "@MODUL:Klic", např. "@GAB:Subject".
 * Moduly dodávají své labely ve všech jazycích; tenant si je může přepsat
 * (sys_label_override). Text, který nezačíná "@", se bere doslova.
 */

export type Lang = "cs" | "en";
export const LANGS: Lang[] = ["cs", "en"];
export const DEFAULT_LANG: Lang = "cs";

/** Odkaz na label ("@GAB:Subject") nebo doslovný text. */
export type LabelRef = string;

/** Labely jednoho modulu: { cs: { Subject: "Subjekt" }, en: { Subject: "Party" } } */
export type LabelFile = Record<Lang, Record<string, string>>;

export type LabelTable = Map<string, string>; // klíč "cs|@GAB:Subject"

const key = (lang: Lang, ref: string) => `${lang}|${ref}`;

export function buildLabelTable(files: { prefix: string; labels: LabelFile }[]): LabelTable {
  const table: LabelTable = new Map();
  for (const { prefix, labels } of files) {
    for (const lang of LANGS) {
      for (const [k, text] of Object.entries(labels[lang] ?? {})) {
        table.set(key(lang, `@${prefix}:${k}`), text);
      }
    }
  }
  return table;
}

/** Přeloží label. Nenalezený label vrátí jako "@GAB:Xyz", aby chyba byla vidět. */
export function resolveLabel(
  table: LabelTable,
  ref: LabelRef | undefined,
  lang: Lang,
  overrides?: LabelTable,
): string {
  if (!ref) return "";
  if (!ref.startsWith("@")) return ref;
  return (
    overrides?.get(key(lang, ref)) ??
    table.get(key(lang, ref)) ??
    (lang !== DEFAULT_LANG ? table.get(key(DEFAULT_LANG, ref)) : undefined) ??
    ref
  );
}

/** Doplní parametry "{name}" do přeloženého textu. */
export function fillLabel(text: string, params: Record<string, string> = {}): string {
  return text.replace(/\{(\w+)\}/g, (m, k) => params[k] ?? m);
}

/** Kontrola úplnosti: vrátí labely, které chybí v některém jazyce. */
export function missingLabels(files: { prefix: string; labels: LabelFile }[]): string[] {
  const missing: string[] = [];
  for (const { prefix, labels } of files) {
    const all = new Set(LANGS.flatMap((l) => Object.keys(labels[l] ?? {})));
    for (const k of all) {
      for (const lang of LANGS) {
        if (!(k in (labels[lang] ?? {}))) missing.push(`${lang} @${prefix}:${k}`);
      }
    }
  }
  return missing;
}
