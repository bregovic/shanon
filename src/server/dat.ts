/**
 * Společná data (DAT) — skrytá firma organizace s výchozí konfigurací pro firmy.
 *
 * - jedna na tenanta (`sys_company.dat`), v přepínači firem jen pro superuživatele (Správa systému → Společná data)
 * - parametry modulů s `ObjectDef.datTemplate` (účetnictví, DPH, sklad, odběratelé, dodavatelé): firma, která modul
 *   zapíná a parametry ještě nemá, je převezme z DAT (kopie — další úpravy jen ve firmě)
 * - odkazy na data jiné firmy (dodavatel FÚ, účty…) se nekopírují, jen na společné záznamy organizace (měny)
 */
import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { RecordData } from "@/core/module";
import { registry } from "@/registry";
import { prisma } from "./db";
import { Session, getObject } from "./data";
import { enableCompanyModules } from "./modules";

/** Firma DAT tenanta (založí ji, když chybí; moduly = moduly tenanta, bez výchozího nastavení). */
export async function ensureDat(tenantId: string, client: PrismaClient = prisma): Promise<string> {
  const have = await client.sysCompany.findFirst({ where: { tenantId, dat: true }, select: { id: true } });
  const mods = (await client.sysTenantModule.findMany({ where: { tenantId }, select: { moduleId: true } })).map((m) => m.moduleId);
  if (have) {
    await enableCompanyModules(tenantId, have.id, mods, client);
    return have.id;
  }
  const code = (await client.sysCompany.findFirst({ where: { tenantId, code: "DAT" }, select: { id: true } })) ? "DAT-SPOL" : "DAT";
  const c = await client.sysCompany.create({ data: { tenantId, code, name: "Společná data", currency: "CZK", country: "CZ", vatPayer: true, virtual: true, dat: true } });
  await enableCompanyModules(tenantId, c.id, mods, client);
  return c.id;
}

/** Hodnoty k převzetí: bez systémových polí a odkazů na data jednotlivých firem. */
function templateValues(objectId: string, rec: RecordData): RecordData {
  const def = getObject(objectId);
  const out: RecordData = {};
  for (const [name, f] of Object.entries(def.fields)) {
    const v = rec[name];
    if (v === null || v === undefined || f.readOnly || f.secret) continue;
    if (f.edt.kind === "ref") {
      const target = f.edt.refObject ? registry.objects.get(f.edt.refObject) : undefined;
      if (!target || target.scope !== "tenant") continue;
    }
    out[name] = v;
  }
  return out;
}

/**
 * Zapnutí modulů ve firmě: parametry z DAT (jen chybějící, jen moduly `moduleIds`). Vrací počet převzatých záznamů.
 * Volá se před výchozím nastavením modulů, které pak existující parametry nepřepisuje.
 */
export async function copyDatTemplates(s: Session, moduleIds: Iterable<string>): Promise<number> {
  const companyId = s.ctx.companyId;
  if (!companyId) return 0;
  const dat = await s.tx.sysCompany.findFirst({ where: { tenantId: s.ctx.tenantId, dat: true }, select: { id: true } });
  if (!dat || dat.id === companyId) return 0;
  const own = s.sys().api();
  const shared = new Session(s.tx, { ...s.ctx, companyId: dat.id }, true).api();
  let n = 0;
  for (const m of moduleIds) {
    for (const def of registry.modules.get(m)?.objects ?? []) {
      if (!def.datTemplate) continue;
      const [tpl] = await shared.find(def.id, {}, { take: 1 }).catch(() => []);
      if (!tpl) continue;
      if ((await own.find(def.id, {}, { take: 1 })).length) continue;
      await own.create(def.id, templateValues(def.id, tpl));
      n++;
    }
  }
  return n;
}
