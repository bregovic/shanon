/**
 * Moduly a rozšíření (obdoba konfiguračních klíčů a vrstev v AX / extensions v D365).
 *
 * Modul    = část core (Adresář, Hlavní kniha, DPH…). Tenant si zapíná jen ty,
 *            které potřebuje; závislosti se zapnou s ním.
 * Rozšíření = úprava mimo core. Přidává pole (ukládají se do sloupce `ext`,
 *            core se nemění), labely a obsluhu událostí. Rozšíření je buď
 *            soukromé pro jednoho tenanta, nebo veřejné — ostatní tenanti si ho
 *            mohou zapnout. Core na rozšířeních nikdy nezávisí.
 */
import type { EnumDef } from "./edt";
import type { LabelFile, LabelRef } from "./labels";
import type { FieldDef, ObjectDef } from "./object";
import { moduleOf } from "./object";

export interface MenuItem {
  object?: string;
  href?: string;
  label?: LabelRef;
}

export interface MenuGroup {
  label: LabelRef;
  items: MenuItem[];
}

export interface ModuleDef {
  id: string;
  label: LabelRef;
  description: LabelRef;
  /** název ikony z @fluentui/react-icons bez velikosti, např. "BuildingBank" */
  icon: string;
  /** vždy zapnutý (systém) */
  core?: boolean;
  dependsOn: string[];
  labels: LabelFile;
  enums?: EnumDef[];
  objects: ObjectDef[];
  menu: MenuGroup[];
  /**
   * Výchozí číselné řady modulu. „Výchozí nastavení“ je založí ve firmě,
   * pokud řada s tímto kódem chybí; tenant si je pak upraví.
   */
  numberSeqs?: { code: string; name: LabelRef; format: string; usedFor?: string }[];
  /**
   * Další výchozí nastavení firmy (účtový rozvrh, názvy deníků…). Musí být
   * idempotentní — zakládá jen to, co chybí, nic nepřepisuje.
   */
  setup?: (data: DataApi) => Promise<void>;
}

export function defineModule(def: ModuleDef): ModuleDef {
  for (const o of def.objects) {
    if (moduleOf(o.id) !== def.id) throw new Error(`Objekt ${o.id} nepatří do modulu ${def.id}`);
  }
  return def;
}

// ---------------------------------------------------------------------------
// Události — jediný způsob, jak rozšíření mění chování objektů core
// ---------------------------------------------------------------------------

export type RecordData = Record<string, unknown>;

/**
 * Přístup k datům pro byznys logiku. Moduly i rozšíření pracují jen přes
 * tohle rozhraní (ne přímo s databází) — vždy v rámci tenanta a firmy
 * a v transakci aktuální operace.
 */
export interface DataApi {
  /** aktuální firma (null u objektů tenanta) */
  companyId?: string | null;
  get(objectId: string, id: string): Promise<RecordData | null>;
  /** přesná shoda, nebo rozsah { gte, lte, gt, lt } (data, čísla) */
  find(objectId: string, where: RecordData, opts?: { take?: number; orderBy?: Record<string, "asc" | "desc"> }): Promise<RecordData[]>;
  create(objectId: string, data: RecordData): Promise<RecordData>;
  update(objectId: string, id: string, data: RecordData): Promise<RecordData>;
  /**
   * Další číslo z číselné řady firmy: podle kódu řady, id řady, nebo podle
   * objektu, pro který je řada určená (pole Použití).
   */
  nextNumber(seq: string | { id?: string; usedFor?: string; code?: string }, date?: Date): Promise<string>;
}

export interface EventContext {
  tenantId: string;
  companyId: string | null;
  userId: string;
  objectId: string;
  data: DataApi;
  /** překlad labelu do jazyka uživatele (texty do souborů, varování) */
  t: (ref: LabelRef, params?: Record<string, string>) => string;
}

export type ValidationErrors = Record<string, LabelRef>;

/** Soubor ke stažení z akce. */
export interface DownloadFile {
  name: string;
  mime: string;
  data: Buffer | string;
}

/** Soubor nahraný k akci (import výpisu apod.). */
export interface ActionFile {
  name: string;
  data: Buffer;
}

/** Chyba pro uživatele — text je label. */
export class UserError extends Error {
  constructor(
    public label: LabelRef,
    public params: Record<string, string> = {},
    public fields?: ValidationErrors,
  ) {
    super(label);
  }
}

export interface ObjectHandlers {
  /** může upravit data (dopočet polí) nebo vrátit chyby */
  beforeSave?: (ctx: EventContext, data: RecordData, isNew: boolean) => void | ValidationErrors | Promise<void | ValidationErrors>;
  afterSave?: (ctx: EventContext, data: RecordData, isNew: boolean) => void | Promise<void>;
  /** vrátí label chyby, pokud mazání nelze povolit */
  beforeDelete?: (ctx: EventContext, data: RecordData) => void | LabelRef | Promise<void | LabelRef>;
  /** po smazání (např. přepočet součtů hlavičky dokladu) */
  afterDelete?: (ctx: EventContext, data: RecordData) => void | Promise<void>;
  /** akce nad záznamem (tlačítka ve formuláři), klíč = id akce z ObjectDef.actions */
  actions?: Record<string, (ctx: EventContext, record: RecordData, file?: ActionFile) => Promise<void>>;
  /** akce, které vrací soubor ke stažení (XML pro úřad, PDF…); klíč = id akce */
  downloads?: Record<string, (ctx: EventContext, record: RecordData) => Promise<DownloadFile>>;
}

