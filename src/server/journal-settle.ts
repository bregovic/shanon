/**
 * Dialog Vyrovnat u řádku deníku: otevřené položky salda k vyrovnání a uložení výběru.
 * Čtení a zápis řádku jdou přes datovou službu uživatele (právo na řádky deníku, zamčený deník);
 * logika vyrovnání je v `src/modules/gl/settlement.ts`.
 */
import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { UserError, type DataApi, type RecordData } from "@/core/module";
import { can } from "@/core/security";
import { fromCents, toCents } from "@/core/money";
import { linePartner, lineAmount, saveSettlement, settleCandidates, type PartnerKind, type SettleCandidate, type SettleKind, type SettleCriteria } from "@/modules/gl/settlement";
import { inTenant, type Ctx } from "./data";
import { prisma } from "./db";
import { getT } from "./i18n";

const KEYS = [
  "SettleTitle", "SettleHint", "SettlePartnerOnly", "SettleKind", "SettleCustomers", "SettleVendors", "SettleAll", "SettleSearchText", "SettleDateFrom",
  "SettleDateTo", "SettleSearch", "SettlePartner", "SettleDoc", "SettleDue", "SettleRemaining", "SettlePay", "SettleSelected", "SettleLine", "SettleSave",
  "SettleClear", "SettleNone2", "SettleWhat", "SettleKindInvoice", "SettleKindAdvance", "SettleKindAgreement", "Vs", "Date", "Amount",
] as const;

