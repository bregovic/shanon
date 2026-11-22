/**
 * Akce a dávkové úlohy, které volají síť a proto běží mimo databázovou
 * transakci (`ObjectDef.actions[].outside`, `JobDef.outside`). Oprávnění
 * a podmínky akce ověří předem `runAction` v transakci; tady je jen práce.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { UserError, type ActionOutcome } from "@/core/module";
import type { Ctx } from "./data";

type OutsideAction = (ctx: Ctx, id: string, client?: PrismaClient) => Promise<unknown>;
const outcome = (r: unknown): ActionOutcome | undefined => (r && typeof r === "object" && "open" in r ? (r as ActionOutcome) : undefined);

const ACTIONS: Record<string, () => Promise<OutsideAction>> = {
  "int.document:extract": async () => (await import("./doc-import")).extractDocument,
  "ar.invoice:email": async () => (await import("./mail")).invoiceMailDraft,
  "ar.advance:email": async () => (await import("./mail")).advanceMailDraft,
  "pos.receipt:email": async () => (await import("./mail")).receiptMailDraft,
  "int.mail:send": async () => (await import("./mail")).sendMail,
  // pozvánka do aplikace Portál (systémová pošta)
  "hr.employee:invite": async () => async (ctx: Ctx, id: string, client?: PrismaClient) => (await import("./portal-app")).inviteToPortal(ctx, "hr.employee", id, client),
  "int.portalContact:invite": async () => async (ctx: Ctx, id: string, client?: PrismaClient) => (await import("./portal-app")).inviteToPortal(ctx, "int.portalContact", id, client),
  // smazání firmy i s daty (superuživatel — sys.company je adminOnly, ověří runAction)
  // podání přiznání / kontrolního hlášení datovou schránkou (potvrzení opsáním období ověřilo UI a runAction)
  "tax.return:sendIsds": async () => (await import("./tax-isds")).sendReturnIsds,
  "sys.company:deleteWithData": async () => async (ctx: Ctx, id: string, client?: PrismaClient) => (await import("./company-delete")).deleteCompanyWithData(ctx, id, client),
};

const JOBS: Record<string, () => Promise<(ctx: Ctx, client?: PrismaClient) => Promise<string>>> = {
  "int.processDocuments": async () => (await import("./doc-import")).processPendingDocuments,
};

export async function runOutsideAction(ctx: Ctx, objectId: string, id: string, actionId: string, client?: PrismaClient): Promise<ActionOutcome | undefined> {
  const load = ACTIONS[`${objectId}:${actionId}`];
  if (!load) throw new UserError("@SYS:InvalidValue");
  return outcome(await (await load())(ctx, id, client));
}

export async function runOutsideJob(ctx: Ctx, jobClass: string, client?: PrismaClient): Promise<string> {
  const load = JOBS[jobClass];
  if (!load) throw new UserError("@SYS:BatchUnknownClass");
  return (await load())(ctx, client);
}