export interface ExtensionDef {
  id: string;
  label: LabelRef;
  description: LabelRef;
  /** "public" = ostatní tenanti si ho mohou zapnout; jinak jen vlastník */
  visibility: "public" | "private";
  /** id tenanta, který rozšíření vlastní (u veřejných autor) */
  owner: string;
  dependsOn: string[];
  /** prefix labelů rozšíření, např. "XRATING" → "@XRATING:Rating"; začíná X */
  labelPrefix: string;
  labels: LabelFile;
  /** pole navíc na objektech core — ukládají se do `ext` */
  fields?: Record<string, Record<string, FieldDef>>;
  handlers?: Record<string, ObjectHandlers>;
}

export function defineExtension(def: ExtensionDef): ExtensionDef {
  if (!/^[a-z][a-z0-9-]*$/.test(def.id)) throw new Error(`Rozšíření ${def.id}: neplatné id`);
  if (!/^X[A-Z0-9]+$/.test(def.labelPrefix))
    throw new Error(`Rozšíření ${def.id}: prefix labelů musí začínat X (core labely nelze přepsat)`);
  return def;
}

// ---------------------------------------------------------------------------
// Registr
// ---------------------------------------------------------------------------

export interface Registry {
  modules: Map<string, ModuleDef>;
  objects: Map<string, ObjectDef>;
  enums: Map<string, EnumDef>;
  extensions: Map<string, ExtensionDef>;
  /** core moduly obsluhují vlastní logiku přes stejné události jako rozšíření */
  coreHandlers: Map<string, ObjectHandlers[]>;
}

export function buildRegistry(
  modules: ModuleDef[],
  extensions: ExtensionDef[] = [],
  coreHandlers: Record<string, ObjectHandlers>[] = [],
): Registry {
  const reg: Registry = {
    modules: new Map(),
    objects: new Map(),
    enums: new Map(),
    extensions: new Map(),
    coreHandlers: new Map(),
  };
  for (const m of modules) {
    if (reg.modules.has(m.id)) throw new Error(`Modul ${m.id} je registrován dvakrát`);
    reg.modules.set(m.id, m);
    for (const e of m.enums ?? []) reg.enums.set(e.id, e);
    for (const o of m.objects) {
      if (reg.objects.has(o.id)) throw new Error(`Objekt ${o.id} je registrován dvakrát`);
      reg.objects.set(o.id, o);
    }
  }
  for (const m of modules) {
    for (const d of m.dependsOn) {
      if (!reg.modules.has(d)) throw new Error(`Modul ${m.id} závisí na neznámém modulu ${d}`);
    }
    for (const o of m.objects) {
      for (const [name, f] of Object.entries(o.fields)) {
        if (f.edt.kind === "ref") {
          const target = reg.objects.get(f.edt.refObject!);
          if (!target) throw new Error(`${o.id}.${name}: neznámý cíl odkazu ${f.edt.refObject}`);
          const tm = moduleOf(target.id);
          if (tm !== m.id && !f.optionalRef && !dependencyClosure(reg, [m.id]).has(tm))
            throw new Error(`${o.id}.${name}: modul ${m.id} musí záviset na ${tm}`);
          if (o.scope === "tenant" && target.scope === "company")
            throw new Error(`${o.id}.${name}: sdílený objekt nemůže odkazovat na objekt firmy`);
        }
        if (f.edt.kind === "enum" && !reg.enums.has(f.edt.enumId!))
          throw new Error(`${o.id}.${name}: neznámý výčet ${f.edt.enumId}`);
      }
    }
  }
  for (const x of extensions) {
    reg.extensions.set(x.id, x);
    for (const objectId of [...Object.keys(x.fields ?? {}), ...Object.keys(x.handlers ?? {})]) {
      if (!reg.objects.has(objectId)) throw new Error(`Rozšíření ${x.id}: neznámý objekt ${objectId}`);
    }
  }
  for (const set of coreHandlers) {
    for (const [objectId, h] of Object.entries(set)) {
      if (!reg.objects.has(objectId)) throw new Error(`Obsluha pro neznámý objekt ${objectId}`);
      reg.coreHandlers.set(objectId, [...(reg.coreHandlers.get(objectId) ?? []), h]);
    }
  }
  return reg;
}

/** Moduly včetně všech jejich závislostí. */
export function dependencyClosure(reg: Registry, ids: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const visit = (id: string) => {
    if (out.has(id)) return;
    out.add(id);
    reg.modules.get(id)?.dependsOn.forEach(visit);
  };
  for (const id of ids) visit(id);
  return out;
}

/** Moduly, které na daném modulu (přímo či nepřímo) závisí. */
export function dependents(reg: Registry, id: string): string[] {
  return [...reg.modules.values()]
    .filter((m) => m.id !== id && dependencyClosure(reg, [m.id]).has(id))
    .map((m) => m.id);
}
