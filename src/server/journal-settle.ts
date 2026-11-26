/**
 * Dialog Vyrovnat u řádku deníku: otevřené položky salda k vyrovnání a uložení výběru.
 * Čtení a zápis řádku jdou přes datovou službu uživatele (právo na řádky deníku, zamčený deník);
 * logika vyrovnání je v `src/modules/gl/settlement.ts`.
 */
import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { UserError } from "@/core/module";
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
