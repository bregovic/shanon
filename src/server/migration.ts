/**
 * Migrace firmy (Organizace → Migrace): jeden soubor JSON s konfigurací firmy.
 *
 * - Šablona: prázdný soubor s pokyny u každé části a pole (generuje se z definic objektů — vždy aktuální).
 * - Export: vyplněný soubor z aktuální firmy (např. odladěné na TESTu → založení na PROD).
 * - Spuštění: firma z ARES (sídlo, DPH, finanční úřad, bankovní účty z registru plátců), moduly s výchozím
 *   nastavením (i finanční dimenze Partner z adresáře — proto před zakládáním partnerů), údaje organizace
 *   a logo, pak agendy v pořadí souboru obecným importem (aktualizace podle klíče, opakování nic nezdvojí),
 *   nakonec uživatelé s rolemi ve firmě.
 * - Integrace (napojení): testovací (TEST-…, Playground, simulátory) i ostrá v jednom souboru. Na testovacím serveru
 *   se ostrá napojení nepoužijí (live-guard.ts) a k ostrému EET / poště se založí testovací protějšek; na produkci se
 *   testovací napojení nezakládají. Export „pro ostrý provoz“ testovací napojení vynechá a ostrá zapne.
 * Hesla, tajné údaje napojení (certifikát EET, hesla) a doklady soubor nikdy neobsahuje.
 */
import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { UserError, type RecordData } from "@/core/module";
import type { FieldDef, ObjectDef } from "@/core/object";
import { isEmail } from "@/core/edt";
import { fillLabel, resolveLabel, type Lang } from "@/core/labels";
import { labelTable, registry } from "@/registry";
import { getObject, inTenant, runAction, saveRecord, type Ctx, type Session } from "./data";
import { createCompanyFromRegistry } from "./company-lookup";
import { enableModulesWithSetup } from "./company-modules";
import { companyModules } from "./modules";
import { importRecords, type ImageSource } from "./import";
import { setImage } from "./docuref";
import { isLiveConnection, isTestServer } from "@/modules/int/live-guard";
import { ensureTestConnection } from "@/modules/int/test-env";
import { prisma } from "./db";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import sharp from "sharp";

export const MIGRATION_FORMAT = "shanon-migrace";
export const MIGRATION_VERSION = 1;

/** Agendy, které migrace zakládá — v tomto pořadí (číselníky před položkami, partneři po zapnutí dimenzí). */
export const MIGRATION_OBJECTS: { id: string; note: string }[] = [
  { id: "inv.unit", note: "@ORG:MigObjUnit" },
  { id: "tax.paymentTerm", note: "@ORG:MigObjPaymentTerm" },
  { id: "inv.itemGroup", note: "@ORG:MigObjItemGroup" },
  { id: "inv.category", note: "@ORG:MigObjCategory" },
  { id: "inv.item", note: "@ORG:MigObjItem" },
  { id: "ap.vendor", note: "@ORG:MigObjVendor" },
  { id: "ar.customer", note: "@ORG:MigObjCustomer" },
  { id: "hr.employee", note: "@ORG:MigObjEmployee" },
  { id: "org.site", note: "@ORG:MigObjSite" },
  { id: "bank.account", note: "@ORG:MigObjBankAccount" },
  { id: "int.connection", note: "@ORG:MigObjConnection" },
];

/** Pole agendy, která migrace vynechává (odkaz na pokladnu — pokladny se nemigrují; stav napojení). */
const SKIP_FIELDS: Record<string, string[]> = { "int.connection": ["registerId", "lastCheckAt", "lastResult"] };
/** Napojení, která se nemigrují: veřejné služby zakládá výchozí nastavení, klíč API nejde přenést. */
const skipConnection = (r: Record<string, unknown>) => r.kind === "service" || r.kind === "api";
/** Testovací napojení (testovací server ho používá místo ostrého). */
const isTestConnection = (r: Record<string, unknown>) => String(r.code ?? "").startsWith("TEST-");

/** Údaje organizace, které registry neznají (zbytek doplní ARES a registr DPH). */
const ORG_FIELDS = ["tradeName", "email", "phone", "web", "dataBoxId", "publicSlug", "mailSignature"] as const;
/** E-shop firmy (jeden na firmu, zakládá ho výchozí nastavení modulu E-shop): vzhled, zveřejnění, objednávky. */
const SHOP_FIELDS = ["name", "active", "layout", "accentColor", "accent2Color", "heroStyle", "heroAnimation", "headline", "intro", "sellOutOfStock", "minOrder", "freeShippingFrom", "contactEmail", "contactPhone", "orderHourLimit", "pickupLeadDays", "pickupMaxDays", "pickupFrom", "pickupTo", "weighBufferPct"] as const;
const SHOP_IMAGES = ["logo", "heroImage"] as const;

/**
 * Požadavky na obrázky podle pole (objekt.pole): popis pro šablonu (agent podle něj připraví obrázky) a kontrola
 * rozměrů při Zkontrolovat. ratio = šířka / výška (null = libovolný v rozmezí ratioMin…ratioMax).
 */
