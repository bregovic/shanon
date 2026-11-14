/**
 * Akce a dávkové úlohy, které volají síť a proto běží mimo databázovou
 * transakci (`ObjectDef.actions[].outside`, `JobDef.outside`). Oprávnění
 * a podmínky akce ověří předem `runAction` v transakci; tady je jen práce.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { UserError } from "@/core/module";
import type { Ctx } from "./data";

type OutsideAction = (ctx: Ctx, id: string, client?: PrismaClient) => Promise<unknown>;

const ACTIONS: Record<string, () => Promise<OutsideAction>> = {
  "int.document:extract": async () => (await import("./doc-import")).extractDocument,
  "int.document:list": async () => (await import("./doc-import")).listDocumentWithFile,
};

const JOBS: Record<string, () => Promise<(ctx: Ctx, client?: PrismaClient) => Promise<string>>> = {
  "int.processDocuments": async () => (await import("./doc-import")).processPendingDocuments,
};

export async function runOutsideAction(ctx: Ctx, objectId: string, id: string, actionId: string, client?: PrismaClient): Promise<void> {
  const load = ACTIONS[`${objectId}:${actionId}`];
  if (!load) throw new UserError("@SYS:InvalidValue");
  await (await load())(ctx, id, client);
}

export async function runOutsideJob(ctx: Ctx, jobClass: string, client?: PrismaClient): Promise<string> {
  const load = JOBS[jobClass];
  if (!load) throw new UserError("@SYS:BatchUnknownClass");
  return (await load())(ctx, client);
}
