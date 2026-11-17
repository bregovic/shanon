/**
 * Organizace (obdoba Legal entities / Organization administration v D365):
 * údaje o firmě — obchodní jméno, IČO, DIČ, sídlo, kontakty, banka, zápis
 * v rejstříku — a její provozovny. Jeden zdroj pravdy pro doklady, účtenky,
 * přiznání a e-shop. Název, IČO a DIČ se propisují do firmy (sys.company).
 */
import { aresByIco, splitPersonName } from "@/modules/gab/ares";
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
    logo: { edt: Str("OrgLogo", "@ORG:Logo", 36), image: true, readOnly: true },
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
    { label: "@ORG:Address", fields: ["street", "houseNo", "orientNo", "city", "zipCode", "country"] },
    { label: "@ORG:Contacts", fields: ["email", "phone", "web", "dataBoxId", "publicSlug"] },
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
        const { firstName: first, lastName: last } = splitPersonName(a.name);
        await ctx.data.update("org.entity", String(rec.id), {
          legalName: a.name,
          legalForm: a.person ? "natural" : "legal",
          firstName: a.person ? (rec.firstName ?? first) : rec.firstName,
          lastName: a.person ? (rec.lastName ?? last) : rec.lastName,
          regNo: a.ico,
          vatId: a.vatId ?? rec.vatId ?? null,
          vatPayer: a.vatId ? true : rec.vatPayer,
          street: a.streetName,
          houseNo: a.houseNo,
          orientNo: a.orientNo,
          city: a.city,
          zipCode: a.zipCode,
          country: a.country,
          // spisová značka z ARES (veřejný rejstřík), jen když chybí — beforeSave ji rozloží a sestaví text
          ...(a.fileRef && !rec.fileNumber ? { fileNumber: a.fileRef } : {}),
        });
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
  label: "@ORG:Module",
  description: "@ORG:ModuleDesc",
  icon: "Building",
  dependsOn: ["sys"],
  enums: [LegalForm, RegisterCourt],
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
