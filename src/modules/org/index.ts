/**
 * Organizace (obdoba Legal entities / Organization administration v D365):
 * údaje o firmě — obchodní jméno, IČO, DIČ, sídlo, kontakty, banka, zápis
 * v rejstříku — a její provozovny. Jeden zdroj pravdy pro doklady, účtenky,
 * přiznání a e-shop. Název, IČO a DIČ se propisují do firmy (sys.company).
 */
import { MAIL_DEFAULTS, MAIL_FIELDS } from "./mail-template";
import { aresByIco, aresNace, naceFields, splitPersonName } from "@/modules/gab/ares";
import { czDic, vatRegistryStatus, type VatPayerStatus } from "@/modules/gab/vat-registry";
import { createBankAccounts } from "@/modules/bank/registry-accounts";
import { withService } from "@/modules/int/services";
import { Edts, defineEdt, defineEnum, enumEdt } from "@/core/edt";
import { UserError, defineModule, type DataApi, type ObjectHandlers, type ValidationErrors } from "@/core/module";
import { defineObject } from "@/core/object";
import { isPublicSlug } from "@/lib/reserved-paths";

export const LegalForm = defineEnum({
  id: "OrgLegalForm",
  label: "@ORG:LegalForm",
  values: [
    { value: "legal", label: "@ORG:LegalPerson" },
    { value: "natural", label: "@ORG:NaturalPerson" },
  ],
});

const Str = (id: string, label: string, maxLength: number, pattern?: RegExp, patternMessage?: string) =>
  defineEdt({ id, kind: "string", label, maxLength, pattern, patternMessage, transform: "trim" });
/** číslo účtu: [předčíslí-]číslo/banka */
const BankAccount = Str("BankAccount", "@ORG:BankAccount", 30, /^(\d{1,6}-)?\d{2,10}\/\d{4}$/, "@ORG:BankAccountHelp");
const Iban = defineEdt({ id: "Iban", kind: "string", label: "@ORG:Iban", maxLength: 34, pattern: /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/, patternMessage: "@ORG:IbanHelp", transform: "upper" });
const Zip = Str("OrgZip", "@ORG:ZipCode", 10, /^\d{3}\s?\d{2}$|^[A-Z0-9 -]{3,10}$/);

const NATURAL = { field: "legalForm", in: ["natural"] };

/** Rejstříkové soudy (kód jako ve spisové značce „…/MSPH“). */
export const RegisterCourt = defineEnum({
  id: "OrgRegisterCourt",
  label: "@ORG:RegisterCourt",
  values: ["MSPH", "KSPH", "KSCB", "KSPL", "KSUL", "KSHK", "KSBR", "KSOS"].map((v) => ({ value: v, label: `@ORG:Court${v}` })),
});
/** Soud v 7. pádě pro text zápisu („vedeném Městským soudem v Praze“). */
const COURT_BY: Record<string, string> = {
  MSPH: "Městským soudem v Praze",
  KSPH: "Krajským soudem v Praze",
  KSCB: "Krajským soudem v Českých Budějovicích",
  KSPL: "Krajským soudem v Plzni",
  KSUL: "Krajským soudem v Ústí nad Labem",
  KSHK: "Krajským soudem v Hradci Králové",
  KSBR: "Krajským soudem v Brně",
  KSOS: "Krajským soudem v Ostravě",
};
const COURT_NAMES: [RegExp, string][] = [
  [/m[ěe]stsk\S* soud\S* v praze/i, "MSPH"],
  [/krajsk\S* soud\S* v praze/i, "KSPH"],
  [/[čc]esk\S* bud[ěe]jovic/i, "KSCB"],
  [/plzn/i, "KSPL"],
  [/[úu]st\S* nad labem/i, "KSUL"],
  [/hradc\S* kr[áa]lov/i, "KSHK"],
  [/brn/i, "KSBR"],
  [/ostrav/i, "KSOS"],
];
/** Rejstřík podle oddílu (A, B, C, Dr = obchodní; L spolkový; N nadační; U ústavů; O o. p. s.; S SVJ). */
const REGISTER_OF: Record<string, string> = {
  L: "ve spolkovém rejstříku",
  N: "v nadačním rejstříku",
  U: "v rejstříku ústavů",
  O: "v rejstříku obecně prospěšných společností",
  S: "v rejstříku společenství vlastníků jednotek",
};

/** „C 327865/MSPH Městský soud v Praze“ → { fileNumber: "C 327865", court: "MSPH" }; null = neplatná značka. */
export function parseFileNumber(raw: string): { fileNumber: string; court: string | null } | null {
  const m = /^\s*([A-Za-z]{1,2})\s*(\d{1,7})\s*(?:\/\s*([A-Za-z]{4}))?\s*(.*)$/.exec(raw);
  if (!m) return null;
  const section = m[1].length === 2 ? m[1][0].toUpperCase() + m[1][1].toLowerCase() : m[1].toUpperCase();
  let court = m[3] && COURT_BY[m[3].toUpperCase()] ? m[3].toUpperCase() : null;
  if (!court && m[4]) court = COURT_NAMES.find(([re]) => re.test(m[4]))?.[1] ?? null;
  return { fileNumber: `${section} ${m[2]}`, court };
}

/** Text zápisu na doklady: „Zapsáno v obchodním rejstříku vedeném Městským soudem v Praze, oddíl C, vložka 327865“. */
export function registrationText(fileNumber: string, court: string | null | undefined): string | null {
  const m = /^([A-Za-z]{1,2}) (\d+)$/.exec(fileNumber);
  if (!m || !court || !COURT_BY[court]) return null;
  return `Zapsáno ${REGISTER_OF[m[1]] ?? "v obchodním rejstříku"} vedeném ${COURT_BY[court]}, oddíl ${m[1]}, vložka ${m[2]}`;
}

