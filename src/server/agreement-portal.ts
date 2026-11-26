/**
 * Portál smluv — veřejná část (bez přihlášení): zájemce si vybere tarif, vyplní údaje, potvrdí znění
 * smlouvy → subjekt v adresáři + odběratel + prodejní smlouva + výzva k platbě (objednávka a záloha
 * s VS a QR). Smlouva je neaktivní, dokud banka nespáruje platbu (`tax/agreements.ts`).
 *
 * Portál = `int.portal` s účelem „agreement“ (stejný odkaz, klíč a jednoduchá adresa jako u dokladů).
 * Každý pokus jde do protokolu portálu (`int.portalUpload`) — podle něj se hlídá limit za hodinu.
 */
import "server-only";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import type { RecordData } from "@/core/module";
import { notify } from "@/modules/sys/notify";
import { ar } from "@/modules/ar";
import { requestAgreementPayment } from "@/modules/tax/agreements";
import { advancePrintable, companyData, paymentQr } from "@/modules/prt/printables";
import { prisma } from "./db";
import { inTenant } from "./data";
import { getT } from "./i18n";
import { loadPortal, portalDesign, type PortalDesign } from "./supplier-portal";
import { sendAgreementMail } from "./mail";
import { renderTextPdf } from "./print-pdf";
import { formFieldVisible } from "@/lib/form-visible";
import { aresByIco } from "@/modules/gab/ares";

export interface AgreementTariff {
  id: string;
  name: string;
  price: string;
  months: number;
  description: string;
  /** cena je za kartu (× počet karet) */
  perUnit: boolean;
}

/** Pole formuláře pro veřejnou stránku (bez mapování – kam se ukládá, ví jen server). */
export interface PortalFormField {
  key: string;
  label: string;
  kind: string;
  required: boolean;
  options: string[];
  help: string;
  width: "half" | "full";
  /** zobrazit jen když (klíč=hodnota / klíč) */
  showIf: string;
  /** nápověda prohlížeči pro automatické vyplnění (given-name, email…) */
  auto: string;
  /** ARES: „lookup“ = pole IČO s tlačítkem Načíst z ARES, ostatní = co z ARES doplnit (name, vatId, street, city, zip) */
  ares: string;
}

export interface AgreementPortalInfo {
  form: { heading: string; intro: string; fields: PortalFormField[] } | null;
  design: PortalDesign;
  companyName: string;
  title: string;
  intro: string;
  terms: string;
  currency: string;
  tariffs: AgreementTariff[];
}

export interface AgreementInput {
  tariffId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  zipCode: string;
  startDate: string;
  consent: boolean;
  /** odpovědi formuláře portálu {klíč: hodnota} */
  answers?: Record<string, string | boolean>;
}

export interface AgreementResult {
  ok: boolean;
  error?: string;
  agreementNum?: string;
  /** jen pro server (e-mail se smlouvou), na stránku nejde */
  agreementId?: string;
  /** smlouva odešla členovi e-mailem (na tuto adresu) */
  mailedTo?: string;
  payment?: { amount: string; currency: string; vs: string; dueDate: string; bankAccount: string; iban: string; qr: string; advanceNum: string };
}

const today = () => new Date().toISOString().slice(0, 10);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type Api = Parameters<typeof requestAgreementPayment>[0];
const ARES_ROLE: Record<string, string> = {
  "subject.regNo": "lookup", "subject.name": "name", "subject.vatId": "vatId", "address.street": "street", "address.city": "city", "address.zipCode": "zip",
  // firma jako plátce (firemní členství): jen do smlouvy, ale s ARES
  "company.regNo": "lookup", "company.name": "name", "company.vatId": "vatId",
};
const AUTOFILL: Record<string, string> = {
  "subject.firstName": "given-name", "subject.lastName": "family-name", "subject.name": "name", "subject.email": "email", "subject.phone": "tel",
  "address.street": "street-address", "address.city": "address-level2", "address.zipCode": "postal-code", "address.country": "country",
  "contact.street": "shipping street-address", "contact.city": "shipping address-level2", "contact.zipCode": "shipping postal-code",
};

const VALUE_KINDS = new Set(["text", "longtext", "email", "phone", "date", "number", "select", "checkbox", "consent"]);

async function formFields(api: Api, formId: string) {
  return api.find("int.formField", { formId }, { take: 200, orderBy: { sequence: "asc" } });
}

