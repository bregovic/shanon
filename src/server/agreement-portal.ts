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
import { notify } from "@/modules/sys/notify";
import { ar } from "@/modules/ar";
import { requestAgreementPayment } from "@/modules/tax/agreements";
import { advancePrintable, companyData, paymentQr } from "@/modules/prt/printables";
import { prisma } from "./db";
import { inTenant } from "./data";
import { getT } from "./i18n";
import { loadPortal, portalDesign, type PortalDesign } from "./supplier-portal";

export interface AgreementTariff {
  id: string;
  name: string;
  price: string;
  months: number;
  description: string;
}

export interface AgreementPortalInfo {
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
}

export interface AgreementResult {
  ok: boolean;
  error?: string;
  agreementNum?: string;
  payment?: { amount: string; currency: string; vs: string; dueDate: string; bankAccount: string; iban: string; qr: string; advanceNum: string };
}

const today = () => new Date().toISOString().slice(0, 10);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function tariffsOf(api: Parameters<typeof requestAgreementPayment>[0]): Promise<AgreementTariff[]> {
  const items = await api.find("inv.item", { agreementMonths: { gt: 0 }, blocked: false }, { take: 50, orderBy: { agreementMonths: "asc" } });
  const pos = (v: unknown) => (v !== null && v !== undefined && v !== "" && Number(v) > 0 ? String(v) : null);
  return items
    .map((it) => ({ id: String(it.id), name: String(it.name ?? ""), price: pos(it.priceGross) ?? pos(it.salesPrice) ?? "", months: Number(it.agreementMonths), description: String(it.description ?? "") }))
    .filter((t) => t.price);
}

/** Údaje pro veřejnou stránku smlouvy (null = odkaz neplatí nebo portál není na smlouvy). */
export async function agreementPortalInfo(tenantId: string, token: string, client: PrismaClient = prisma): Promise<AgreementPortalInfo | null> {
  const l = await loadPortal(tenantId, token, client);
  if (!l || l.portal.purpose !== "agreement" || !l.ctx.modules.has("ar")) return null;
  const tariffs = await inTenant(l.ctx, (s) => tariffsOf(s.sys().api()), client);
  return {
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
  const name = `${first} ${last}`.trim();
  const email = clip(input.email, 254).toLowerCase();
  const phone = clip(input.phone, 30);
  const street = clip(input.street, 120), city = clip(input.city, 80), zip = clip(input.zipCode, 10).replace(/\s/g, "");
  const start = /^\d{4}-\d{2}-\d{2}$/.test(input.startDate) ? input.startDate : today();

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
      if (!first || !last) return reject(t("@INT:PortalAgrName"));
      if (!EMAIL.test(email)) return reject(t("@INT:PortalAgrEmail"));
      if (phone.replace(/\D/g, "").length < 9) return reject(t("@INT:PortalAgrPhone"));
      if (!street || !city || !/^\d{5}$/.test(zip)) return reject(t("@INT:PortalAgrAddress"));
      if (start < today()) return reject(t("@INT:PortalAgrStart"));
      if (!input.consent) return reject(t("@INT:PortalAgrConsent"));

      // člen: stejná osoba (jméno + e-mail) se nezakládá znovu, jinak nový subjekt s adresou
      const same = (await api.find("gab.subject", { email, type: "person" }, { take: 20 })).find((x) => String(x.name).toLowerCase() === name.toLowerCase());
      const subject = same ?? (await api.create("gab.subject", { name, type: "person", email, phone, country: "CZ" }));
      if (!same) await api.create("gab.address", { subjectId: subject.id, kind: "registered", street, city, zipCode: zip, country: "CZ" });
      const [have] = await api.find("ar.customer", { subjectId: subject.id }, { take: 1 });
      const customer = have ?? (await api.create("ar.customer", { subjectId: subject.id, groupId: p.agreementGroupId ?? null }));

      const terms = [String(p.agreementTerms ?? "").trim(), `Tarif: ${tariff.name} – ${tariff.price} Kč za ${tariff.months} měs.`, `Potvrzeno na portálu ${p.name} ${new Date().toISOString()}`].filter(Boolean).join("\n\n");
      const agr = await api.create("ar.agreement", {
        customerId: customer.id,
        itemId: tariff.id,
        startDate: start,
        signedAt: new Date().toISOString(),
        terms,
        notes: `${t("@INT:Portal")}: ${p.name}`,
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

