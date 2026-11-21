/**
 * Zapnout moduly ve firmě i s výchozím nastavením (řady, účty, workflow…) — Správa systému → Moduly,
 * údržbové skripty a testy. Firma bez vlastního nastavení (starší data) nejdřív převezme dosavadní moduly.
 */
import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { dependencyClosure } from "@/core/module";
import type { Lang } from "@/core/labels";
import { registry } from "@/registry";
import { inTenant, type Ctx } from "./data";
import { companyModules, enableCompanyModules } from "./modules";
import { prisma } from "./db";
import { setupCompany } from "./setup";
import { copyDatTemplates } from "./dat";

/** Vrací nově zapnuté moduly. `ctx.modules` = moduly, které firma má teď. */
export async function enableModulesWithSetup(ctx: Ctx, companyId: string, ids: string[], lang: Lang = "cs", client: PrismaClient = prisma): Promise<string[]> {
  const tenantMods = (await client.sysTenantModule.findMany({ where: { tenantId: ctx.tenantId }, select: { moduleId: true } })).map((m) => m.moduleId);
  const current = await companyModules(ctx.tenantId, companyId, tenantMods, client);
  const added = [...dependencyClosure(registry, ids)].filter((m) => registry.modules.has(m) && !current.has(m));
  await enableCompanyModules(ctx.tenantId, companyId, [...current, ...added], client);
  const enabled = new Set([...current, ...added]);
  if (added.length)
    await inTenant(
      { ...ctx, companyId, modules: enabled },
      async (s) => {
        // parametry modulů ze Společných dat (DAT), výchozí nastavení je pak nepřepisuje
        await copyDatTemplates(s, added);
        return setupCompany(s.sys().api(), new Set(added), lang);
      },
      client,
    );
  return added;
}