export const IMAGE_SPECS: Record<string, { note: string; minW: number; minH: number; ratio?: number; ratioMin?: number; ratioMax?: number }> = {
  "inv.item.image": { note: "@ORG:MigImgItem", minW: 400, minH: 400, ratio: 1 },
  "inv.category.image": { note: "@ORG:MigImgCategory", minW: 600, minH: 450, ratio: 4 / 3 },
  "org.entity.logo": { note: "@ORG:MigImgLogo", minW: 200, minH: 80, ratioMin: 0.8, ratioMax: 5 },
  "shop.shop.logo": { note: "@ORG:MigImgLogo", minW: 200, minH: 80, ratioMin: 0.8, ratioMax: 5 },
  // poměr podle typu úvodu: vedle textu 16:9, přes celou šířku / banner 3:1 — kontrola přijme obojí
  "shop.shop.heroImage": { note: "@ORG:MigImgHero", minW: 1200, minH: 400, ratioMin: 1.5, ratioMax: 3.6 },
};

export interface MigrationUser {
  email: string;
  jmeno?: string;
  prijmeni?: string;
  role?: string[];
  spravceFirmy?: boolean;
  pozvat?: boolean;
}
export interface MigrationFile {
  format: string;
  verze: number;
  firma: { ico: string; organizace?: Record<string, unknown> & { logo?: string }; obchod?: Record<string, unknown> };
  moduly: string[];
  slozkaObrazku?: string;
  uzivatele?: MigrationUser[];
  data: { objekt: string; zaznamy: Record<string, unknown>[] }[];
}

/** Pozvánka nového uživatele e-mailem (dodá volající — pošta a odkaz patří k přihlášení); false = pošta nenastavená. */
export type Invite = (userId: string) => Promise<boolean>;

export interface MigrationStep {
  key: string;
  label: string;
  status: "ok" | "warning" | "error";
  created?: number;
  updated?: number;
  messages: string[];
}
export interface MigrationReport {
  applied: boolean;
  companyId: string | null;
  steps: MigrationStep[];
}

const tr = (lang: Lang, ref: string, p?: Record<string, string>) => fillLabel(resolveLabel(labelTable, ref, lang), p);

/** Chyba kroku jako text: hláška a u chyb polí i pole (např. „Neplatná hodnota. (bankAccount: Číslo účtu …)“). */
function errorText(e: unknown, lang: Lang): string {
  if (!(e instanceof UserError)) return String(e instanceof Error ? e.message : e);
  const fields = Object.entries(e.fields ?? {})
    .filter(([, v]) => v !== e.label)
    .map(([k, v]) => `${k}: ${tr(lang, String(v), e.params)}`);
  return `${tr(lang, e.label, e.params)}${fields.length ? ` (${fields.join("; ")})` : ""}`;
}

/** Pole, která se v souboru vyplňují (bez počítaných, tajných a systémových). */
function migrationFields(def: ObjectDef): [string, FieldDef][] {
  const skip = SKIP_FIELDS[def.id] ?? [];
  return Object.entries(def.fields).filter(([n, f]) => (!f.readOnly || f.image) && !skip.includes(n)).filter(([, f]) => !f.secret && !f.edt.user);
}

/** Popis pole pro šablonu: popisek, povinnost, klíč, povolené hodnoty / odkaz, nápověda. */
function fieldDoc(def: ObjectDef, name: string, f: FieldDef, lang: Lang): string {
  const parts = [resolveLabel(labelTable, f.label ?? f.edt.label, lang)];
  if (f.mandatory && f.default === undefined && def.numberSeq?.field !== name) parts.push(tr(lang, "@ORG:MigFieldMandatory"));
  if (def.numberSeq?.field === name) parts.push(tr(lang, "@ORG:MigFieldNumberSeq"));
  if (def.unique?.some((u) => u.length === 1 && u[0] === name)) parts.push(tr(lang, "@ORG:MigFieldKey"));
  if (f.image) {
    parts.push(tr(lang, "@ORG:MigFieldImage"));
    const spec = IMAGE_SPECS[`${def.id}.${name}`];
    if (spec) parts.push(tr(lang, spec.note));
  }
  else
    switch (f.edt.kind) {
      case "ref":
        parts.push(tr(lang, "@ORG:MigFieldRef", { target: resolveLabel(labelTable, getObject(f.edt.refObject!).labelPlural, lang) }));
        break;
      case "enum": {
        const e = registry.enums.get(f.edt.enumId!);
        if (e) parts.push(tr(lang, "@ORG:MigFieldEnum", { values: e.values.map((v) => `${v.value} (${resolveLabel(labelTable, v.label, lang)})`).join(", ") }));
        break;
      }
      case "bool":
        parts.push("true / false");
        break;
      case "int":
      case "decimal":
        parts.push(tr(lang, "@ORG:MigFieldNumber"));
        break;
      case "date":
        parts.push(tr(lang, "@ORG:MigFieldDate"));
        break;
      default:
        if (f.edt.maxLength) parts.push(tr(lang, "@ORG:MigFieldMax", { n: String(f.edt.maxLength) }));
    }
  if (f.default !== undefined && f.default !== null && typeof f.default !== "object") parts.push(tr(lang, "@ORG:MigFieldDefault", { value: String(f.default) }));
  if (f.help) parts.push(resolveLabel(labelTable, f.help, lang));
  if (f.module) parts.push(tr(lang, "@ORG:MigFieldModule", { module: resolveLabel(labelTable, registry.modules.get(f.module)?.label ?? f.module, lang) }));
  return parts.join(" · ");
}