export interface SettleView {
  texts: Record<string, string>;
  line: { id: string; lineNum: string; partnerKind: PartnerKind | null; partnerName: string; amount: string; vs: string; locked: boolean };
  rows: SettleCandidate[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function settleView(ctx: Ctx, lineId: string, criteria: SettleCriteria, lang: Parameters<typeof getT>[0], client: PrismaClient = prisma): Promise<SettleView> {
  if (!UUID.test(lineId)) throw new UserError("@SYS:InvalidValue");
  const t = await getT(lang, ctx.tenantId);
  return inTenant(
    ctx,
    async (s) => {
      const api = s.api();
      const line = await api.get("gl.journalLine", lineId);
      if (!line) throw new UserError("@SYS:NotFound");
      const journal = await api.get("gl.journal", String(line.journalId));
      const p = linePartner(line);
      // položky salda čte logika (systémově) – právo na deník stačí, jako u Ověřit
      const rows = await settleCandidates(s.sys().api(), line, criteria);
      let partnerName = "";
      if (p) {
        const rec = await s.sys().api().get(p.kind === "customer" ? "ar.customer" : "ap.vendor", p.id);
        const subj = rec?.subjectId ? await s.sys().api().get("gab.subject", String(rec.subjectId)) : null;
        partnerName = String(subj?.name ?? rec?.accountNum ?? "");
      }
      const texts = Object.fromEntries(KEYS.map((k) => [k, t(k === "Date" || k === "Amount" ? `@SYS:${k}` : `@GL:${k}`)]));
      return {
        texts,
        line: {
          id: lineId,
          lineNum: String(line.lineNum ?? ""),
          partnerKind: p?.kind ?? null,
          partnerName,
          amount: fromCents(lineAmount(line)),
          vs: String(line.vs ?? ""),
          locked: journal?.status === "posted" || !can(ctx.perms, "gl.journalLine", "write"),
        },
        rows,
      };
    },
    client,
  );
}

export async function settleSave(ctx: Ctx, lineId: string, items: { kind: PartnerKind; type?: SettleKind; transId: string; amount: string }[], client: PrismaClient = prisma): Promise<void> {
  if (!UUID.test(lineId) || items.some((i) => !UUID.test(i.transId) || (i.kind !== "customer" && i.kind !== "vendor") || (i.type && !["invoice", "advance", "agreement"].includes(i.type)))) throw new UserError("@SYS:InvalidValue");
  if (!can(ctx.perms, "gl.journalLine", "write")) throw new UserError("@SYS:NoAccess");
  for (const i of items) if (i.amount && !/^-?\d+([.,]\d{1,2})?$/.test(i.amount.replace(/\s/g, ""))) throw new UserError("@SYS:InvalidValue");
  await inTenant(
    ctx,
    async (s) => {
      // řádek přes datovou službu uživatele (právo, zamčený deník), vyrovnání zapisuje logika
      const line = await s.api().get("gl.journalLine", lineId);
      if (!line) throw new UserError("@SYS:NotFound");
      const journal = await s.api().get("gl.journal", String(line.journalId));
      if (journal?.status === "posted") throw new UserError("@GL:Locked");
      await saveSettlement(s.sys().api(), line, items.map((i) => ({ ...i, amount: i.amount ? fromCents(toCents(i.amount.replace(/\s/g, "").replace(",", "."))) : "" })));
    },
    client,
  );
}

/* ---------------------------------------------------------------------------
 * Označit k vyrovnání z dokladu (faktura, záloha, smlouva): nezaúčtovaný řádek deníku, který ho uhradí.
 * ------------------------------------------------------------------------- */

const DOC: Record<string, { kind: PartnerKind; type: SettleKind }> = {
  "ar.invoice": { kind: "customer", type: "invoice" },
  "ap.invoice": { kind: "vendor", type: "invoice" },
  "ar.advance": { kind: "customer", type: "advance" },
  "ap.advance": { kind: "vendor", type: "advance" },
  "ar.agreement": { kind: "customer", type: "agreement" },
};

export interface MarkView {
  texts: Record<string, string>;
  doc: { num: string; partnerName: string; remaining: string; vs: string };
  rows: { lineId: string; journal: string; date: string; text: string; vs: string; amount: string; partnerName: string; status: string; marked: boolean }[];
}

const refField = (kind: PartnerKind, type: SettleKind) =>
  type === "invoice" ? (kind === "customer" ? "customerTransId" : "vendorTransId") : type === "advance" ? (kind === "customer" ? "customerAdvanceId" : "vendorAdvanceId") : "agreementId";

/** Doklad → položka k vyrovnání (položka salda faktury / záloha / smlouva), partner a zbytek. */
async function docTarget(api: DataApi, objectId: string, id: string) {
  const d = DOC[objectId];
  if (!d || !UUID.test(id)) throw new UserError("@SYS:InvalidValue");
  const rec = await api.get(objectId, id);
  if (!rec) throw new UserError("@SYS:NotFound");
  const pf = d.kind === "customer" ? "customerId" : "vendorId";
  let transId = id;
  let remaining = "0.00";
  let num = "";
  if (d.type === "invoice") {
    const [t] = await api.find(d.kind === "customer" ? "ar.trans" : "ap.trans", { invoiceId: id, kind: "invoice" }, { take: 1 });
    if (!t || t.closed) throw new UserError("@GL:SettleClosed", { line: "", doc: String(rec.invoiceNum ?? "") });
    transId = String(t.id);
    remaining = fromCents(toCents(String(t.amountCur ?? t.amount)) - toCents(String(t.paidAmount ?? 0)));
    num = String(rec.invoiceNum ?? rec.externalNum ?? "");
  } else if (d.type === "advance") {
    remaining = fromCents(toCents(String(rec.amount ?? 0)) - toCents(String(rec.paidAmount ?? 0)));
    num = String(rec.advanceNum ?? "");
  } else {
    if (rec.status !== "awaiting") throw new UserError("@GL:SettleClosed", { line: "", doc: String(rec.agreementNum ?? "") });
    const [first] = await api.find("ar.agreementLine", { agreementId: id, status: "planned" }, { take: 1, orderBy: { lineNum: "asc" } });
    remaining = String(first?.amount ?? "0.00");
    num = String(rec.agreementNum ?? "");
  }
  const partner = await api.get(d.kind === "customer" ? "ar.customer" : "ap.vendor", String(rec[pf]));
  const subj = partner?.subjectId ? await api.get("gab.subject", String(partner.subjectId)) : null;
  return { ...d, transId, partnerId: String(rec[pf]), partnerName: String(subj?.name ?? partner?.accountNum ?? ""), remaining, num, vs: String(rec.vs ?? "") };
}

export async function markSettleView(ctx: Ctx, objectId: string, id: string, criteria: { all?: boolean; vs?: string; amount?: string }, lang: Parameters<typeof getT>[0], client: PrismaClient = prisma): Promise<MarkView> {
  const t = await getT(lang, ctx.tenantId);
  return inTenant(
    ctx,
    async (s) => {
      // doklad přes datovou službu uživatele (právo číst), řádky deníků logikou (právo na deník ověří Uložit)
      if (!(await s.api().get(objectId, id))) throw new UserError("@SYS:NotFound");
      const api = s.sys().api();
      const doc = await docTarget(api, objectId, id);
      const journals = new Map((await api.find("gl.journal", { status: "draft" }, { take: 500 })).map((j) => [String(j.id), j]));
      const lines = journals.size ? await api.find("gl.journalLine", { journalId: { in: [...journals.keys()] } }, { take: 3000 }) : [];
      const marked = new Set((await api.find("gl.journalSettlement", { [refField(doc.kind, doc.type)]: doc.transId }, { take: 100 })).map((x) => String(x.journalLineId)));
      const amount = criteria.amount?.trim() ? toCents(criteria.amount.replace(/\s/g, "").replace(",", ".")) : null;
      const partnerIds = new Set<string>();
      const rows = lines.filter((l) => {
        const p = linePartner(l);
        if (marked.has(String(l.id))) {
          if (p) partnerIds.add(p.id);
          return true;
        }
        const free = !p && (!l.accountType || (l.accountType === "ledger" && !l.accountId));
        // partner dokladu, nebo řádek bez účtu (nespárovaná platba z výpisu); „Všechny“ = i jiní partneři
        if (!criteria.all && !(free || (p && p.kind === doc.kind && p.id === doc.partnerId))) return false;
        if (criteria.vs?.trim() && String(l.vs ?? "") !== criteria.vs.trim()) return false;
        if (amount !== null && lineAmount(l) !== (amount < BigInt(0) ? -amount : amount)) return false;
        if (p) partnerIds.add(p.id);
        return true;
      });
      const partnerNames = new Map<string, string>();
      for (const obj of ["ar.customer", "ap.vendor"]) {
        const ps = partnerIds.size ? await api.find(obj, { id: { in: [...partnerIds] } }, { take: 1000 }).catch(() => [] as RecordData[]) : [];
        const subs = new Map((ps.length ? await api.find("gab.subject", { id: { in: ps.map((x) => String(x.subjectId)) } }, { take: 1000 }) : []).map((x) => [String(x.id), x]));
        for (const x of ps) partnerNames.set(String(x.id), String(subs.get(String(x.subjectId))?.name ?? x.accountNum ?? ""));
      }
      const keys = ["MarkSettle", "MarkSettleHint", "MarkSettleAll", "SettleSearch", "Vs", "SettleLine", "SettleRemaining", "MarkJournal", "SettlePartner", "SettleStatus", "SettleSave", "SettleNone2", "Text"];
      return {
        texts: { ...Object.fromEntries(keys.map((k) => [k, t(`@GL:${k}`)])), Date: t("@SYS:Date"), Amount: t("@SYS:Amount") },
        doc: { num: doc.num, partnerName: doc.partnerName, remaining: doc.remaining, vs: doc.vs },
        rows: rows
          .sort((a, b) => (marked.has(String(a.id)) ? 0 : 1) - (marked.has(String(b.id)) ? 0 : 1) || String(b.date ?? "").localeCompare(String(a.date ?? "")))
          .slice(0, 200)
          .map((l) => {
            const p = linePartner(l);
            const j = journals.get(String(l.journalId));
            return {
              lineId: String(l.id),
              journal: [j?.journalNum, j?.description].filter(Boolean).join(" · "),
              date: String(l.date ?? j?.date ?? "").slice(0, 10),
              text: String(l.text ?? ""),
              vs: String(l.vs ?? ""),
              amount: fromCents(lineAmount(l)),
              partnerName: p ? (partnerNames.get(p.id) ?? "") : "",
              status: String(l.settleStatus ?? "none"),
              marked: marked.has(String(l.id)),
            };
          }),
      };
    },
    client,
  );
}

/** Uložit: doklad se přidá k vyrovnání vybraného řádku deníku (stávající vyrovnání stejného druhu zůstanou). */
export async function markSettleSave(ctx: Ctx, objectId: string, id: string, lineId: string, amount: string, client: PrismaClient = prisma): Promise<void> {
  if (!UUID.test(lineId)) throw new UserError("@SYS:InvalidValue");
  if (!can(ctx.perms, "gl.journalLine", "write")) throw new UserError("@SYS:NoAccess");
  if (amount && !/^-?\d+([.,]\d{1,2})?$/.test(amount.replace(/\s/g, ""))) throw new UserError("@SYS:InvalidValue");
  await inTenant(
    ctx,
    async (s) => {
      if (!(await s.api().get(objectId, id))) throw new UserError("@SYS:NotFound");
      const line = await s.api().get("gl.journalLine", lineId);
      if (!line) throw new UserError("@SYS:NotFound");
      const journal = await s.api().get("gl.journal", String(line.journalId));
      if (journal?.status === "posted") throw new UserError("@GL:Locked");
      const api = s.sys().api();
      const doc = await docTarget(api, objectId, id);
      const f = refField(doc.kind, doc.type);
      const existing = (await api.find("gl.journalSettlement", { journalLineId: lineId }, { take: 500 })).filter((x) => (x.settleKind ?? "invoice") === doc.type && x.partnerType === doc.kind);
      const items = existing.filter((x) => String(x[f]) !== doc.transId).map((x) => ({ kind: doc.kind, type: doc.type, transId: String(x[f]), amount: String(x.amount).replace("-", "") }));
      items.push({ kind: doc.kind, type: doc.type, transId: doc.transId, amount: amount ? fromCents(toCents(amount.replace(/\s/g, "").replace(",", "."))) : "" });
      await saveSettlement(api, line, items);
    },
    client,
  );
}