export const entity = defineObject({
  id: "org.entity",
  table: "org_entity",
  label: "@ORG:Entity",
  labelPlural: "@ORG:Entity",
  scope: "company",
  fields: {
    legalName: { edt: Edts.Name, label: "@ORG:LegalName", mandatory: true },
    tradeName: { edt: Edts.Name, label: "@ORG:TradeName" },
    legalForm: { edt: enumEdt(LegalForm), mandatory: true, default: "legal" },
    firstName: { edt: Str("OrgFirstName", "@ORG:FirstName", 60), visibleWhen: NATURAL },
    lastName: { edt: Str("OrgLastName", "@ORG:LastName", 60), visibleWhen: NATURAL },
    regNo: { edt: Edts.RegNo },
    vatId: { edt: Edts.VatId },
    vatPayer: { edt: Edts.NoYes, label: "@ORG:VatPayer", default: true },
    // zápis ve veřejném rejstříku: spisová značka (oddíl + vložka) a rejstříkový soud → text na dokladech
    fileNumber: { edt: Str("OrgFileNumber", "@ORG:FileNumber", 60), help: "@ORG:FileNumberHelp" },
    registerCourt: { edt: enumEdt(RegisterCourt), help: "@ORG:RegisterCourtHelp" },
    registration: { edt: Edts.Description, label: "@ORG:Registration", help: "@ORG:RegistrationHelp" },
    // činnost podle CZ-NACE z Registru ekonomických subjektů (Doplnit z ARES)
    naceCode: { edt: Str("OrgNaceCode", "@ORG:NaceCode", 6, /^\d{2,6}$/), help: "@ORG:NaceHelp" },
    naceName: { edt: Edts.Description, label: "@ORG:NaceName" },
    naceOther: { edt: Edts.Notes, label: "@ORG:NaceOther" },
    street: { edt: Str("OrgStreet", "@ORG:Street", 120) },
    houseNo: { edt: Str("OrgHouseNo", "@ORG:HouseNo", 10) },
    orientNo: { edt: Str("OrgOrientNo", "@ORG:OrientNo", 10) },
    city: { edt: Str("OrgCity", "@ORG:City", 80) },
    zipCode: { edt: Zip },
    country: { edt: Edts.CountryCode, mandatory: true, default: "CZ" },
    email: { edt: Edts.Email },
    phone: { edt: Edts.Phone },
    web: { edt: Str("OrgWeb", "@ORG:Web", 200) },
    dataBoxId: { edt: Str("OrgDataBox", "@ORG:DataBoxId", 7, /^[a-z0-9]{7}$/i) },
    bankAccount: { edt: BankAccount },
    iban: { edt: Iban },
    bic: { edt: Str("OrgBic", "@ORG:Bic", 11, /^[A-Z0-9]{8}([A-Z0-9]{3})?$/) },
    /** zkratka pro veřejné odkazy (dodavatelský portál /<zkratka>/doklady) — jedinečná v celé aplikaci */
    publicSlug: { edt: defineEdt({ id: "OrgPublicSlug", kind: "string", label: "@ORG:PublicSlug", maxLength: 40, pattern: /^[a-z0-9][a-z0-9-]{1,39}$/, patternMessage: "@ORG:PublicSlugHelp", transform: "lower" }) },
    // logo na tiskových sestavách (faktura, účtenka)
    logo: { edt: Str("OrgLogo", "@ORG:Logo", 36), image: true, readOnly: true, help: "@ORG:LogoHelp" },
    // šablona e-mailu dokladů (src/modules/org/mail-template.ts): předmět a text s proměnnými, podpis
    mailInvoiceSubject: { edt: Edts.Description, label: "@ORG:MailInvoiceSubject", help: "@ORG:MailVarsHelp" },
    mailInvoiceBody: { edt: Edts.Notes, label: "@ORG:MailInvoiceBody" },
    mailAdvanceSubject: { edt: Edts.Description, label: "@ORG:MailAdvanceSubject" },
    mailAdvanceBody: { edt: Edts.Notes, label: "@ORG:MailAdvanceBody" },
    mailReceiptSubject: { edt: Edts.Description, label: "@ORG:MailReceiptSubject" },
    mailReceiptBody: { edt: Edts.Notes, label: "@ORG:MailReceiptBody" },
    mailSignature: { edt: Edts.Notes, label: "@ORG:MailSignature", help: "@ORG:MailSignatureHelp" },
  },
  titleField: "legalName",
  list: ["legalName", "regNo", "vatId", "city", "email", "phone"],
  actions: [
    { id: "ares", label: "@ORG:FromAres" },
    // neplátce DPH: jen kódy bez DPH, nepoužité kódy smazat (obsluha v modulu DPH)
    { id: "simplifyVat", label: "@ORG:SimplifyVat", module: "tax", group: "more" as const, when: { field: "vatPayer", equals: false } },
  ],
  form: [
    { label: "@ORG:Identity", fields: ["legalName", "tradeName", "legalForm", "firstName", "lastName", "regNo", "vatId", "vatPayer", "fileNumber", "registerCourt", "registration"] },
    { label: "@ORG:Activity", fields: ["naceCode", "naceName", "naceOther"] },
    { label: "@ORG:Address", fields: ["street", "houseNo", "orientNo", "city", "zipCode", "country"] },
    { label: "@ORG:Contacts", fields: ["email", "phone", "web", "dataBoxId", "publicSlug"] },
    { label: "@ORG:Bank", fields: ["bankAccount", "iban", "bic"] },
    { label: "@ORG:Logo", fields: ["logo"] },
    { label: "@ORG:MailTemplate", fields: ["mailInvoiceSubject", "mailInvoiceBody", "mailAdvanceSubject", "mailAdvanceBody", "mailReceiptSubject", "mailReceiptBody", "mailSignature"] },
  ],
});

export const site = defineObject({
  id: "org.site",
  table: "org_site",
  label: "@ORG:Site",
  labelPlural: "@ORG:Sites",
  scope: "company",
  fields: {
    code: { edt: Edts.Code, mandatory: true },
    name: { edt: Edts.Name, mandatory: true },
    street: { edt: Str("OrgStreet", "@ORG:Street", 120) },
    houseNo: { edt: Str("OrgHouseNo", "@ORG:HouseNo", 10) },
    orientNo: { edt: Str("OrgOrientNo", "@ORG:OrientNo", 10) },
    city: { edt: Str("OrgCity", "@ORG:City", 80) },
    zipCode: { edt: Zip },
    phone: { edt: Edts.Phone },
    openingHours: { edt: Edts.Description, label: "@ORG:OpeningHours" },
    blocked: { edt: Edts.NoYes, label: "@GL:Blocked" },
  },
  titleField: "code",
  list: ["code", "name", "street", "city", "phone", "blocked"],
  form: [
    { label: "@SYS:General", fields: ["code", "name", "phone", "openingHours", "blocked"] },
    { label: "@ORG:Address", fields: ["street", "houseNo", "orientNo", "city", "zipCode"] },
  ],
  unique: [["code"]],
  defaultSort: { field: "code", dir: "asc" },
});

/** Adresa organizace jedním řádkem (účtenky, doklady). */
export function addressLine(o: Record<string, unknown> | null | undefined): string | null {
  if (!o) return null;
  const num = [o.houseNo, o.orientNo].filter(Boolean).join("/");
  const a = [`${o.street ?? ""} ${num}`.trim(), `${o.zipCode ?? ""} ${o.city ?? ""}`.trim()].filter(Boolean).join(", ");
  return a || null;
}

/** Údaje organizace aktuální firmy (null, když modul nebo záznam chybí). */
export async function orgOf(data: DataApi) {
  try {
    return (await data.find("org.entity", {}, { take: 1 }))[0] ?? null;
  } catch {
    return null; // modul Organizace není zapnutý
  }
}