const objectsAvailable = () => MIGRATION_OBJECTS.filter((o) => registry.objects.has(o.id));
const optionalModules = () => [...registry.modules.values()].filter((m) => !m.core);

/** Prázdná šablona s pokyny (pro člověka i agenta, který ji vyplní). */
export function migrationTemplate(lang: Lang): RecordData {
  const t = (ref: string, p?: Record<string, string>) => tr(lang, ref, p);
  return {
    format: MIGRATION_FORMAT,
    verze: MIGRATION_VERSION,
    pokyny: t("@ORG:MigNoteGeneral").split("\n"),
    firma: {
      pokyny: t("@ORG:MigNoteCompany"),
      ico: "",
      organizace: {
        pokyny: t("@ORG:MigNoteOrg"),
        pole: Object.fromEntries([...ORG_FIELDS.map((n) => [n, fieldDoc(getObject("org.entity"), n, getObject("org.entity").fields[n], lang)]), ["logo", `${t("@ORG:MigFieldLogo")} · ${t("@ORG:MigImgLogo")}`]]),
        ...Object.fromEntries(ORG_FIELDS.map((n) => [n, ""])),
        logo: "",
      },
      ...(registry.objects.has("shop.shop")
        ? {
            obchod: {
              pokyny: t("@ORG:MigNoteShop"),
              pole: Object.fromEntries([...SHOP_FIELDS, ...SHOP_IMAGES].map((n) => [n, fieldDoc(getObject("shop.shop"), n, getObject("shop.shop").fields[n], lang)])),
            },
          }
        : {}),
    },
    moduly: [],
    dostupneModuly: Object.fromEntries(optionalModules().map((m) => [m.id, `${resolveLabel(labelTable, m.label, lang)} — ${resolveLabel(labelTable, m.description, lang)}`])),
    pokynyModuly: t("@ORG:MigNoteModules"),
    slozkaObrazku: "obrazky",
    pokynyObrazky: t("@ORG:MigNoteImages"),
    pozadavkyObrazku: Object.fromEntries(Object.entries(IMAGE_SPECS).map(([k, v]) => [k, t(v.note)])),
    uzivatele: [],
    pokynyUzivatele: t("@ORG:MigNoteUsers"),
    vzorUzivatele: { email: "jmeno@firma.cz", jmeno: "Jan", prijmeni: "Novák", role: ["POKLADNIK"], spravceFirmy: false, pozvat: false },
    data: objectsAvailable().map((o) => {
      const def = getObject(o.id);
      return {
        objekt: o.id,
        nazev: resolveLabel(labelTable, def.labelPlural, lang),
        modul: o.id.split(".")[0],
        pokyny: t(o.note),
        pole: Object.fromEntries(migrationFields(def).map(([n, f]) => [n, fieldDoc(def, n, f, lang)])),
        zaznamy: [],
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Export vyplněné konfigurace z aktuální firmy
// ---------------------------------------------------------------------------

const PAGE = 2000;

/**
 * Konfigurace aktuální firmy ve tvaru migračního souboru (bez dokladů, hesel a tajných údajů).
 * `production` = pro ostrý provoz: bez testovacích napojení, ostrá napojení zapnutá (i pozastavená testem).
 */
export async function exportMigration(ctx: Ctx, lang: Lang, client: PrismaClient = prisma, opts: { production?: boolean } = {}): Promise<RecordData> {
  if (!ctx.companyId) throw new UserError("@SYS:NoAccess");
  const tmpl = migrationTemplate(lang);
  const folder = "obrazky";
  // mimo transakci (lokální databáze má jediné spojení)
  const mods = [...(await companyModules(ctx.tenantId, ctx.companyId, [], client))].filter((m) => registry.modules.has(m) && !registry.modules.get(m)!.core);
  /** názvy souborů obrázků (pole obrázku drží id přílohy) */
  const imageNames = async (s: Session, ids: string[]) => {
    const refs = ids.length ? await s.tx.sysDocuRef.findMany({ where: { tenantId: ctx.tenantId, id: { in: ids } }, select: { id: true, name: true } }) : [];
    return new Map(refs.map((r) => [r.id, `${folder}/${r.name}`]));
  };
  const head = await inTenant(
    ctx,
    async (s) => {
      const api = s.sys().api();
      const [org] = await api.find("org.entity", {}, { take: 1 });
      const [shop] = ctx.modules.has("shop") ? await api.find("shop.shop", {}, { take: 1 }) : [];
      const shopImages = shop ? await imageNames(s, SHOP_IMAGES.map((n) => shop[n]).filter(Boolean).map(String)) : new Map<string, string>();
      const shopDef = getObject("shop.shop");
      const shopValue = (n: string) => {
        const v = shop![n];
        const k = shopDef.fields[n].edt.kind;
        return k === "decimal" || k === "int" ? Number(v) : v;
      };
      const obchod = shop
        ? {
            ...Object.fromEntries(SHOP_FIELDS.filter((n) => shop[n] !== null && shop[n] !== undefined && shop[n] !== "").map((n) => [n, shopValue(n)])),
            ...Object.fromEntries(SHOP_IMAGES.filter((n) => shop[n]).map((n) => [n, shopImages.get(String(shop[n])) ?? ""])),
          }
        : null;
      const company = await api.get("sys.company", ctx.companyId!);
      const logo = org?.logo ? (await imageNames(s, [String(org.logo)])).get(String(org.logo)) : undefined;
      const roles = new Map((await s.sys().find("sys.role", {}, 1000)).map((r) => [String(r.id), String(r.code)]));
      return { org, company, logo, roles, obchod };
    },
    client,
  );
  // uživatelé firmy s rolemi (kódy); hesla nikdy — přiřazení čte jen klient bez aplikační role
  const links = await client.sysUserCompany.findMany({ where: { tenantId: ctx.tenantId, companyId: ctx.companyId! }, include: { user: { select: { email: true, firstName: true, lastName: true, name: true, active: true, role: true } } } });
  const users = links
    .filter((l) => l.user.active && l.user.role !== "admin")
    .map((l) => ({ email: l.user.email, jmeno: l.user.firstName || l.user.name, prijmeni: l.user.lastName || "", role: l.roleIds.map((id) => head.roles.get(id)).filter(Boolean), spravceFirmy: l.admin, pozvat: false }));
  // agendy: každá ve vlastní transakci (velký katalog se vejde do limitu transakce)
  const data: RecordData[] = [];
  for (const section of tmpl.data as RecordData[]) {
    const id = String(section.objekt);
    if (!ctx.modules.has(id.split(".")[0])) {
      data.push({ ...section, zaznamy: [] });
      continue;
    }
    const def = getObject(id);
    const fields = migrationFields(def);
    const records = await inTenant(
      ctx,
      async (s) => {
        const rows: RecordData[] = [];
        for (let page = 1; ; page++) {
          const r = await s.sys().list(id, { page, pageSize: PAGE, maxPageSize: PAGE, lang });
          rows.push(...r.rows);
          if (r.rows.length < PAGE) break;
        }
        const images = await imageNames(s, fields.filter(([, f]) => f.image).flatMap(([n]) => rows.map((r) => r[n]).filter(Boolean).map(String)));
        const kept = id !== "int.connection" ? rows : rows.filter((r) => !skipConnection(r) && !(opts.production && isTestConnection(r)));
        return kept.map((r) => {
          const out: Record<string, unknown> = {};
          for (const [n, f] of fields) {
            const v = r[n];
            if (v === null || v === undefined || v === "") continue;
            // partner s IČO se zakládá z registru — subjekt podle jména by se nemusel shodovat
            if (n === "subjectId" && r.regNo) continue;
            if (f.image) out[n] = images.get(String(v)) ?? null;
            else if (f.edt.kind === "ref") out[n] = (r._titles as Record<string, string> | undefined)?.[n] ?? null;
            else if (f.edt.kind === "decimal" || f.edt.kind === "int") out[n] = Number(v);
            else if (f.edt.kind === "date") out[n] = String(v instanceof Date ? v.toISOString() : v).slice(0, 10);
            else out[n] = v;
            if (out[n] === null) delete out[n];
          }
          // ostrý provoz: ostré napojení zapnuté, povolení pro testovací server nemá smysl
          if (id === "int.connection" && opts.production) {
            if (isLiveConnection(r) || r.pausedByTest) out.active = true;
            delete out.liveOnTest;
          }
          return out;
        });
      },
      client,
    );
    data.push({ ...section, zaznamy: records });
  }
  const firma = tmpl.firma as RecordData;
  const orgTmpl = firma.organizace as RecordData;
  const { org, company, logo, obchod } = head;
  return {
    ...tmpl,
    firma: {
      ...firma,
      ico: String(org?.regNo ?? company?.regNo ?? ""),
      organizace: { pokyny: orgTmpl.pokyny, pole: orgTmpl.pole, ...Object.fromEntries(ORG_FIELDS.map((n) => [n, org?.[n] ?? ""])), logo: logo ?? "" },
      ...(obchod && firma.obchod ? { obchod: { ...(firma.obchod as RecordData), ...obchod } } : {}),
    },
    moduly: mods,
    slozkaObrazku: folder,
    uzivatele: users,
    provoz: opts.production ? "ostry" : "test",
    data,
  };
}

// ---------------------------------------------------------------------------
// Kontrola a spuštění
// ---------------------------------------------------------------------------

/** Rozbor souboru: formát, IČO, moduly, agendy a pole (zbytek ověří import nanečisto). */
export function parseMigration(raw: unknown, lang: Lang): { file: MigrationFile; step: MigrationStep } {
  const t = (ref: string, p?: Record<string, string>) => tr(lang, ref, p);
  const step: MigrationStep = { key: "check", label: t("@ORG:MigStepCheck"), status: "ok", messages: [] };
  const o = (raw ?? {}) as RecordData;
  if (o.format !== MIGRATION_FORMAT) throw new UserError("@ORG:MigFormat");
  const firma = (o.firma ?? {}) as RecordData;
  const ico = String(firma.ico ?? "").replace(/\s/g, "");
  if (!/^\d{8}$/.test(ico)) throw new UserError("@ORG:MigIco");
  const moduly = Array.isArray(o.moduly) ? o.moduly.map(String) : [];
  for (const m of moduly) if (!registry.modules.has(m)) throw new UserError("@ORG:MigModule", { id: m });
  const allowed = new Set(MIGRATION_OBJECTS.map((x) => x.id));
  const data: MigrationFile["data"] = [];
  for (const sec of Array.isArray(o.data) ? (o.data as RecordData[]) : []) {
    const id = String(sec.objekt ?? "");
    const rows = Array.isArray(sec.zaznamy) ? (sec.zaznamy as Record<string, unknown>[]) : [];
    if (!rows.length) continue;
    if (!allowed.has(id) || !registry.objects.has(id)) throw new UserError("@ORG:MigObject", { id });
    const def = getObject(id);
    const known = new Set(migrationFields(def).map(([n]) => n));
    const unknown = new Set(rows.flatMap((r) => Object.keys(r)).filter((k) => !known.has(k)));
    for (const k of unknown) step.messages.push(t("@ORG:MigField", { object: resolveLabel(labelTable, def.labelPlural, lang), field: k }));
    const mod = id.split(".")[0];
    if (!moduly.includes(mod) && !registry.modules.get(mod)?.core && !registry.modules.get(mod)?.starter) step.messages.push(t("@ORG:MigModuleMissing", { object: resolveLabel(labelTable, def.labelPlural, lang), module: mod }));
    data.push({ objekt: id, zaznamy: rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => known.has(k)))) });
  }
  const users: MigrationUser[] = [];
  for (const u of Array.isArray(o.uzivatele) ? (o.uzivatele as RecordData[]) : []) {
    const email = String(u.email ?? "").trim().toLowerCase();
    if (!email) continue;
    if (!isEmail(email)) throw new UserError("@ORG:MigEmail", { email });
    users.push({ email, jmeno: u.jmeno ? String(u.jmeno) : undefined, prijmeni: u.prijmeni ? String(u.prijmeni) : undefined, role: Array.isArray(u.role) ? u.role.map(String) : [], spravceFirmy: !!u.spravceFirmy, pozvat: !!u.pozvat });
  }
  const org = (firma.organizace ?? {}) as RecordData;
  const organizace: Record<string, unknown> = Object.fromEntries(ORG_FIELDS.filter((n) => org[n] !== undefined && org[n] !== "").map((n) => [n, org[n]]));
  if (org.logo) organizace.logo = String(org.logo);
  const shopRaw = (firma.obchod ?? null) as RecordData | null;
  const obchod = shopRaw
    ? Object.fromEntries([...SHOP_FIELDS, ...SHOP_IMAGES].filter((n) => shopRaw[n] !== undefined && shopRaw[n] !== "" && shopRaw[n] !== null).map((n) => [n, shopRaw[n]]))
    : null;
  if (step.messages.length) step.status = "warning";
  return { file: { format: MIGRATION_FORMAT, verze: Number(o.verze ?? 1), firma: { ico, organizace, ...(obchod && Object.keys(obchod).length ? { obchod } : {}) }, moduly, slozkaObrazku: o.slozkaObrazku ? String(o.slozkaObrazku) : undefined, uzivatele: users, data }, step };
}

/** Záznamy ze souboru → tabulka obecného importu (hlavička = názvy polí). */
function toTable(rows: Record<string, unknown>[], lang: Lang) {
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? (lang === "cs" ? "ano" : "yes") : lang === "cs" ? "ne" : "no") : String(v));
  return { headers, rows: rows.map((r) => headers.map((h) => cell(r[h]))) };
}

