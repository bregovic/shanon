/**
 * Objekty (obdoba tabulek + formulářů v AX).
 *
 * Jedna definice objektu je jediný zdroj pravdy pro:
 *  - databázovou tabulku (generátor `npm run schema:gen` → Prisma schéma)
 *  - API (seznam, detail, uložení, mazání — src/server/data.ts)
 *  - grid a formulář v adminu (src/components/object-*)
 *  - validaci (src/core/validate.ts)
 *  - izolaci tenantů (RLS — scripts/rls.ts)
 *
 * Systémová pole (id, tenantId, companyId, created*, updated*, version, ext)
 * se přidávají automaticky, v definici se neuvádějí.
 */
import type { Edt } from "./edt";
import type { LabelRef } from "./labels";

/**
 * tenant  — sdílené pro celého zákazníka (adresář subjektů, uživatelé)
 * company — patří jedné účetní jednotce / firmě (účty, doklady, daně)
 */
export type ObjectScope = "tenant" | "company";

export interface FieldDef {
  edt: Edt;
  /** přepíše label typu */
  label?: LabelRef;
  mandatory?: boolean;
  /** výchozí hodnota; u data "$today" = dnešní datum */
  default?: string | number | boolean;
  /** jen pro čtení ve formuláři (vyplňuje systém) */
  readOnly?: boolean;
  /**
   * odkaz do modulu, na kterém modul nezávisí (položka na řádku faktury):
   * bez zapnutého cílového modulu se pole v UI nezobrazuje
   */
  optionalRef?: boolean;
  /**
   * tajný údaj (heslo, API klíč, certifikát): v databázi šifrovaně, uživateli
   * se nevrací (jen maska), logika modulu ho čte přes revealSecret()
   */
  secret?: boolean;
  /**
   * obrázek: pole drží id souboru (DocuRef); formulář ukáže náhled, nahrání
   * tlačítkem i přetažením, grid miniaturu, import bere cestu k souboru
   */
  image?: boolean;
  /**
   * finanční dimenze č. 1–6: popisek = název dimenze tenanta, bez aktivní
   * dimenze se pole nezobrazuje (src/server/ui.ts)
   */
  dimSlot?: number;
  /** pole se ve formuláři ukáže jen při dané hodnotě jiného pole */
  visibleWhen?: VisibleWhen;
  /** další názvy sloupce při importu (CSV/XML), např. ["cena", "price"] */
  aliases?: string[];
}

export interface VisibleWhen {
  field: string;
  in: unknown[];
}

export interface FormGroup {
  label: LabelRef;
  fields: string[];
  /** skupina se ukáže jen při dané hodnotě pole (např. podle druhu napojení) */
  visibleWhen?: VisibleWhen;
}

export interface ObjectDef {
  /** "<modul>.<objekt>", např. "gab.subject" */
  id: string;
  /** název tabulky, konvence "<modul>_<objekt>" */
  table: string;
  label: LabelRef;
  labelPlural: LabelRef;
  scope: ObjectScope;
  fields: Record<string, FieldDef>;
  /** pole, které reprezentuje záznam (v odkazech, nadpisu formuláře) */
  titleField: string;
  /** sloupce gridu */
  list: string[];
  /** skupiny polí formuláře */
  form: FormGroup[];
  /** unikátní kombinace polí (v rámci tenanta/firmy) */
  unique?: string[][];
  defaultSort?: { field: string; dir: "asc" | "desc" };
  /** automatické číslování: pole se vyplní z číselné řady */
  numberSeq?: { field: string; seq: string };
  /** jen pro správce tenanta (role, oprávnění) — oprávnění v rolích na ně nestačí */
  adminOnly?: boolean;
  /** záznamy vytváří jen systém (např. účetní zápisy), v UI jen čtení */
  systemOnly?: boolean;
  /** podřízené řádky zobrazené ve formuláři (např. řádky dokladu) */
  /**
   * podřízené záznamy zobrazené ve formuláři. `owned: false` = jen přehled
   * (faktury odběratele) — se záznamem se nemažou, smazání pak zastaví vazba.
   */
  /** `copy: false` = řádky se při Duplikovat nekopírují (diskuze, historie) */
  lines?: { object: string; field: string; label: LabelRef; owned?: boolean; copy?: boolean }[];
  /** tlačítka ve formuláři; logika v ObjectHandlers.actions */
  /**
   * `upload` = akce si vyžádá soubor (přípony pro výběr, např. ".gpc,.txt");
   * `download` = akce vrátí soubor ke stažení (ObjectHandlers.downloads);
   * stačí právo číst, `downloadNeedsWrite` = stažení mění záznam (nový klíč)
   */
  actions?: { id: string; label: LabelRef; when?: { field: string; equals: unknown }; upload?: string; download?: boolean; downloadNeedsWrite?: boolean }[];
  /** záznam (i jeho řádky) nelze měnit ani mazat, když pole má danou hodnotu */
  lockedWhen?: { field: string; equals: unknown };
}

export const SYSTEM_FIELDS = [
  "id",
  "tenantId",
  "companyId",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
  "version",
  "ext",
] as const;

const ID_RE = /^[a-z][a-z0-9]*\.[a-z][a-zA-Z0-9]*$/;
const FIELD_RE = /^[a-z][a-zA-Z0-9]*$/;

export function defineObject(def: ObjectDef): ObjectDef {
  if (!ID_RE.test(def.id)) throw new Error(`Objekt ${def.id}: id musí být "modul.objekt"`);
  const names = Object.keys(def.fields);
  for (const n of names) {
    if (!FIELD_RE.test(n)) throw new Error(`Objekt ${def.id}: neplatný název pole "${n}"`);
    if ((SYSTEM_FIELDS as readonly string[]).includes(n))
      throw new Error(`Objekt ${def.id}: pole "${n}" je systémové`);
    if (def.fields[n].edt.kind === "ref" && !n.endsWith("Id"))
      throw new Error(`Objekt ${def.id}: odkaz "${n}" musí končit na "Id"`);
  }
  const known = new Set(names);
  const check = (f: string, where: string) => {
    if (!known.has(f)) throw new Error(`Objekt ${def.id}: ${where} odkazuje na neznámé pole "${f}"`);
  };
  check(def.titleField, "titleField");
  def.list.forEach((f) => check(f, "list"));
  def.form.forEach((g) => g.fields.forEach((f) => check(f, "form")));
  def.unique?.forEach((u) => u.forEach((f) => check(f, "unique")));
  if (def.numberSeq) check(def.numberSeq.field, "numberSeq");
  return def;
}

export const moduleOf = (objectId: string) => objectId.split(".")[0];

/** gab_subject → GabSubject (název Prisma modelu) */
export const modelName = (table: string) =>
  table
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");

/** gabSubject (název delegáta na Prisma klientovi) */
export const delegateName = (table: string) => {
  const m = modelName(table);
  return m.charAt(0).toLowerCase() + m.slice(1);
};

/** camelCase → snake_case (název sloupce) */
export const columnName = (field: string) => field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