/** Výchozí záznam z údajů firmy (a daňových parametrů), aby organizace nebyla prázdná. */
async function orgSetup(data: DataApi) {
  if (!data.companyId) return;
  const [have] = await data.find("org.entity", {}, { take: 1 });
  if (have) {
    // výchozí šablona e-mailu dokladů — jen prázdná pole (úpravy organizace zůstanou)
    const fill: Record<string, string> = {};
    for (const k of ["invoice", "advance", "receipt"] as const) {
      if (!have[MAIL_FIELDS[k].subject]) fill[MAIL_FIELDS[k].subject] = MAIL_DEFAULTS[k].subject;
      if (!have[MAIL_FIELDS[k].body]) fill[MAIL_FIELDS[k].body] = MAIL_DEFAULTS[k].body;
    }
    if (!have.mailSignature) fill.mailSignature = MAIL_DEFAULTS.signature;
    if (Object.keys(fill).length) await data.update("org.entity", String(have.id), fill);
    return;
  }
  const c = await data.get("sys.company", data.companyId);
  if (!c) return;
  let tp: Record<string, unknown> | undefined;
  try {
    tp = (await data.find("tax.parameters", {}, { take: 1 }))[0];
  } catch {
    tp = undefined; // DPH není zapnuté
  }
  await data.create("org.entity", {
    mailInvoiceSubject: MAIL_DEFAULTS.invoice.subject,
    mailInvoiceBody: MAIL_DEFAULTS.invoice.body,
    mailAdvanceSubject: MAIL_DEFAULTS.advance.subject,
    mailAdvanceBody: MAIL_DEFAULTS.advance.body,
    mailReceiptSubject: MAIL_DEFAULTS.receipt.subject,
    mailReceiptBody: MAIL_DEFAULTS.receipt.body,
    mailSignature: MAIL_DEFAULTS.signature,
    legalName: c.name,
    legalForm: tp?.subjectType === "F" ? "natural" : "legal",
    firstName: tp?.firstName ?? null,
    lastName: tp?.lastName ?? null,
    regNo: c.regNo ?? null,
    vatId: c.vatId ?? null,
    vatPayer: c.vatPayer ?? true,
    country: c.country ?? "CZ",
    street: tp?.street ?? null,
    houseNo: tp?.houseNo ?? null,
    orientNo: tp?.orientNo ?? null,
    city: tp?.city ?? null,
    zipCode: tp?.zipCode ?? null,
    email: tp?.email ?? null,
    phone: tp?.phone ?? null,
    dataBoxId: tp?.dataBoxId ?? null,
  });
}

export const orgHandlers: Record<string, ObjectHandlers> = {
  "org.entity": {
    actions: {
      /**
       * údaje firmy z ARES podle IČO (jméno, forma, DIČ, sídlo, CZ-NACE) a z registru plátců DPH (plátce, finanční
       * úřad, zveřejněné bankovní účty → modul Banka); kontakty zůstanou, bankovní účet organizace jen když chybí
       */
      async ares(ctx, rec) {
        if (!rec.regNo) throw new UserError("@ORG:RegNoFirst");
        const a = await aresByIco(String(rec.regNo), ctx.data);
        if (!a) throw new UserError("@ORG:AresNotFound");
        const { firstName: first, lastName: last } = splitPersonName(a.name);
        const nace = await aresNace(a.ico, ctx.data).catch(() => null);
        // plátce DPH rozhoduje registr plátců (DIČ má i identifikovaná osoba); výpadek registru = jen podle DIČ
        const dic = a.country === "CZ" ? czDic(a.vatId) : null;
        let vat: VatPayerStatus | null | undefined;
        if (dic) vat = await withService(ctx.data, "dphreg", "dphreg.status", () => vatRegistryStatus([dic]), (m) => `${dic}: ${m.get(dic)?.reliability ?? "notFound"}`)
          .then((m) => m.get(dic) ?? null)
          .catch(() => undefined);
        const vatPayer = vat === undefined ? (a.vatId ? true : rec.vatPayer) : !!vat && vat.reliability !== "notFound";
        const published = vat?.accounts ?? [];
        await ctx.data.update("org.entity", String(rec.id), {
          legalName: a.name,
          legalForm: a.person ? "natural" : "legal",
          firstName: a.person ? (rec.firstName ?? first) : rec.firstName,
          lastName: a.person ? (rec.lastName ?? last) : rec.lastName,
          regNo: a.ico,
          vatId: a.vatId ?? rec.vatId ?? null,
          vatPayer,
          street: a.streetName,
          houseNo: a.houseNo,
          orientNo: a.orientNo,
          city: a.city,
          zipCode: a.zipCode,
          country: a.country,
          // spisová značka z ARES (veřejný rejstřík), jen když chybí — beforeSave ji rozloží a sestaví text
          ...(a.fileRef && !rec.fileNumber ? { fileNumber: a.fileRef } : {}),
          ...(nace ? naceFields(nace) : {}),
          ...(!rec.bankAccount && published.find((x) => x.accountNum) ? { bankAccount: published.find((x) => x.accountNum)!.accountNum } : {}),
        });
        // finanční úřad do daňových parametrů (jen když chybí) a zveřejněné účty do Banky
        if (vat?.taxOffice && ctx.modules?.has("tax")) {
          const [tp] = await ctx.data.find("tax.parameters", {}, { take: 1 });
          if (!tp) await ctx.data.create("tax.parameters", { taxOfficeCode: vat.taxOffice, subjectType: a.person ? "F" : "P" });
          else if (!tp.taxOfficeCode) await ctx.data.update("tax.parameters", String(tp.id), { taxOfficeCode: vat.taxOffice });
        }
        if (published.length && ctx.modules?.has("bank")) await createBankAccounts(ctx.data, published);
      },
    },
    async beforeSave(ctx, d, isNew): Promise<ValidationErrors | void> {
      if (isNew && (await ctx.data.find("org.entity", {}, { take: 1 })).length) throw new UserError("@ORG:OneEntity");
      // spisová značka: „C 327865/MSPH Městský soud v Praze“ → C 327865 + soud; text zápisu na doklady
      if (d.fileNumber) {
        const fr = parseFileNumber(String(d.fileNumber));
        if (!fr) return { fileNumber: "@ORG:FileNumberInvalid" };
        const before = !isNew && d.id ? await ctx.data.get("org.entity", String(d.id)) : null;
        d.fileNumber = fr.fileNumber;
        if (fr.court && (!d.registerCourt || before?.fileNumber !== d.fileNumber)) d.registerCourt = fr.court;
        const text = registrationText(fr.fileNumber, d.registerCourt as string | null);
        const oldText = before?.fileNumber ? registrationText(String(before.fileNumber), before.registerCourt as string | null) : null;
        // text se přepíše, jen když ho uživatel nezměnil ručně (prázdný nebo dřív sestavený)
        if (text && (!d.registration || d.registration === oldText)) d.registration = text;
      }
      if (d.legalForm === "natural" && (!d.firstName || !d.lastName)) return { [d.firstName ? "lastName" : "firstName"]: "@SYS:Required" };
      if (d.publicSlug) d.publicSlug = String(d.publicSlug).trim().toLowerCase();
      if (d.publicSlug && !isPublicSlug(String(d.publicSlug))) return { publicSlug: "@ORG:PublicSlugHelp" };
    },
    // název, IČO a DIČ jsou i ve firmě (přepínač firem, výběr firmy, oprávnění)
    async afterSave(ctx, d) {
      if (!ctx.companyId) return;
      await ctx.data.update("sys.company", ctx.companyId, {
        name: d.tradeName || d.legalName,
        regNo: d.regNo ?? null,
        vatId: d.vatId ?? null,
        vatPayer: !!d.vatPayer,
        country: d.country ?? "CZ",
      });
      // zkratka pro veřejné odkazy je jedinečná v celé aplikaci (všichni zákazníci); odkazy portálů se přepočítají
      const slug = (d.publicSlug as string) || null;
      if (ctx.data.claimGlobalKey && !(await ctx.data.claimGlobalKey("entity", slug, String(d.id))))
        throw new UserError("@ORG:SlugTaken", { slug: String(slug) }, { publicSlug: "@ORG:SlugTaken" });
      if (ctx.modules && !ctx.modules.has("int")) return;
      for (const p of await ctx.data.find("int.portal", {}, { take: 100 }).catch(() => [])) await ctx.data.update("int.portal", String(p.id), {});
    },
  },
};