/** Obrázky souboru s požadavkem na rozměr: cesta → klíč požadavku (objekt.pole). */
function specImages(file: MigrationFile): [string, string][] {
  const out: [string, string][] = [];
  const add = (key: string, v: unknown) => typeof v === "string" && v && IMAGE_SPECS[key] && out.push([v, key]);
  add("org.entity.logo", file.firma.organizace?.logo);
  for (const n of SHOP_IMAGES) add(`shop.shop.${n}`, file.firma.obchod?.[n]);
  for (const sec of file.data) {
    const def = getObject(sec.objekt);
    for (const [n, f] of Object.entries(def.fields)) if (f.image) for (const r of sec.zaznamy) add(`${sec.objekt}.${n}`, r[n]);
  }
  return [...new Map(out.map((x) => [x[0], x])).values()];
}

/** Rozměry obrázků proti požadavkům (jen varování: malé, jiný poměr stran). */
async function imageSizeWarnings(file: MigrationFile, images: ImageSource, lang: Lang): Promise<string[]> {
  const warn: string[] = [];
  for (const [path, key] of specImages(file)) {
    const img = images(path);
    if (!img) continue;
    const spec = IMAGE_SPECS[key];
    let w = 0;
    let h = 0;
    try {
      const m = await sharp(img.data).metadata();
      w = m.width ?? 0;
      h = m.height ?? 0;
    } catch {
      continue; // neplatný obrázek ohlásí import
    }
    if (!w || !h) continue;
    const r = w / h;
    const size = `${w}×${h} px`;
    if (w < spec.minW || h < spec.minH) warn.push(tr(lang, "@ORG:MigImgSmall", { path, size, min: `${spec.minW}×${spec.minH} px` }));
    else if (spec.ratio && Math.abs(r - spec.ratio) / spec.ratio > 0.12) warn.push(tr(lang, "@ORG:MigImgRatio", { path, size, ratio: ratioText(spec.ratio) }));
    else if ((spec.ratioMin && r < spec.ratioMin) || (spec.ratioMax && r > spec.ratioMax)) warn.push(tr(lang, "@ORG:MigImgRatio", { path, size, ratio: `${ratioText(spec.ratioMin ?? 0)} – ${ratioText(spec.ratioMax ?? 0)}` }));
  }
  return warn;
}