/** Formulář portálu pro stránku (bez mapování). */
async function portalForm(api: Api, formId: string): Promise<AgreementPortalInfo["form"]> {
  const f = await api.get("int.form", formId);
  if (!f) return null;
  const fields = (await formFields(api, formId)).map((x) => ({
    key: String(x.key),
    label: String(x.label ?? ""),
    kind: String(x.kind ?? "text"),
    required: !!x.required || x.kind === "consent",
    options: String(x.options ?? "").split(/[\n|]/).map((o) => o.trim()).filter(Boolean),
    help: String(x.help ?? ""),
    showIf: String(x.showIf ?? "").trim(),
    auto: AUTOFILL[String(x.mapping ?? "")] ?? "",
    ares: ARES_ROLE[String(x.mapping ?? "")] ?? "",
    width: (x.width === "full" || x.kind === "longtext" || x.kind === "heading" || x.kind === "info" || x.kind === "consent" ? "full" : "half") as "half" | "full",
  }));
  return { heading: String(f.heading ?? ""), intro: String(f.intro ?? ""), fields };
}

interface FormPerson {
  name: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  zip: string;
  country: string;
  start: string;
  subjectExtra: RecordData;
  contact: { street: string; city: string; zip: string } | null;
  agreementExtra: RecordData;
  formData: string;
  formText: string;
}

/**
 * Odpovědi formuláře: kontrola podle typu a povinnosti, rozepsání podle „Kam uložit“ (člen, adresy, smlouva)
 * a všechny odpovědi do smlouvy (JSON + čitelný text). Chyba = text pro zájemce.
 */
async function formAnswers(api: Api, formId: string, answers: Record<string, unknown>, t: (k: string, p?: Record<string, string>) => string): Promise<FormPerson | string> {
  const data: Record<string, string | boolean> = {};
  const lines: string[] = [];
  const mapped: Record<string, string> = {};
  for (const f of await formFields(api, formId)) {
    const kind = String(f.kind ?? "text");
    if (!VALUE_KINDS.has(kind)) continue;
    if (!formFieldVisible(String(f.showIf ?? ""), answers)) continue; // skryté pole: nekontroluje se ani neukládá
    const key = String(f.key), label = String(f.label ?? key);
    const raw = answers[key];
    if (kind === "checkbox" || kind === "consent") {
      const v = raw === true || raw === "true";
      if ((kind === "consent" || f.required) && !v) return t("@INT:PortalFormConsentMissing", { label });
      data[key] = v;
      lines.push(`${label}: ${v ? "ano" : "ne"}`);
      continue;
    }
    let v = String(raw ?? "").trim().slice(0, kind === "longtext" ? 2000 : 300);
    if (!v) {
      if (f.required) return t("@INT:PortalFormRequired", { label });
      data[key] = "";
      continue;
    }
    const opts = String(f.options ?? "").split(/[\n|]/).map((o) => o.trim()).filter(Boolean);
    const bad =
      (kind === "email" && !EMAIL.test(v)) ||
      (kind === "phone" && v.replace(/\D/g, "").length < 9) ||
      (kind === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) ||
      (kind === "number" && !/^-?\d+([.,]\d+)?$/.test(v)) ||
      (kind === "select" && opts.length > 0 && !opts.includes(v));
    if (bad) return t("@INT:PortalFormInvalid", { label });
    if (kind === "email") v = v.toLowerCase();
    data[key] = v;
    lines.push(`${label}: ${kind === "date" ? v.split("-").reverse().join(". ") : v}`);
    if (f.mapping && f.mapping !== "form") mapped[String(f.mapping)] = v;
  }
  const m = (k: string) => mapped[k] ?? "";
  const name = m("subject.name") || [m("subject.firstName"), m("subject.lastName")].filter(Boolean).join(" ");
  const subjectExtra: RecordData = {};
  for (const k of ["regNo", "vatId", "notes"]) if (m(`subject.${k}`)) subjectExtra[k] = m(`subject.${k}`);
  const agreementExtra: RecordData = {};
  for (const k of ["endDate", "cardNumber", "description", "notes"]) if (m(`agreement.${k}`)) agreementExtra[k] = m(`agreement.${k}`);
  if (m("agreement.quantity")) agreementExtra.quantity = Math.min(999, Math.max(1, Math.round(Number(m("agreement.quantity").replace(",", ".")) || 1)));
  return {
    name: name.slice(0, 120),
    email: m("subject.email"),
    phone: m("subject.phone"),
    street: m("address.street"),
    city: m("address.city"),
    zip: m("address.zipCode").replace(/\s/g, ""),
    country: (m("address.country") || "CZ").toUpperCase().slice(0, 2),
    start: m("agreement.startDate") || new Date().toISOString().slice(0, 10),
    subjectExtra,
    contact: m("contact.city") ? { street: m("contact.street"), city: m("contact.city"), zip: m("contact.zipCode").replace(/\s/g, "") } : null,
    agreementExtra,
    formData: JSON.stringify(data),
    formText: lines.join("\n"),
  };
}

