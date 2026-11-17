/**
 * Zapnuté moduly po firmách (agenda firmy). `sys_company_module` = moduly zapnuté ve firmě,
 * `sys_tenant_module` = souhrn modulů zapnutých aspoň v jedné firmě tenanta (veřejné vstupy ho
 * používají jako rychlé předběžné filtrum). Firma bez vlastního nastavení (starší data) = moduly tenanta.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { dependencyClosure } from "@/core/module";
import { registry } from "@/registry";
import { prisma } from "./db";

/** Moduly + jejich závislosti, jen ty, které v kódu existují. */
export function moduleSet(ids: Iterable<string>): Set<string> {
  return new Set([...dependencyClosure(registry, ["sys", ...ids])].filter((m) => registry.modules.has(m)));
}

/** Zapnuté moduly firmy (bez firmy / bez vlastního nastavení = moduly tenanta). */
export async function companyModules(tenantId: string, companyId: string | null | undefined, tenantModuleIds: string[], client: PrismaClient = prisma): Promise<Set<string>> {
  if (!companyId) return moduleSet(tenantModuleIds);
  const rows = await client.sysCompanyModule.findMany({ where: { tenantId, companyId }, select: { moduleId: true } });
  return moduleSet(rows.length ? rows.map((r) => r.moduleId) : tenantModuleIds);
}

/** Zapnout moduly ve firmě (i se závislostmi); souhrn tenanta se doplní. */
export async function enableCompanyModules(tenantId: string, companyId: string, ids: Iterable<string>, client: PrismaClient = prisma): Promise<void> {
  const all = [...moduleSet(ids)];
  await client.sysCompanyModule.createMany({ data: all.map((moduleId) => ({ tenantId, companyId, moduleId })), skipDuplicates: true });
  await client.sysTenantModule.createMany({ data: all.map((moduleId) => ({ tenantId, moduleId })), skipDuplicates: true });
}

/** Vypnout moduly ve firmě; ze souhrnu tenanta zmizí ty, které už nemá zapnuté žádná firma (jádro zůstává). */
export async function disableCompanyModules(tenantId: string, companyId: string, ids: string[], client: PrismaClient = prisma): Promise<void> {
  await client.sysCompanyModule.deleteMany({ where: { tenantId, companyId, moduleId: { in: ids } } });
  const still = new Set((await client.sysCompanyModule.findMany({ where: { tenantId, moduleId: { in: ids } }, select: { moduleId: true } })).map((r) => r.moduleId));
  const drop = ids.filter((m) => !still.has(m) && !registry.modules.get(m)?.core);
  if (drop.length) await client.sysTenantModule.deleteMany({ where: { tenantId, moduleId: { in: drop } } });
}