const ratioText = (r: number) => (Math.abs(r - 1) < 0.01 ? "1:1" : Math.abs(r - 4 / 3) < 0.01 ? "4:3" : Math.abs(r - 16 / 9) < 0.01 ? "16:9" : `${Math.round(r * 10) / 10}:1`);

/** Obrázky, na které soubor odkazuje a které ve vybrané složce nejsou (jen varování). */
function missingImages(file: MigrationFile, images: ImageSource): string[] {
  const paths = [file.firma.organizace?.logo, ...SHOP_IMAGES.map((n) => file.firma.obchod?.[n]), ...file.data.flatMap((s) => {
    const def = getObject(s.objekt);
    const img = Object.entries(def.fields).filter(([, f]) => f.image).map(([n]) => n);
    return s.zaznamy.flatMap((r) => img.map((n) => r[n]));
  })].filter((p): p is string => typeof p === "string" && p !== "");
  return [...new Set(paths)].filter((p) => !images(p));
}

/**
 * Kontrola (`dryRun`) nebo spuštění migrace. Spouští superuživatel ze své firmy; firma se založí (nebo
 * aktualizuje) podle IČO. Kontrola nanečisto agend proběhne celá jen u firmy, která už existuje.
 */
export async function runMigration(
  ctx: Ctx,
  raw: unknown,
  opts: { dryRun: boolean; lang: Lang; images: ImageSource; invite?: Invite },
  client: PrismaClient = prisma,
): Promise<MigrationReport> {
  if (ctx.role !== "admin") throw new UserError("@SYS:NoAccess");
  const { lang } = opts;
  const t = (ref: string, p?: Record<string, string>) => tr(lang, ref, p);
  const { file, step: check } = parseMigration(raw, lang);
  const report: MigrationReport = { applied: false, companyId: null, steps: [check] };
  const missing = missingImages(file, opts.images);
  for (const p of missing.slice(0, 10)) check.messages.push(t("@ORG:MigImage", { path: p }));
  if (missing.length > 10) check.messages.push(t("@ORG:MigMore", { n: String(missing.length - 10) }));
  // rozměry obrázků proti doporučení (stejný problém u celé série = prvních 5 + počet)
  const sizes = await imageSizeWarnings(file, opts.images, lang);
  for (const w of sizes.slice(0, 5)) check.messages.push(w);
  if (sizes.length > 5) check.messages.push(t("@ORG:MigMore", { n: String(sizes.length - 5) }));
  // role uživatelů podle kódu (role jsou společné pro organizaci)
  const roleRows = await inTenant(ctx, (s) => s.sys().find("sys.role", {}, 1000), client);
  const roleId = new Map(roleRows.map((r) => [String(r.code).toUpperCase(), String(r.id)]));
  for (const u of file.uzivatele ?? []) for (const r of u.role ?? []) if (!roleId.has(r.toUpperCase())) check.messages.push(t("@ORG:MigRole", { email: u.email, role: r }));
  if (check.messages.length) check.status = "warning";

  const existing = await inTenant(ctx, (s) => s.sys().find("sys.company", { regNo: file.firma.ico }, 1), client);
  if (opts.dryRun) {
    const companyId = existing[0] ? String(existing[0].id) : null;
    if (!companyId) {
      check.messages.push(t("@ORG:MigRefsLater"));
      return report;
    }
    const cctx: Ctx = { ...ctx, companyId, modules: await companyModules(ctx.tenantId, companyId, [], client), shared: undefined };
    for (const sec of file.data) {
      // modul ze souboru, který firma ještě nemá: zapne se až při spuštění, nanečisto agendu přeskočit
      const mod = sec.objekt.split(".")[0];
      if (!cctx.modules.has(mod) && file.moduly.includes(mod)) {
        report.steps.push({ key: sec.objekt, label: resolveLabel(labelTable, getObject(sec.objekt).labelPlural, lang), status: "warning", messages: [t("@ORG:MigModuleLater", { module: mod })] });
        continue;
      }
      report.steps.push(await importStep(cctx, sec, true, lang, opts.images, client));
    }
    return report;
  }

  // 1. firma z ARES (+ registr DPH: plátce, finanční úřad, bankovní účty)
  const companyStep: MigrationStep = { key: "company", label: t("@ORG:MigStepCompany"), status: "ok", messages: [] };
  report.steps.push(companyStep);
  let companyId: string;
  try {
    companyId = await createCompanyFromRegistry(ctx, file.firma.ico, client);
  } catch (e) {
    companyStep.status = "error";
    companyStep.messages.push(errorText(e, lang));
    return report;
  }
  report.companyId = companyId;
  report.applied = true;
  companyStep.messages.push(t(existing.length ? "@ORG:MigCompanyUpdated" : "@ORG:MigCompanyCreated", { ico: file.firma.ico }));

  // 2. moduly s výchozím nastavením (řady, účty, DPH, dimenze Partner z adresáře…)
  const modStep: MigrationStep = { key: "modules", label: t("@ORG:MigStepModules"), status: "ok", messages: [] };
  report.steps.push(modStep);
  const added = await enableModulesWithSetup(ctx, companyId, file.moduly, lang, client);
  if (added.length) modStep.messages.push(t("@ORG:MigModulesAdded", { list: added.join(", ") }));
  const cctx: Ctx = { ...ctx, companyId, modules: await companyModules(ctx.tenantId, companyId, [], client), shared: undefined };

  // 3. organizace: kontakty, logo; z registrů NACE, plátce DPH, finanční úřad a bankovní účty (Banka už je zapnutá)
  const orgStep: MigrationStep = { key: "org", label: t("@ORG:MigStepOrg"), status: "ok", messages: [] };
  report.steps.push(orgStep);
  // každá část zvlášť — obsazená zkratka e-shopu nesmí zastavit registry, logo ani dimenze
  const part = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      orgStep.status = "warning";
      orgStep.messages.push(errorText(e, lang));
    }
  };
  const [org] = await inTenant(cctx, (s) => s.sys().find("org.entity", {}, 1), client);
  if (org) {
    const { logo, ...fields } = file.firma.organizace ?? {};
    if (Object.keys(fields).length) await part(() => saveRecord(cctx, "org.entity", String(org.id), fields, undefined, client));
    await part(() => runAction(cctx, "org.entity", String(org.id), "ares", client));
    const img = logo ? opts.images(String(logo)) : null;
    if (img) await part(() => setImage(cctx, "org.entity", String(org.id), "logo", img, client));
  }
  // dimenze z adresáře: hodnoty i subjektům založeným před zapnutím Hlavní knihy
  if (cctx.modules.has("gl"))
    await part(async () => {
      for (const dim of await inTenant(cctx, (s) => s.sys().find("gl.dimension", { source: "subject", active: true }, 6), client))
        await runAction(cctx, "gl.dimension", String(dim.id), "createSubjectValues", client);
    });

  // 4. agendy v pořadí souboru (každá vše nebo nic; chyba jedné nezastaví další)
  for (const sec of file.data) {
    if (sec.objekt === "int.connection") report.steps.push(await connectionStep(cctx, sec, lang, opts.images, client));
    else report.steps.push(await importStep(cctx, sec, false, lang, opts.images, client));
  }

  // 5. e-shop: vzhled, kontakty, zveřejnění (až s hotovým katalogem)
  if (file.firma.obchod) report.steps.push(await shopStep(cctx, file.firma.obchod, lang, opts.images, client));

  // 6. uživatelé
  if (file.uzivatele?.length) report.steps.push(await usersStep(cctx, file.uzivatele, roleId, opts, client));
  return report;
}