async function tariffsOf(api: Parameters<typeof requestAgreementPayment>[0]): Promise<AgreementTariff[]> {
  const items = await api.find("inv.item", { agreementMonths: { gt: 0 }, blocked: false }, { take: 50, orderBy: { agreementMonths: "asc" } });
  const pos = (v: unknown) => (v !== null && v !== undefined && v !== "" && Number(v) > 0 ? String(v) : null);
  return items
    .map((it) => ({ id: String(it.id), name: String(it.name ?? ""), price: pos(it.priceGross) ?? pos(it.salesPrice) ?? "", months: Number(it.agreementMonths), description: String(it.description ?? ""), perUnit: !!it.agreementPerUnit }))
    .filter((t) => t.price);
}

/** Údaje pro veřejnou stránku smlouvy (null = odkaz neplatí nebo portál není na smlouvy). */
export async function agreementPortalInfo(tenantId: string, token: string, client: PrismaClient = prisma): Promise<AgreementPortalInfo | null> {
  const l = await loadPortal(tenantId, token, client);
  if (!l || l.portal.purpose !== "agreement" || !l.ctx.modules.has("ar")) return null;
  const { tariffs, form } = await inTenant(
    l.ctx,
    async (s) => ({ tariffs: await tariffsOf(s.sys().api()), form: l.portal.formId ? await portalForm(s.sys().api(), String(l.portal.formId)) : null }),
    client,
  );
  return {
    form,
    design: await portalDesign(l, tenantId, token, client),
    companyName: l.companyName,
    title: String(l.portal.title ?? "") || l.companyName,
    intro: String(l.portal.intro ?? ""),
    terms: String(l.portal.agreementTerms ?? ""),
    currency: "Kč",
    tariffs,
  };
}

