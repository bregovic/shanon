/**
 * Organizace (obdoba Legal entities / Organization administration v D365):
 * údaje o firmě — obchodní jméno, IČO, DIČ, sídlo, kontakty, banka, zápis
 * v rejstříku — a její provozovny. Jeden zdroj pravdy pro doklady, účtenky,
 * přiznání a e-shop. Název, IČO a DIČ se propisují do firmy (sys.company).
 */
import { aresByIco } from "@/modules/gab/ares";
import { Edts, defineEdt, defineEnum, enumEdt } from "@/core/edt";
import { UserError, defineModule, type DataApi, type ObjectHandlers } from "@/core/module";
import { defineObject } from "@/core/object";

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
    registration: { edt: Edts.Description, label: "@ORG:Registration" },
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
    // logo na tiskových sestavách (faktura, účtenka)
    logo: { edt: Str("OrgLogo", "@ORG:Logo", 36), image: true, readOnly: true },
  },
  titleField: "legalName",
  list: ["legalName", "regNo", "vatId", "city", "email", "phone"],
  actions: [{ id: "ares", label: "@ORG:FromAres" }],
  form: [
    { label: "@ORG:Identity", fields: ["legalName", "tradeName", "legalForm", "firstName", "lastName", "regNo", "vatId", "vatPayer", "registration"] },
    { label: "@ORG:Address", fields: ["street", "houseNo", "orientNo", "city", "zipCode", "country"] },
    { label: "@ORG:Contacts", fields: ["email", "phone", "web", "dataBoxId"] },
    { label: "@ORG:Bank", fields: ["bankAccount", "iban", "bic"] },
    { label: "@ORG:Logo", fields: ["logo"] },
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
  if (!data.companyId || (await data.find("org.entity", {}, { take: 1 })).length) return;
  const c = await data.get("sys.company", data.companyId);
  if (!c) return;
  let tp: Record<string, unknown> | undefined;
  try {
    tp = (await data.find("tax.parameters", {}, { take: 1 }))[0];
  } catch {
    tp = undefined; // DPH není zapnuté
  }
  await data.create("org.entity", {
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
      /** údaje firmy z ARES podle IČO (jméno, forma, DIČ, sídlo); kontakty a banka zůstanou */
      async ares(ctx, rec) {
        if (!rec.regNo) throw new UserError("@ORG:RegNoFirst");
        const a = await aresByIco(String(rec.regNo), ctx.data);
        if (!a) throw new UserError("@ORG:AresNotFound");
        const [first, ...rest] = a.name.split(/\s+/);
        await ctx.data.update("org.entity", String(rec.id), {
          legalName: a.name,
          legalForm: a.person ? "natural" : "legal",
          firstName: a.person ? (rec.firstName ?? first) : rec.firstName,
          lastName: a.person ? (rec.lastName ?? (rest.join(" ") || null)) : rec.lastName,
          regNo: a.ico,
          vatId: a.vatId ?? rec.vatId ?? null,
          vatPayer: a.vatId ? true : rec.vatPayer,
          street: a.streetName,
          houseNo: a.houseNo,
          orientNo: a.orientNo,
          city: a.city,
          zipCode: a.zipCode,
          country: a.country,
        });
      },
    },
    async beforeSave(ctx, d, isNew) {
      if (isNew && (await ctx.data.find("org.entity", {}, { take: 1 })).length) throw new UserError("@ORG:OneEntity");
      if (d.legalForm === "natural" && (!d.firstName || !d.lastName)) return { [d.firstName ? "lastName" : "firstName"]: "@SYS:Required" };
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
    },
  },
};

export default defineModule({
  id: "org",
  label: "@ORG:Module",
  description: "@ORG:ModuleDesc",
  icon: "Building",
  dependsOn: ["sys"],
  enums: [LegalForm],
  objects: [entity, site],
  menu: [
    { label: "@ORG:Module", items: [{ object: "org.entity" }, { object: "org.site" }] },
    // zakládá firmu → jen superuživatel (stránky /system/… hlídá menu)
    { label: "@ORG:Functions", kind: "functions", items: [{ href: "/system/company-lookup", label: "@ORG:CompanyLookup" }] },
  ],
  setup: orgSetup,
  labels: {
    cs: {
      Logo: "Logo",
      CompanyExists: "Firma se stejným IČO / DIČ už existuje.",
      CompanyLookup: "Založit firmu podle IČO / DIČ",
      CompanyLookupDesc: "Nová účtovaná firma z ARES (české IČO) nebo VIES (zahraniční DIČ): údaje organizace se sídlem a výchozí nastavení zapnutých modulů (účty, řady, DPH…). Kód firmy = IČO.",
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
      Registration: "Zápis v rejstříku",
      Identity: "Identifikace",
      Address: "Sídlo",
      Street: "Ulice",
      HouseNo: "Číslo popisné",
      OrientNo: "Číslo orientační",
      City: "Obec",
      ZipCode: "PSČ",
      Contacts: "Kontakty",
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
      RegNoFirst: "Vyplňte a uložte IČO, pak doplňte z ARES.",
      AresNotFound: "IČO v ARES nenalezeno.",
      OneEntity: "Firma už údaje organizace má — upravte stávající záznam.",
    },
    en: {
      Logo: "Logo",
      CompanyExists: "A company with the same ID / VAT ID already exists.",
      CompanyLookup: "Create company by ID / VAT ID",
      CompanyLookupDesc: "A new accounting company from ARES (Czech ID) or VIES (foreign VAT ID): organization details with registered address and default setup of enabled modules (accounts, sequences, VAT…). Company code = ID.",
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
      Registration: "Register entry",
      Identity: "Identification",
      Address: "Registered address",
      Street: "Street",
      HouseNo: "House number",
      OrientNo: "Street number",
      City: "City",
      ZipCode: "ZIP code",
      Contacts: "Contacts",
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
      RegNoFirst: "Fill in and save the company ID, then fill from ARES.",
      AresNotFound: "Company ID not found in ARES.",
      OneEntity: "The company already has organization details — edit the existing record.",
    },
  },
});