async function shopStep(cctx: Ctx, obchod: Record<string, unknown>, lang: Lang, images: ImageSource, client: PrismaClient): Promise<MigrationStep> {
  const step: MigrationStep = { key: "shop", label: tr(lang, "@ORG:MigStepShop"), status: "ok", messages: [] };
  if (!cctx.modules.has("shop")) {
    step.status = "error";
    step.messages.push(tr(lang, "@ORG:MigModuleOff"));
    return step;
  }
  try {
    const [shop] = await inTenant(cctx, (s) => s.sys().find("shop.shop", {}, 1), client);
    if (!shop) throw new UserError("@ORG:MigShopMissing");
    const fields = Object.fromEntries(Object.entries(obchod).filter(([k]) => !(SHOP_IMAGES as readonly string[]).includes(k)));
    const saved = Object.keys(fields).length ? await saveRecord(cctx, "shop.shop", String(shop.id), fields, undefined, client) : shop;
    step.updated = 1;
    for (const n of SHOP_IMAGES) {
      const img = obchod[n] ? images(String(obchod[n])) : null;
      if (img) await setImage(cctx, "shop.shop", String(shop.id), n, img, client);
    }
    if (saved.publicUrl) step.messages.push(tr(lang, saved.active ? "@ORG:MigShopPublished" : "@ORG:MigShopHidden", { url: String(saved.publicUrl) }));
  } catch (e) {
    step.status = "error";
    step.messages.push(errorText(e, lang));
  }
  return step;
}