export default defineModule({
  id: "org",
  starter: true,
  label: "@ORG:Module",
  description: "@ORG:ModuleDesc",
  icon: "Building",
  dependsOn: ["sys"],
  enums: [LegalForm, RegisterCourt],
  objects: [entity, site],
  menu: [
    { label: "@ORG:Module", items: [{ object: "org.entity" }, { object: "org.site" }] },
    // zakládá firmu → jen superuživatel (stránky /system/… hlídá menu)
    { label: "@ORG:Functions", kind: "functions", items: [{ href: "/system/company-lookup", label: "@ORG:CompanyLookup" }, { href: "/system/migrace", label: "@ORG:Migration" }] },
  ],
  setup: orgSetup,
  labels: {
    cs: {
      Logo: "Logo",
      LogoHelp: "Doporučeno: PNG s průhledným pozadím, na šířku v poměru asi 3 : 1, např. 900 × 300 px. Tiskne se na faktuře (55 × 20 mm), na účtence (40 × 12 mm; termotiskárna tiskne černobíle – volte kontrastní logo) a v hlavičce aplikace (výška 32 px).",
      MailTemplate: "Šablona e-mailu dokladů",
      MailInvoiceSubject: "Faktura – předmět",
      MailInvoiceBody: "Faktura – text",
      MailAdvanceSubject: "Zálohová faktura – předmět",
      MailAdvanceBody: "Zálohová faktura – text",
      MailReceiptSubject: "Účtenka – předmět",
      MailReceiptBody: "Účtenka – text",
      MailSignature: "Podpis",
      MailVarsHelp: "Proměnné: {num} číslo, {amount} částka, {currency} měna, {due} splatnost, {company} firma, {customer} odběratel.",
      MailSignatureHelp: "Pod každým e-mailem; kontakty organizace (adresa, telefon, web) se doplní samy.",
      CompanyExists: "Firma se stejným IČO / DIČ už existuje.",
      CompanyLookup: "Založit firmu podle IČO / DIČ",
      CompanyLookupDesc: "Nová účtovaná firma z ARES (české IČO) nebo VIES (zahraniční DIČ): údaje organizace se sídlem a výchozí nastavení zapnutých modulů (účty, řady, DPH…). Kód firmy = zkratka z názvu (4 znaky, jedinečná), lze změnit.",
      CompanyCreate: "Založit firmu",
      Functions: "Funkce",
      Module: "Organizace",
      ModuleDesc: "Údaje o firmě (IČO, DIČ, sídlo, kontakty, banka) a provozovny — pro doklady, účtenky, přiznání i e-shop.",
      Entity: "Údaje organizace",
      LegalName: "Obchodní jméno",
      TradeName: "Zkrácený název",
      LegalForm: "Právní forma",
      LegalPerson: "Právnická osoba",
      NaturalPerson: "Fyzická osoba (OSVČ)",
      FirstName: "Jméno",
      LastName: "Příjmení",
      VatPayer: "Plátce DPH",
      Registration: "Zápis v rejstříku (text na dokladech)",
      Activity: "Činnost (CZ-NACE)",
      Migration: "Migrace firmy",
      MigDesc: "Založení nebo doplnění firmy z jednoho souboru JSON: firma z ARES, moduly, organizace s logem, sortiment, partneři, zaměstnanci a uživatelé. Soubor neobsahuje doklady, hesla ani tajné údaje.",
      MigTemplate: "Stáhnout prázdnou šablonu",
      MigExport: "Exportovat konfiguraci této firmy",
      MigExportTitle: "Export konfigurace",
      MigExportTest: "Pro testovací provoz",
      MigExportTestDesc: "Včetně testovacích napojení (TEST-EET, TEST-MAIL…). Ostrá napojení zůstanou, jak jsou — na testovacím serveru se stejně nepoužijí.",
      MigExportProd: "Pro ostrý provoz",
      MigExportProdDesc: "Bez testovacích napojení, ostrá napojení zapnutá. Doklady, hesla ani certifikáty soubor neobsahuje — certifikát EET a hesla zadáte u napojení po migraci.",
      MigDownload: "Stáhnout",
      MigObjConnection: "Napojení (Integrace): ostrá i testovací v jednom souboru. Kód TEST-… = testovací (na produkci se nezaloží). Na testovacím serveru se ostrá napojení nepoužijí a k ostrému EET a poště se založí testovací protějšek. Certifikát EET a hesla soubor neobsahuje — po migraci je doplňte u napojení. Veřejné služby (ARES, ČNB) zakládá výchozí nastavení, napojení API se nemigrují.",
      MigConnSkipped: "Vynecháno napojení: {n} (testovací na produkci, veřejné služby, API).",
      MigConnCert: "Napojení {code}: nahrajte certifikát EET (.p12) a heslo (Integrace → Napojení → Nahrát certifikát).",
      MigConnSecret: "Napojení {code}: doplňte heslo nebo klíč (soubor tajné údaje neobsahuje).",
      MigConnTest: "Založeno testovací napojení {code} (testovací server).",
      MigConnLiveOnTest: "Testovací server: ostrá napojení {codes} se nepoužijí, dokud u nich nepovolíte ostrý provoz na testovacím serveru.",
      MigFile: "Soubor migrace (JSON)",
      MigImages: "Složka s obrázky a logem",
      MigImagesCount: "Vybráno souborů: {n}",
      MigCheck: "Zkontrolovat",
      MigRun: "Spustit migraci",
      MigRunConfirm: "Spustit migraci firmy s IČO {ico}? Firma se založí (nebo aktualizuje) a importují se všechny části souboru.",
      MigOpenCompany: "Přepnout na firmu",
      MigCreated: "založeno {n}",
      MigUpdated: "upraveno {n}",
      MigNoteGeneral: "Migrační soubor Shanonu: jednorázové založení firmy s nastavením a číselníky.\nVyplňte firma.ico (založí se z ARES; sídlo, DIČ, plátce DPH, finanční úřad, CZ-NACE a bankovní účty z registru plátců DPH se doplní samy).\nmoduly = seznam kódů z dostupneModuly (závislosti se zapnou samy). Hlavní kniha (gl) zakládá finanční dimenzi Partner — každý subjekt adresáře (dodavatel, odběratel) dostane hodnotu P00001… automaticky.\ndata = agendy v pořadí, ve kterém se zakládají. Do zaznamy patří objekty s klíči z pole (technické názvy polí). Odkazy se zadávají kódem cílového záznamu (skupina, MJ, kategorie, daňový kód…).\nČísla jako čísla (2118.5), ano/ne jako true/false, datum RRRR-MM-DD. Prázdné části vynechte nebo nechte zaznamy prázdné.\nKlíče pokyny, pole, nazev, modul, dostupneModuly a vzor* se při importu ignorují.\nOpakované spuštění záznamy aktualizuje podle klíče (číslo položky, kód, IČO) — nic se nezdvojí ani nesmaže.\nNejdřív Zkontrolovat, potom Spustit migraci. Hotovou firmu lze vyexportovat zpět do stejného formátu (např. z TESTu pro PROD).",
      MigNoteCompany: "IČO firmy (8 číslic). Firma se založí z ARES, existuje-li, údaje se obnoví z registrů.",
      MigNoteOrg: "Údaje, které registry neznají. logo = název souboru ve složce obrázků (PNG/JPG, do 2 MB).",
      MigNoteModules: "Kódy modulů k zapnutí, např. [\"gl\", \"tax\", \"ar\", \"ap\", \"bank\", \"inv\", \"pos\", \"shop\", \"hr\"]. Výchozí nastavení modulů (účtový rozvrh, daňové kódy Z21/V21/P21, jednotky KS/KG…, skupiny ZBOZI/SLUZBY) se založí samo.",
      MigNoteImages: "Název složky s obrázky položek a logem. Při importu ji vyberte v dialogu; v záznamech pište cestu jako obrazky/KE1.jpg (páruje se podle konce cesty nebo názvu souboru).",
      MigNoteUsers: "Uživatelé firmy: email, jmeno, prijmeni, role (kódy rolí, např. POKLADNIK, PRACOVNIK), spravceFirmy (true = spravuje firmu), pozvat (true = po založení pošle pozvánku e-mailem). Hesla se nezadávají.",
      MigObjUnit: "Jen vlastní jednotky navíc — KS, KG, G, L, BAL, HOD, NEURC už existují.",
      MigObjPaymentTerm: "Platební podmínky navíc (výchozí 0 Ihned, 14 a 30 dní existují). Kód = počet dní.",
      MigObjItemGroup: "Účetní a daňové nastavení sortimentu. itemTaxGroupId = položka DPH (plátce: Z21 zboží 21 %, Z12 zboží 12 %, S21 služby 21 %, S12 služby 12 %, OSV, MIMO; neplátce BEZ) — daňový kód na dokladu dá kombinace se skupinou DPH partnera, v pokladně a e-shopu s Tuzemskem. Účty 604000 / 504000 (zboží), 602000 / 518000 (služby).",
      MigObjCategory: "Strom kategorií pro pokladnu a e-shop. parentId = kód nadřazené (musí být v souboru výš). eshop = zobrazit v e-shopu.",
      MigObjItem: "Položky. groupId, unitId, categoryId = kódy. itemTaxGroupId jen výjimka (např. Z12 ve skupině 21 %). priceInclTax true = prodejní cena s DPH. eshop true = položka v e-shopu. image = cesta k obrázku ve složce obrázků. brand = výrobce (není dodavatel), vendorId = kód nebo IČO dodavatele.",
      MigObjVendor: "Dodavatelé: stačí regNo (IČO) — subjekt, sídlo, DIČ, spolehlivost plátce a účty se doplní z ARES a registru DPH, dimenze Partner automaticky. accountNum prázdné = číslo z řady.",
      MigObjCustomer: "Odběratelé: stačí regNo (IČO), jako u dodavatelů.",
      MigObjEmployee: "Zaměstnanci: personalNum (osobní číslo, jedno napříč firmami), firstName, lastName, email (pozvánka do portálu), position.",
      MigObjSite: "Provozovny (prodejny, sklady): kód, název, adresa, otevírací doba.",
      MigObjBankAccount: "Jen účty, které nejsou zveřejněné v registru DPH (zveřejněné se založí samy). accountNum ve tvaru 123456789/0100.",
      MigFieldMandatory: "povinné",
      MigFieldNumberSeq: "prázdné = číslo z řady",
      MigFieldKey: "klíč (opakování záznam aktualizuje)",
      MigFieldImage: "cesta k souboru ve složce obrázků",
      MigFieldLogo: "Logo · cesta k souboru ve složce obrázků (PNG/JPG, do 2 MB)",
      MigFieldRef: "kód z: {target}",
      MigFieldEnum: "hodnoty: {values}",
      MigFieldNumber: "číslo",
      MigFieldDate: "datum RRRR-MM-DD",
      MigFieldMax: "text do {n} znaků",
      MigFieldDefault: "výchozí {value}",
      MigFieldModule: "jen s modulem {module}",
      MigFormat: "Soubor není migrační soubor Shanonu (format „shanon-migrace“).",
      MigIco: "Vyplňte platné IČO firmy (firma.ico, 8 číslic).",
      MigModule: "Neznámý modul „{id}“ — použijte kód z dostupneModuly.",
      MigObject: "Agenda „{id}“ se migrací nezakládá.",
      MigField: "{object}: neznámé pole „{field}“ se nenaimportuje.",
      MigModuleMissing: "{object}: modul {module} není mezi moduly k zapnutí.",
      MigModuleLater: "Modul {module} se zapne při spuštění — agenda se zkontroluje až potom.",
      MigModuleOff: "Modul agendy není ve firmě zapnutý — přidejte ho do moduly.",
      MigImage: "Obrázek {path} není ve vybrané složce.",
      MigRole: "Uživatel {email}: role „{role}“ neexistuje.",
      MigEmail: "Neplatný e-mail uživatele „{email}“.",
      MigUserOther: "Uživatel {email} je už v jiné organizaci — nepřiřazen.",
      MigRefsLater: "Firma s tímto IČO zatím neexistuje — odkazy agend (skupiny, MJ, daňové kódy) se ověří až při spuštění.",
      MigStepCheck: "Kontrola souboru",
      MigStepCompany: "Firma z ARES",
      MigStepModules: "Moduly a výchozí nastavení",
      MigStepOrg: "Organizace, DPH, bankovní účty a dimenze Partner",
      MigStepUsers: "Uživatelé",
      MigStepShop: "E-shop",
      MigImgItem: "Položka (pokladna i e-shop): čtverec 1:1, ideálně 800×800 px (aspoň 400×400), bílé nebo průhledné pozadí, výrobek uprostřed s okrajem asi 5 %, JPG / WebP / PNG do 2 MB. Stejný obrázek je na dlaždici pokladny, v katalogu i v detailu e-shopu.",
      MigImgCategory: "Kategorie (e-shop): na šířku 4:3, ideálně 800×600 px (aspoň 600×450), JPG / WebP do 2 MB.",
      MigImgLogo: "Logo: PNG s průhledným pozadím (nebo WebP), na výšku aspoň 80 px, ideálně 400–600 px na šířku, poměr stran od 0,8:1 do 5:1, ořezané těsně kolem loga, do 500 kB. Na účtence se tiskne černobíle — musí být čitelné i v odstínech šedi.",
      MigImgHero: "Úvodní obrázek e-shopu podle heroStyle: split (vedle textu) = 16:9, ideálně 1920×1080 px; cover (přes celou šířku s nadpisem) a banner = 3:1, ideálně 1920×640 px (aspoň 1200×400). JPG / WebP do 1 MB. Hlavní motiv uprostřed — okraje se na mobilu ořezávají; u cover nechte levou třetinu klidnější (je přes ni text). Bez textu v obrázku (nadpis a úvod se píší zvlášť).",
      MigImgSmall: "{path}: {size} — menší než doporučených {min}, na displeji bude rozmazaný.",
      MigImgRatio: "{path}: {size} — jiný poměr stran než doporučený {ratio}, obrázek se ořízne nebo bude mít okraje.",
      MigNoteShop: "E-shop firmy (modul shop): name, active (true = zveřejnit), layout, accentColor a accent2Color (#rrggbb — hlavní barva tlačítek a druhá barva přechodu, vezměte z loga / webu firmy, bílý text musí být čitelný), heroStyle (split / cover / banner / none), heroAnimation (none / fade / zoom), headline, intro, kontakty, minOrder, freeShippingFrom, vyzvednutí. logo a heroImage = soubory ve složce obrázků. Adresa obchodu = zkratka organizace (organizace.publicSlug). Položky a kategorie se do obchodu dostanou příznakem eshop.",
      MigShopMissing: "E-shop ve firmě není — zapněte modul shop (založí se s odběratelem pro e-shop).",
      MigShopPublished: "Obchod je zveřejněný: {url}",
      MigShopHidden: "Obchod je připravený, ale nezveřejněný ({url}) — active: true ho zveřejní.",
      MigCompanyCreated: "Založena firma s IČO {ico}.",
      MigCompanyUpdated: "Firma s IČO {ico} už existuje — údaje obnoveny z registrů.",
      MigModulesAdded: "Zapnuto: {list}",
      MigMissing: "V záznamech chybí povinná pole: {fields}",
      MigRow: "Záznam {n}",
      MigMore: "… a dalších {n}",
      MigInvited: "Pozvánka odeslána: {email}",
      MigInviteNoMail: "Pozvánka pro {email} neodešla — systémová pošta není nastavená.",
      NaceCode: "Převažující činnost",
      NaceName: "Název činnosti",
      NaceOther: "Další činnosti",
      NaceHelp: "Kód CZ-NACE z Registru ekonomických subjektů — doplní akce Doplnit z ARES.",
      RegistrationHelp: "Sestaví se sám ze spisové značky a soudu. Jiný zápis (živnostenský rejstřík…) napište ručně, např. „Podnikatel zapsaný v živnostenském rejstříku.“",
      FileNumber: "Spisová značka",
      FileNumberHelp: "Oddíl a vložka, např. C 327865 (s.r.o. = C, a.s. = B, družstvo = Dr, spolek = L). Lze vložit i celou značku z rejstříku „C 327865/MSPH Městský soud v Praze“ — soud se doplní sám.",
      FileNumberInvalid: "Spisová značka je oddíl a číslo vložky, např. C 327865.",
      RegisterCourt: "Rejstříkový soud",
      RegisterCourtHelp: "Soud, který rejstřík vede (je ve výpisu z obchodního rejstříku).",
      CourtMSPH: "Městský soud v Praze",
      CourtKSPH: "Krajský soud v Praze",
      CourtKSCB: "Krajský soud v Českých Budějovicích",
      CourtKSPL: "Krajský soud v Plzni",
      CourtKSUL: "Krajský soud v Ústí nad Labem",
      CourtKSHK: "Krajský soud v Hradci Králové",
      CourtKSBR: "Krajský soud v Brně",
      CourtKSOS: "Krajský soud v Ostravě",
      Identity: "Identifikace",
      Address: "Sídlo",
      Street: "Ulice",
      HouseNo: "Číslo popisné",
      OrientNo: "Číslo orientační",
      City: "Obec",
      ZipCode: "PSČ",
      Contacts: "Kontakty",
      PublicSlug: "Zkratka pro veřejné odkazy",
      PublicSlugHelp: "Malá písmena, číslice a pomlčka (např. kral).",
      SlugTaken: "Zkratka „{slug}“ je obsazená nebo vyhrazená — zvolte jinou.",
      Web: "Web",
      DataBoxId: "Datová schránka",
      Bank: "Bankovní spojení",
      BankAccount: "Číslo účtu",
      BankAccountHelp: "Ve tvaru [předčíslí-]číslo/kód banky, např. 19-2000145399/0800.",
      Iban: "IBAN",
      IbanHelp: "IBAN bez mezer, např. CZ6508000000192000145399.",
      Bic: "BIC (SWIFT)",
      Site: "Provozovna",
      Sites: "Provozovny",
      OpeningHours: "Otevírací doba",
      FromAres: "Doplnit z ARES",
      SimplifyVat: "Zjednodušit DPH pro neplátce",
      RegNoFirst: "Vyplňte a uložte IČO, pak doplňte z ARES.",
      AresNotFound: "IČO v ARES nenalezeno.",
      OneEntity: "Firma už údaje organizace má — upravte stávající záznam.",
    },
    en: {
      Logo: "Logo",
      LogoHelp: "Recommended: PNG with a transparent background, landscape about 3 : 1, e.g. 900 × 300 px. Printed on invoices (55 × 20 mm), receipts (40 × 12 mm; thermal printers print black and white – use a high-contrast logo) and in the app header (32 px high).",
      MailTemplate: "Document e-mail template",
      MailInvoiceSubject: "Invoice – subject",
      MailInvoiceBody: "Invoice – text",
      MailAdvanceSubject: "Advance invoice – subject",
      MailAdvanceBody: "Advance invoice – text",
      MailReceiptSubject: "Receipt – subject",
      MailReceiptBody: "Receipt – text",
      MailSignature: "Signature",
      MailVarsHelp: "Variables: {num} number, {amount} amount, {currency} currency, {due} due date, {company} company, {customer} customer.",
      MailSignatureHelp: "Below every e-mail; the organization's contacts (address, phone, web) are added automatically.",
      CompanyExists: "A company with the same ID / VAT ID already exists.",
      CompanyLookup: "Create company by ID / VAT ID",
      CompanyLookupDesc: "A new accounting company from ARES (Czech ID) or VIES (foreign VAT ID): organization details with registered address and default setup of enabled modules (accounts, sequences, VAT…). Company code = abbreviation of the name (4 characters, unique), can be changed.",
      CompanyCreate: "Create company",
      Functions: "Functions",
      Module: "Organization",
      ModuleDesc: "Company details (registration and VAT numbers, address, contacts, bank) and sites — for documents, receipts, returns and e-shop.",
      Entity: "Organization details",
      LegalName: "Legal name",
      TradeName: "Short name",
      LegalForm: "Legal form",
      LegalPerson: "Legal person",
      NaturalPerson: "Natural person (sole trader)",
      FirstName: "First name",
      LastName: "Last name",
      VatPayer: "VAT payer",
      Registration: "Register entry (text on documents)",
      Activity: "Activity (CZ-NACE)",
      Migration: "Company migration",
      MigDesc: "Create or complete a company from one JSON file: company from ARES, modules, organisation with logo, products, partners, employees and users. The file never contains documents, passwords or secrets.",
      MigTemplate: "Download empty template",
      MigExport: "Export this company's configuration",
      MigExportTitle: "Export configuration",
      MigExportTest: "For test operation",
      MigExportTestDesc: "Including test connections (TEST-EET, TEST-MAIL…). Live connections stay as they are — the test server does not use them anyway.",
      MigExportProd: "For live operation",
      MigExportProdDesc: "Without test connections, live connections switched on. The file contains no documents, passwords or certificates — enter the EET certificate and passwords on the connection after the migration.",
      MigDownload: "Download",
      MigObjConnection: "Connections (Integration): live and test in one file. Code TEST-… = test (not created in production). On the test server live connections are not used and a test counterpart is created for live EET and mail. The file contains no EET certificate or passwords — add them on the connection after the migration. Public services (ARES, CNB) are created by the default setup, API connections are not migrated.",
      MigConnSkipped: "Connections left out: {n} (test ones in production, public services, API).",
      MigConnCert: "Connection {code}: upload the EET certificate (.p12) and password (Integration → Connections → Upload certificate).",
      MigConnSecret: "Connection {code}: fill in the password or key (the file contains no secrets).",
      MigConnTest: "Test connection {code} created (test server).",
      MigConnLiveOnTest: "Test server: live connections {codes} are not used until you allow live operation on the test server for them.",
      MigFile: "Migration file (JSON)",
      MigImages: "Folder with images and logo",
      MigImagesCount: "Files selected: {n}",
      MigCheck: "Check",
      MigRun: "Run migration",
      MigRunConfirm: "Run the migration of company {ico}? The company is created (or updated) and all parts of the file are imported.",
      MigOpenCompany: "Switch to company",
      MigCreated: "created {n}",
      MigUpdated: "updated {n}",
      MigNoteGeneral: "Shanon migration file: one-off creation of a company with settings and code lists.\nFill in firma.ico (created from ARES; address, VAT ID, VAT payer, tax office, CZ-NACE and bank accounts from the VAT register are added automatically).\nmoduly = list of codes from dostupneModuly (dependencies are enabled automatically). General ledger (gl) creates the Partner financial dimension — every address book subject (vendor, customer) gets a value P00001… automatically.\ndata = areas in the order they are created. zaznamy holds objects keyed by pole (technical field names). References use the code of the target record (group, unit, category, tax code…).\nNumbers as numbers (2118.5), yes/no as true/false, dates YYYY-MM-DD. Leave unused parts out or with empty zaznamy.\nKeys pokyny, pole, nazev, modul, dostupneModuly and vzor* are ignored on import.\nRunning again updates records by key (item number, code, company ID) — nothing is duplicated or deleted.\nCheck first, then Run migration. A finished company can be exported back to the same format (e.g. from TEST for PROD).",
      MigNoteCompany: "Company ID (IČO, 8 digits). The company is created from ARES; if it exists, its data are refreshed from the registers.",
      MigNoteOrg: "Data the registers do not know. logo = file name in the image folder (PNG/JPG, up to 2 MB).",
      MigNoteModules: "Module codes to enable, e.g. [\"gl\", \"tax\", \"ar\", \"ap\", \"bank\", \"inv\", \"pos\", \"shop\", \"hr\"]. Module defaults (chart of accounts, tax codes Z21/V21/P21, units KS/KG…, groups ZBOZI/SLUZBY) are created automatically.",
      MigNoteImages: "Name of the folder with item images and the logo. Select it in the import dialog; in records write the path like obrazky/KE1.jpg (matched by path end or file name).",
      MigNoteUsers: "Company users: email, jmeno (first name), prijmeni (last name), role (role codes, e.g. POKLADNIK, PRACOVNIK), spravceFirmy (true = company admin), pozvat (true = send an invitation e-mail). Passwords are never included.",
      MigObjUnit: "Only additional units — KS, KG, G, L, BAL, HOD, NEURC already exist.",
      MigObjPaymentTerm: "Additional payment terms (defaults 0, 14 and 30 days exist). Code = number of days.",
      MigObjItemGroup: "Accounting and tax settings of products. itemTaxGroupId = item VAT group (payer: Z21 goods 21 %, Z12 goods 12 %, S21 services 21 %, S12 services 12 %, OSV, MIMO; non-payer BEZ) — the document tax code comes from the combination with the partner VAT group, POS and e-shop use domestic. Accounts 604000 / 504000 (goods), 602000 / 518000 (services).",
      MigObjCategory: "Category tree for POS and e-shop. parentId = code of the parent (must be earlier in the file). eshop = show in the e-shop.",
      MigObjItem: "Items. groupId, unitId, categoryId = codes. priceInclTax true = sales price including VAT. eshop true = item in the e-shop. image = image path in the image folder. brand = manufacturer (not the vendor), vendorId = vendor code or company ID.",
      MigObjVendor: "Vendors: regNo (company ID) is enough — subject, address, VAT ID, payer reliability and accounts come from ARES and the VAT register, the Partner dimension automatically. Empty accountNum = number from sequence.",
      MigObjCustomer: "Customers: regNo (company ID) is enough, as for vendors.",
      MigObjEmployee: "Employees: personalNum (one across companies), firstName, lastName, email (portal invitation), position.",
      MigObjSite: "Sites (shops, warehouses): code, name, address, opening hours.",
      MigObjBankAccount: "Only accounts not published in the VAT register (published ones are created automatically). accountNum like 123456789/0100.",
      MigFieldMandatory: "mandatory",
      MigFieldNumberSeq: "empty = number from sequence",
      MigFieldKey: "key (running again updates the record)",
      MigFieldImage: "file path in the image folder",
      MigFieldLogo: "Logo · file path in the image folder (PNG/JPG, up to 2 MB)",
      MigFieldRef: "code from: {target}",
      MigFieldEnum: "values: {values}",
      MigFieldNumber: "number",
      MigFieldDate: "date YYYY-MM-DD",
      MigFieldMax: "text up to {n} characters",
      MigFieldDefault: "default {value}",
      MigFieldModule: "only with module {module}",
      MigFormat: "The file is not a Shanon migration file (format \"shanon-migrace\").",
      MigIco: "Enter a valid company ID (firma.ico, 8 digits).",
      MigModule: "Unknown module \"{id}\" — use a code from dostupneModuly.",
      MigObject: "Area \"{id}\" is not created by migration.",
      MigField: "{object}: unknown field \"{field}\" will not be imported.",
      MigModuleMissing: "{object}: module {module} is not among the modules to enable.",
      MigModuleLater: "Module {module} is enabled when the migration runs — the area is checked then.",
      MigModuleOff: "The area's module is not enabled in the company — add it to moduly.",
      MigImage: "Image {path} is not in the selected folder.",
      MigRole: "User {email}: role \"{role}\" does not exist.",
      MigEmail: "Invalid user e-mail \"{email}\".",
      MigUserOther: "User {email} already belongs to another organisation — not assigned.",
      MigRefsLater: "No company with this ID exists yet — references (groups, units, tax codes) are checked when the migration runs.",
      MigStepCheck: "File check",
      MigStepCompany: "Company from ARES",
      MigStepModules: "Modules and defaults",
      MigStepOrg: "Organisation, VAT, bank accounts and Partner dimension",
      MigStepUsers: "Users",
      MigStepShop: "E-shop",
      MigImgItem: "Item (POS and e-shop): square 1:1, ideally 800×800 px (at least 400×400), white or transparent background, product centred with about 5 % margin, JPG / WebP / PNG up to 2 MB. The same image is used on the POS tile, in the catalogue and in the e-shop detail.",
      MigImgCategory: "Category (e-shop): landscape 4:3, ideally 800×600 px (at least 600×450), JPG / WebP up to 2 MB.",
      MigImgLogo: "Logo: PNG with transparent background (or WebP), at least 80 px high, ideally 400–600 px wide, aspect ratio 0.8:1 to 5:1, tightly cropped, up to 500 kB. Printed in black and white on receipts — must stay legible in greyscale.",
      MigImgHero: "E-shop hero image by heroStyle: split (beside text) = 16:9, ideally 1920×1080 px; cover (full width with headline) and banner = 3:1, ideally 1920×640 px (at least 1200×400). JPG / WebP up to 1 MB. Main subject centred — edges are cropped on mobile; for cover keep the left third calmer (text goes over it). No text in the image (headline and intro are separate).",
      MigImgSmall: "{path}: {size} — smaller than the recommended {min}, it will look blurry.",
      MigImgRatio: "{path}: {size} — aspect ratio differs from the recommended {ratio}, the image will be cropped or padded.",
      MigNoteShop: "Company e-shop (module shop): name, active (true = publish), layout, accentColor and accent2Color (#rrggbb — main button colour and second gradient colour, take them from the company logo / website, white text must stay legible), heroStyle (split / cover / banner / none), heroAnimation (none / fade / zoom), headline, intro, contacts, minOrder, freeShippingFrom, pickup. logo and heroImage = files in the image folder. Shop address = organisation short name (organizace.publicSlug). Items and categories appear in the shop via the eshop flag.",
      MigShopMissing: "The company has no e-shop — enable module shop (it is created with an e-shop customer).",
      MigShopPublished: "The shop is published: {url}",
      MigShopHidden: "The shop is ready but not published ({url}) — active: true publishes it.",
      MigCompanyCreated: "Company {ico} created.",
      MigCompanyUpdated: "Company {ico} already exists — data refreshed from the registers.",
      MigModulesAdded: "Enabled: {list}",
      MigMissing: "Records are missing mandatory fields: {fields}",
      MigRow: "Record {n}",
      MigMore: "… and {n} more",
      MigInvited: "Invitation sent: {email}",
      MigInviteNoMail: "Invitation for {email} not sent — system mail is not configured.",
      NaceCode: "Main activity",
      NaceName: "Activity name",
      NaceOther: "Other activities",
      NaceHelp: "CZ-NACE code from the Register of Economic Subjects — filled in by Fill from ARES.",
      RegistrationHelp: "Built from the file number and court. For another register (trade licence…) write it manually.",
      FileNumber: "File number",
      FileNumberHelp: "Section and insert, e.g. C 327865 (s.r.o. = C, a.s. = B, cooperative = Dr, association = L). You can paste the full reference „C 327865/MSPH Městský soud v Praze“ — the court is filled in automatically.",
      FileNumberInvalid: "The file number is a section and insert number, e.g. C 327865.",
      RegisterCourt: "Registry court",
      RegisterCourtHelp: "The court keeping the register (see the commercial register extract).",
      CourtMSPH: "Municipal Court in Prague",
      CourtKSPH: "Regional Court in Prague",
      CourtKSCB: "Regional Court in České Budějovice",
      CourtKSPL: "Regional Court in Plzeň",
      CourtKSUL: "Regional Court in Ústí nad Labem",
      CourtKSHK: "Regional Court in Hradec Králové",
      CourtKSBR: "Regional Court in Brno",
      CourtKSOS: "Regional Court in Ostrava",
      Identity: "Identification",
      Address: "Registered address",
      Street: "Street",
      HouseNo: "House number",
      OrientNo: "Street number",
      City: "City",
      ZipCode: "ZIP code",
      Contacts: "Contacts",
      PublicSlug: "Short name for public links",
      PublicSlugHelp: "Lowercase letters, digits and dash (e.g. kral).",
      SlugTaken: "The short name “{slug}” is taken or reserved — choose another.",
      Web: "Website",
      DataBoxId: "Data box",
      Bank: "Bank details",
      BankAccount: "Account number",
      BankAccountHelp: "Format [prefix-]number/bank code, e.g. 19-2000145399/0800.",
      Iban: "IBAN",
      IbanHelp: "IBAN without spaces, e.g. CZ6508000000192000145399.",
      Bic: "BIC (SWIFT)",
      Site: "Site",
      Sites: "Sites",
      OpeningHours: "Opening hours",
      FromAres: "Fill from ARES",
      SimplifyVat: "Simplify VAT for non-payer",
      RegNoFirst: "Fill in and save the company ID, then fill from ARES.",
      AresNotFound: "Company ID not found in ARES.",
      OneEntity: "The company already has organization details — edit the existing record.",
    },
  },
});