/** Uzavření smlouvy z portálu. `ip` jen k limitu (ukládá se otisk). */
export async function agreementPortalSubmit(tenantId: string, token: string, input: AgreementInput, ip: string, client: PrismaClient = prisma): Promise<AgreementResult | null> {
  const l = await loadPortal(tenantId, token, client);
  if (!l || l.portal.purpose !== "agreement" || !l.ctx.modules.has("ar")) return null;
  const t = await getT("cs", l.ctx.tenantId);
  const p = l.portal;
  const ipHash = createHash("sha256").update(`${l.ctx.tenantId}|${ip}`).digest("hex").slice(0, 32);
  const clip = (v: string, n: number) => String(v ?? "").trim().slice(0, n);
  const first = clip(input.firstName, 60), last = clip(input.lastName, 60);
  let name = `${first} ${last}`.trim();
  let email = clip(input.email, 254).toLowerCase();
  let phone = clip(input.phone, 30);
  let street = clip(input.street, 120), city = clip(input.city, 80), zip = clip(input.zipCode, 10).replace(/\s/g, "");
  let country = "CZ";
  let start = /^\d{4}-\d{2}-\d{2}$/.test(input.startDate) ? input.startDate : today();
  let subjectExtra: RecordData = {}, agreementExtra: RecordData = {};
  let contact: FormPerson["contact"] = null;
  let formData: string | null = null, formText: string | null = null;

  return inTenant(
    l.ctx,
    async (s) => {
      const api = s.sys().api();
      const log = (status: "accepted" | "rejected", reason: string | null) =>
        api.create("int.portalUpload", { portalId: p.id, at: new Date().toISOString(), status, reason: reason?.slice(0, 255) ?? null, ipHash, senderName: name || null });
      const reject = async (msg: string): Promise<AgreementResult> => {
        await log("rejected", msg);
        return { ok: false, error: msg };
      };
      const hourAgo = new Date(Date.now() - 3600_000).toISOString();
      const fromIp = (await api.find("int.portalUpload", { portalId: p.id, ipHash, at: { gte: hourAgo } }, { take: 1000 })).length;
      if (fromIp >= Number(p.ipHourLimit ?? 10)) return { ok: false, error: t("@INT:PortalAgrLimit") };

      const tariffs = await tariffsOf(api);
      if (!tariffs.length) return reject(t("@INT:PortalAgrNoTariff"));
      const tariff = tariffs.find((x) => x.id === input.tariffId);
      if (!tariff) return reject(t("@INT:PortalAgrTariff"));
      if (p.formId) {
        // formulář portálu: pole a mapování podle nastavení (Integrace → Formuláře)
        const r = await formAnswers(api, String(p.formId), input.answers ?? {}, t);
        if (typeof r === "string") return reject(r);
        ({ name, email, phone, street, city, zip, country, start, subjectExtra, contact, agreementExtra, formData, formText } = r);
        if (!name || !EMAIL.test(email)) return reject(t("@INT:PortalFormNoName"));
      } else {
        if (!first || !last) return reject(t("@INT:PortalAgrName"));
        if (!EMAIL.test(email)) return reject(t("@INT:PortalAgrEmail"));
        if (phone.replace(/\D/g, "").length < 9) return reject(t("@INT:PortalAgrPhone"));
        if (!street || !city || !/^\d{5}$/.test(zip)) return reject(t("@INT:PortalAgrAddress"));
      }
      if (start < today()) return reject(t("@INT:PortalAgrStart"));
      if (!input.consent) return reject(t("@INT:PortalAgrConsent"));

      // člen: stejná osoba (jméno + e-mail) se nezakládá znovu, jinak nový subjekt s adresou
      const same = (await api.find("gab.subject", { email, type: "person" }, { take: 20 })).find((x) => String(x.name).toLowerCase() === name.toLowerCase());
      const subject = same ?? (await api.create("gab.subject", { name, type: "person", email, phone: phone || null, country, ...subjectExtra }));
      if (!same && city) await api.create("gab.address", { subjectId: subject.id, kind: "registered", street: street || null, city, zipCode: zip || null, country });
      if (!same && contact) await api.create("gab.address", { subjectId: subject.id, kind: "delivery", street: contact.street || null, city: contact.city, zipCode: contact.zip || null, country });
      const [have] = await api.find("ar.customer", { subjectId: subject.id }, { take: 1 });
      const customer = have ?? (await api.create("ar.customer", { subjectId: subject.id, groupId: p.agreementGroupId ?? null }));

      const terms = [String(p.agreementTerms ?? "").trim(), `Tarif: ${tariff.name} – ${tariff.price} Kč za ${tariff.months} měs.`, `Potvrzeno na portálu ${p.name} ${new Date().toISOString()}`].filter(Boolean).join("\n\n");
      const agr = await api.create("ar.agreement", {
        customerId: customer.id,
        itemId: tariff.id,
        startDate: start,
        signedAt: new Date().toISOString(),
        terms,
        ...agreementExtra,
        notes: [agreementExtra.notes, `${t("@INT:Portal")}: ${p.name}`].filter(Boolean).join("\n"),
        formData,
        formText,
      });
      const { advance } = await requestAgreementPayment(api, ar.agreementDocs, (await api.get("ar.agreement", String(agr.id)))!);
      // režim Kalendář: bez zálohy – platí se první splátka s VS smlouvy (aktivuje smlouvu)
      if (!advance) {
        const a2 = (await api.get("ar.agreement", String(agr.id)))!;
        const [first] = await api.find("ar.agreementLine", { agreementId: agr.id, status: "planned" }, { take: 1, orderBy: { lineNum: "asc" } });
        const co = await companyData(api, l.ctx.companyId, (a2.currencyId as string) ?? null);
        const amount = String(first?.amount ?? a2.amount ?? "0");
        const vs = String(a2.vs ?? "");
        const dueDate = String(a2.dueDate ?? "").slice(0, 10);
        await log("accepted", null);
        await notify(api, { kind: "info", title: "@INT:NotifyAgreement", params: { name, tariff: tariff.name }, href: `/ar/agreement/${agr.id}`, key: `agr-${agr.id}` });
        return {
          ok: true,
          agreementId: String(agr.id),
          agreementNum: String(a2.agreementNum ?? ""),
          payment: {
            amount,
            currency: "CZK",
            vs,
            dueDate,
            bankAccount: co.bankAccount,
            iban: co.iban,
            qr: co.iban ? await paymentQr(api, { iban: co.iban, amount, currency: "CZK", vs, date: dueDate || null, message: `Smlouva ${a2.agreementNum}` }) : "",
            advanceNum: "",
          },
        };
      }
      const pd = await advancePrintable.dataset(api, l.ctx.companyId, String(advance.id));
      const doc = pd.doc as Record<string, unknown>, co = pd.company as Record<string, unknown>;
      await log("accepted", null);
      await notify(api, { kind: "info", title: "@INT:NotifyAgreement", params: { name, tariff: tariff.name }, href: `/ar/agreement/${agr.id}`, key: `agr-${agr.id}` });
      return {
        ok: true,
        agreementId: String(agr.id),
        agreementNum: String(agr.agreementNum ?? ""),
        payment: {
          amount: String(doc.due ?? advance.amount),
          currency: String(doc.currency ?? "CZK"),
          vs: String(doc.vs ?? ""),
          dueDate: String(advance.dueDate ?? "").slice(0, 10),
          bankAccount: String(co?.bankAccount ?? ""),
          iban: String(co?.iban ?? ""),
          qr: String(pd.qr ?? ""),
          advanceNum: String(advance.advanceNum ?? ""),
        },
      };
    },
    client,
  );
}