/**
 * Napojení: na produkci bez testovacích (TEST-…); na testovacím serveru všechna a k ostrému EET a poště testovací
 * protějšek (ostrá se tam nepoužijí, dokud je u napojení nepovolíte). Ostré EET bez certifikátu = připomínka.
 */
async function connectionStep(cctx: Ctx, sec: MigrationFile["data"][number], lang: Lang, images: ImageSource, client: PrismaClient): Promise<MigrationStep> {
  const test = isTestServer();
  const rows = sec.zaznamy.filter((r) => !skipConnection(r) && (test || !isTestConnection(r)));
  const skipped = sec.zaznamy.length - rows.length;
  const step = rows.length ? await importStep(cctx, { ...sec, zaznamy: rows }, false, lang, images, client) : { key: sec.objekt, label: resolveLabel(labelTable, getObject(sec.objekt).labelPlural, lang), status: "ok" as const, messages: [] as string[] };
  if (skipped) step.messages.push(tr(lang, "@ORG:MigConnSkipped", { n: String(skipped) }));
  if (step.status === "error") return step;
  const live = rows.filter((r) => isLiveConnection(r));
  try {
    await inTenant(
      cctx,
      async (s) => {
        const api = s.sys().api();
        const saved = await api.find("int.connection", { code: { in: live.map((r) => String(r.code)) } }, { take: 200 });
        for (const c of saved) {
          if (c.kind === "eet" && !c.certData) step.messages.push(tr(lang, "@ORG:MigConnCert", { code: String(c.code) }));
          if (c.kind === "isds" || (c.kind === "mail" && c.driver === "smtp") || c.kind === "payment") step.messages.push(tr(lang, "@ORG:MigConnSecret", { code: String(c.code) }));
        }
        if (test) {
          for (const kind of new Set(live.map((r) => String(r.kind)))) {
            const code = await ensureTestConnection(api, (ref) => tr(lang, ref), kind);
            if (code) step.messages.push(tr(lang, "@ORG:MigConnTest", { code }));
          }
          if (live.length) step.messages.push(tr(lang, "@ORG:MigConnLiveOnTest", { codes: live.map((r) => String(r.code)).join(", ") }));
        }
      },
      client,
    );
  } catch (e) {
    step.status = "warning";
    step.messages.push(errorText(e, lang));
  }
  if (step.messages.length && step.status === "ok") step.status = "warning";
  return step;
}

