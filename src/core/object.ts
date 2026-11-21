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
  /** odkaz ke sdílení: ve formuláři tlačítka Kopírovat a E-mail (předmět a text s {url}, {company}) */
  share?: { subject: LabelRef; body: LabelRef };
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
   * výběr v odkazu omezený hodnotou jiného pole formuláře: { pole cíle: pole formuláře }
   * (název deníku jen druhu deníku; prázdná hodnota = bez omezení)
   */
  lookupFilter?: Record<string, string>;
  /** nový záznam nabídne hodnotu, kterou uživatel naposledy uložil (SysLastValue v AX) */
  rememberLast?: boolean;
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
  /** mřížka řádků: pole se stejným sloupcem (vzájemně se vylučující přes visibleWhen) sdílí jeden sloupec */
  gridColumn?: string;
  /** pole patří funkci jiného modulu (položka „v e-shopu“): bez zapnutého modulu se v UI nezobrazuje */
  module?: string;
  /** nápověda pod polem ve formuláři (jak vyplnit, příklad) */
  help?: LabelRef;
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
  /** indexy pro časté dotazy (v rámci tenanta/firmy), např. [["assignedTo", "status"]] — odkazy mají index samy */
  indexes?: string[][];
  defaultSort?: { field: string; dir: "asc" | "desc" };
  /** Sloučit vybrané záznamy do jednoho (odkazy se přepojí, ostatní smažou) — `src/server/merge.ts`, úpravy v `ObjectHandlers.merge` */
  mergeable?: boolean;
  /** automatické číslování: pole se vyplní z číselné řady */
  numberSeq?: { field: string; seq: string };
  /** jen pro správce tenanta (role, oprávnění) — oprávnění v rolích na ně nestačí */
  adminOnly?: boolean;
  /** záznamy vytváří jen systém (např. účetní zápisy), v UI jen čtení */
  systemOnly?: boolean;
  /** systémový záznam smí uživatel opravit (pole, která nejsou readOnly) — nezaloží ani nesmaže (daňové transakce) */
  userCorrect?: boolean;
  /** parametry modulu: nová firma je při zapnutí modulu převezme ze Společných dat (DAT), `src/server/dat.ts` */
  datTemplate?: boolean;
  /**
   * běžný číselník Společných dat (DAT): firmy mají kopie, nový záznam v DAT se doplní, změna se propíše do
   * neupravených kopií (`src/server/dat.ts`); objekt musí mít pole `DAT_FIELDS` (src/core/dat-fields.ts)
   */
  datLayer?: boolean;
  /** podřízené řádky zobrazené ve formuláři (např. řádky dokladu) */
  /**
   * podřízené záznamy zobrazené ve formuláři. `owned: false` = jen přehled
   * (faktury odběratele) — se záznamem se nemažou, smazání pak zastaví vazba.
   */
  /** `copy: false` = řádky se při Duplikovat nekopírují (diskuze, historie) */
  /** `inline` = řádky se upravují přímo v mřížce (deník, řádky dokladu) */
  lines?: {
    object: string;
    field: string;
    label: LabelRef;
    owned?: boolean;
    copy?: boolean;
    inline?: boolean;
    /** nový řádek v mřížce: pole řádku ← pole hlavičky (datum řádku = datum deníku) */
    inherit?: Record<string, string>;
    /** nový řádek v mřížce převezme tato pole z předchozího řádku (jako v AX) */
    carry?: string[];
    /** vyrovnanost skupin řádků (doklad deníku): rozdíl MD − D po skupinách, dorovnání nového řádku */
    /** selfBalanced = pole, jejichž vyplnění dělá řádek vyrovnaným samo (protiúčet) */
    balance?: { group: string; debit: string; credit: string; selfBalanced?: string | string[]; /** pole, o které řádek mění vyrovnanost navíc (přičtené DPH) */ extra?: string };
    /** podrobnosti vybraného řádku pod mřížkou (záložky s poli, která se do mřížky nevejdou) */
    /** záložky podrobností řádku; `sections` = dílčí oddíly záložky (fields = všechna pole záložky) */
    details?: { label: LabelRef; fields: string[]; sections?: { label: LabelRef; fields: string[] }[] }[];
    /**
     * dimenze účtu a protiúčtu (pole <main>1…6 a <offset>1…6) + dialog pro jejich zadání;
     * `account` / `offsetAccount` = pole účtu (relevantní dimenze), `offsetType` = je-li protiúčet
     */
    dims?: { main: string; offset: string; account: string; offsetAccount: string; offsetType?: string };
  }[];
  /**
   * související doklady (faktury a zálohy objednávky): tlačítko v horní liště
   * s počtem, otevře jejich seznam s filtrem; bez záznamů je neaktivní.
   * `ref` = párovat podle odkazu záznamu (voucherId → zápisy HK a DPH dokladu),
   * jinak podle id záznamu
   */
  related?: { object: string; field: string; label: LabelRef; ref?: string }[];
  /** stránka dokladu: hlavička jako jeden řádek nahoře, řádky přes celou stránku */
  compactHeader?: boolean;
  /** uložený záznam s řádky (i neupravitelnými v mřížce) má hlavičku sbalenou — rovnou řádky */
  collapseHeader?: boolean;
  /**
   * netransakční číselník (adresář, účty, položky…), který mohou firmy sdílet
   * ve virtuální společnosti (Správa systému → Virtuální společnosti)
   */
  shareable?: boolean;
  /**
   * odkaz, jehož titulek se připojí k titulku záznamu („DOD00001 · Masna Novák“)
   * a podle něhož jde záznam hledat (odběratel / dodavatel → subjekt adresáře)
   */
  titleRef?: string;
  /** tlačítka ve formuláři; logika v ObjectHandlers.actions */
  /**
   * `upload` = akce si vyžádá soubor (přípony pro výběr, např. ".gpc,.txt");
   * `download` = akce vrátí soubor ke stažení (ObjectHandlers.downloads);
   * stačí právo číst, `downloadNeedsWrite` = stažení mění záznam (nový klíč);
   * `module` = akce jen se zapnutým modulem (Vytvořit dodavatele → ap);
   * `outside` = akce volá síť a běží mimo transakci (obsluha v `src/server/outside.ts`);
   * `bulk` = akce i nad víc vybranými záznamy v seznamu
   */
  /**
   * akce v liště formuláře; `group` = kam patří (standard pro všechny formuláře):
   * process = tlačítko v liště (Zaúčtovat, Potvrdit…), print = nabídka Tisk (soubory, e-mail),
   * inquiry = nabídka Zobrazit, more = nabídka Další. Výchozí: soubor ke stažení → print, jinak process.
   */
  actions?: { id: string; label: LabelRef; /** ikona tlačítka (`ActionIcon`); bez ní podle druhu akce */ icon?: ActionIcon; /** před spuštěním dialog se zadáním hodnoty (obsluha ji dostane jako `input[name]`) */ input?: { name: string; label: LabelRef; kind: "date" }; when?: { field: string; equals: unknown }; upload?: string; download?: boolean; downloadNeedsWrite?: boolean; module?: string; outside?: boolean; bulk?: boolean; group?: ActionGroup; /** jen superuživatel (oprava zaúčtovaného dokladu) */ adminOnly?: boolean; /** po akci v detailu otevřít další záznam ve frontě (pole ∈ hodnoty, podle čísla) */ next?: { field: string; in: string[] }; /** nevratná akce: uživatel musí opsat hodnotu pole (kód firmy) */ confirm?: { field: string; text: LabelRef } }[];
  /** akce, kterou jde spustit nanečisto a ukázat vzniklé účetní zápisy a DPH (Náhled dokladu) */
  postingPreview?: string;
  /** záznam (i jeho řádky) nelze měnit ani mazat, když pole má danou hodnotu */
  lockedWhen?: { field: string; equals: unknown };
}

/** ikony tlačítek akcí (mapování na ikony Fluentu v `src/components/action-icon.tsx`) */
export type ActionIcon = "post" | "unpost" | "approve" | "reject" | "send" | "list" | "scan" | "check" | "partner" | "cancel" | "done" | "open" | "refresh" | "calc" | "money" | "link" | "key" | "test" | "copy" | "stock" | "upload" | "print" | "mail" | "run";

/** skupiny akcí v liště formuláře */
export type ActionGroup = "process" | "print" | "inquiry" | "more";

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
  def.indexes?.forEach((u) => u.forEach((f) => check(f, "indexes")));
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
