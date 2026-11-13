/** Běh reportu: oprávnění (číst zdrojové objekty), parametry, výsledek s popisky. */
import "server-only";
import { UserError, type RecordData } from "@/core/module";
import { defaultParams, type ReportDef } from "@/core/report";
import { can } from "@/core/security";
import { registry } from "@/registry";
import type { AppSession } from "./auth";
import { inTenant } from "./data";
import { getT } from "./i18n";

export function findReport(module: string, id: string): ReportDef | null {
  const mod = registry.modules.get(module);
  return mod?.reports?.find((r) => r.id === id) ?? null;
}

export function canRunReport(s: AppSession, module: string, def: ReportDef): boolean {
  return s.ctx.modules.has(module) && def.requires.every((o) => can(s.ctx.perms, o, "read"));
}

/** Parametry z požadavku: jen známé, s výchozími hodnotami. */
export function reportParams(def: ReportDef, input: RecordData): RecordData {
  const out = defaultParams(def);
  for (const p of def.params) {
    const v = input[p.name];
    if (v === undefined || v === null || v === "") continue;
    if (p.kind === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) continue;
    if (p.kind === "ref" && !/^[0-9a-f-]{36}$/i.test(String(v))) continue;
    out[p.name] = p.kind === "bool" ? v === true || v === "true" : String(v).slice(0, 40);
  }
  return out;
}

export async function runReport(s: AppSession, module: string, id: string, input: RecordData) {
  const def = findReport(module, id);
  if (!def || !canRunReport(s, module, def)) throw new UserError("@SYS:NoAccess");
  const t = await getT(s.lang, s.ctx.tenantId);
  const params = reportParams(def, input);
  const res = await inTenant(s.ctx, (sess) => def.run(sess.sys().api(), params, { companyId: s.ctx.companyId, t }));
  return {
    params,
    columns: res.columns.map((c) => ({ ...c, label: t(c.label) })),
    rows: res.rows,
  };
}