async function importStep(cctx: Ctx, sec: MigrationFile["data"][number], dryRun: boolean, lang: Lang, images: ImageSource, client: PrismaClient): Promise<MigrationStep> {
  const def = getObject(sec.objekt);
  const step: MigrationStep = { key: sec.objekt, label: resolveLabel(labelTable, def.labelPlural, lang), status: "ok", messages: [] };
  if (!cctx.modules.has(sec.objekt.split(".")[0])) {
    step.status = "error";
    step.messages.push(tr(lang, "@ORG:MigModuleOff"));
    return step;
  }
  try {
    const r = await importRecords(cctx, sec.objekt, toTable(sec.zaznamy, lang), { dryRun, lang, images }, client);
    step.created = r.created;
    step.updated = r.updated;
    if (r.missing.length) step.messages.push(tr(lang, "@ORG:MigMissing", { fields: r.missing.join(", ") }));
    for (const e of r.errors) step.messages.push(`${tr(lang, "@ORG:MigRow", { n: String(e.row - 1) })}${e.column ? ` · ${e.column}` : ""}: ${e.message}`);
    // varování (chybějící obrázky) jen prvních 10 — celý seznam je v kontrole souboru
    for (const w of r.warnings.slice(0, 10)) step.messages.push(`${tr(lang, "@ORG:MigRow", { n: String(w.row - 1) })}: ${w.message}`);
    if (r.warnings.length > 10) step.messages.push(tr(lang, "@ORG:MigMore", { n: String(r.warnings.length - 10) }));
    step.status = r.errors.length || r.missing.length ? "error" : r.warnings.length ? "warning" : "ok";
  } catch (e) {
    step.status = "error";
    step.messages.push(errorText(e, lang));
  }
  return step;
}

async function usersStep(
  cctx: Ctx,
  users: MigrationUser[],
  roleId: Map<string, string>,
  opts: { lang: Lang; invite?: Invite },
  client: PrismaClient,
): Promise<MigrationStep> {
  const t = (ref: string, p?: Record<string, string>) => tr(opts.lang, ref, p);
  const step: MigrationStep = { key: "users", label: t("@ORG:MigStepUsers"), status: "ok", created: 0, updated: 0, messages: [] };
  for (const u of users) {
    const found = await client.sysUser.findUnique({ where: { email: u.email } });
    if (found && found.tenantId !== cctx.tenantId) {
      step.status = "warning";
      step.messages.push(t("@ORG:MigUserOther", { email: u.email }));
      continue;
    }
    const firstName = (u.jmeno ?? found?.firstName ?? "").slice(0, 60);
    const lastName = (u.prijmeni ?? found?.lastName ?? "").slice(0, 60);
    const name = `${firstName} ${lastName}`.trim() || u.email;
    const roleIds = (u.role ?? []).map((r) => roleId.get(r.toUpperCase())).filter((x): x is string => !!x);
    const user = found
      ? await client.sysUser.update({ where: { id: found.id }, data: { firstName, lastName, name } })
      : await client.sysUser.create({ data: { tenantId: cctx.tenantId, email: u.email, name, firstName, lastName, role: "user", passwordHash: await bcrypt.hash(randomBytes(32).toString("base64url"), 12) } });
    // přiřazení k firmě: role a správce podle souboru (ostatní firmy uživatele beze změny)
    await client.sysUserCompany.deleteMany({ where: { userId: user.id, companyId: cctx.companyId! } });
    await client.sysUserCompany.create({ data: { userId: user.id, companyId: cctx.companyId!, tenantId: cctx.tenantId, admin: !!u.spravceFirmy, roleIds } });
    if (found) step.updated!++;
    else step.created!++;
    if (u.pozvat && !found && opts.invite) {
      try {
        const sent = await opts.invite(user.id);
        step.messages.push(t(sent ? "@ORG:MigInvited" : "@ORG:MigInviteNoMail", { email: u.email }));
      } catch (e) {
        step.status = "warning";
        step.messages.push(`${u.email}: ${errorText(e, opts.lang)}`);
      }
    }
  }
  return step;
}