/**
 * Po uzavření (mimo transakci): vyplněná smlouva a obchodní podmínky členovi e-mailem, když to portál chce
 * (`mailAgreement`). Selhání pošty smlouvu neruší – člen jen e-mail nedostane (zůstane koncept v Poště).
 */
export async function agreementPortalMail(tenantId: string, token: string, res: AgreementResult, client: PrismaClient = prisma): Promise<string | null> {
  if (!res.ok || !res.agreementId) return null;
  const l = await loadPortal(tenantId, token, client);
  if (!l || l.portal.mailAgreement === false) return null;
  const pay = res.payment ? { amount: res.payment.amount, vs: res.payment.vs, account: res.payment.bankAccount || res.payment.iban, dueDate: res.payment.dueDate } : null;
  try {
    const sent = await sendAgreementMail(l.ctx, res.agreementId, pay, client);
    return sent.test ? null : sent.to.join(", ");
  } catch {
    return null;
  }
}

/** Obchodní podmínky portálu jako PDF ke stažení (celé, na víc stran). */
export async function agreementTermsPdf(tenantId: string, token: string, client: PrismaClient = prisma): Promise<Buffer | null> {
  const l = await loadPortal(tenantId, token, client);
  if (!l || l.portal.purpose !== "agreement" || !String(l.portal.agreementTerms ?? "").trim()) return null;
  return renderTextPdf(`Obchodní podmínky – ${l.companyName}`, String(l.portal.agreementTerms));
}

/** Dotazy na ARES z portálu: nejvýš 20 za hodinu z jedné adresy (v paměti serveru – stačí proti zneužití). */
const aresHits = new Map<string, number[]>();

/**
 * ARES pro formulář portálu (firemní člen): jen portál smluv, jehož formulář má pole „Člen – IČO“. Vrací název,
 * DIČ a sídlo; síť mimo transakci.
 */
export async function agreementPortalAres(tenantId: string, token: string, ico: string, ip: string, client: PrismaClient = prisma) {
  const l = await loadPortal(tenantId, token, client);
  if (!l || l.portal.purpose !== "agreement" || !l.portal.formId) return null;
  const has = await inTenant(l.ctx, async (s) => (await formFields(s.sys().api(), String(l.portal.formId))).some((f) => f.mapping === "subject.regNo" || f.mapping === "company.regNo"), client);
  if (!has) return null;
  const clean = String(ico ?? "").replace(/\s/g, "");
  if (!/^\d{6,8}$/.test(clean)) return { ok: false as const, error: "IČO má 8 číslic." };
  const key = createHash("sha256").update(`${l.ctx.tenantId}|${ip}`).digest("hex").slice(0, 32);
  const now = Date.now();
  const hits = (aresHits.get(key) ?? []).filter((t) => t > now - 3600_000);
  if (hits.length >= 20) return { ok: false as const, error: "Příliš mnoho dotazů. Zkuste to později, nebo údaje vyplňte ručně." };
  aresHits.set(key, [...hits, now]);
  const r = await aresByIco(clean.padStart(8, "0")).catch(() => null);
  if (!r) return { ok: false as const, error: "Firmu s tímto IČO jsme v ARES nenašli." };
  return { ok: true as const, ico: r.ico, name: r.name, vatId: r.vatId ?? "", street: r.street ?? "", city: r.city ?? "", zip: r.zipCode ?? "", closed: r.closed };
}
