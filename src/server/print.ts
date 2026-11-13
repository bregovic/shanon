/**
 * Tisk dokladů podle šablon (Tiskové sestavy): data dokladu, výběr šablony,
 * katalog polí pro návrhář. Oprávnění: tisk = právo číst doklad.
 */
import { UserError, type RecordData } from "@/core/module";
import { can } from "@/core/security";
import type { PrintLayout, PrintableDef } from "@/core/print";
import { labelTable, registry, modules } from "@/registry";
import { resolveLabel } from "@/core/labels";
import { inTenant, type Ctx } from "./data";
import type { PrismaClient } from "@/generated/prisma/client";

export function findPrintable(docType: string): PrintableDef | null {
  for (const m of modules) for (const p of m.printables ?? []) if (p.id === docType) return p;
  return null;
}

/** Tisknutelné doklady zapnutých modulů, které uživatel smí číst. */
export function printablesFor(ctx: Ctx): PrintableDef[] {
  return modules.filter((m) => ctx.modules.has(m.id)).flatMap((m) => m.printables ?? []).filter((p) => can(ctx.perms, p.id, "read"));
}

function assertPrintable(ctx: Ctx, docType: string): PrintableDef {
  const p = findPrintable(docType);
  if (!p || !ctx.modules.has(docType.split(".")[0]) || !can(ctx.perms, docType, "read")) throw new UserError("@SYS:NoAccess");
  return p;
}

export function parseLayout(raw: unknown, p: PrintableDef): PrintLayout {
  try {
    const l = JSON.parse(String(raw ?? "")) as PrintLayout;
    if (l && Array.isArray(l.elements)) return l;
  } catch {
    /* poškozené rozvržení → výchozí */
  }
  return p.defaultLayout();
}

/** Data dokladu a šablona (zvolená, jinak výchozí druhu). */
export async function printJob(ctx: Ctx, docType: string, recordId: string, templateId?: string | null, client?: PrismaClient) {
  const p = assertPrintable(ctx, docType);
  return inTenant(
    ctx,
    async (s) => {
      const api = s.sys().api();
      if (!(await s.get(docType, recordId))) throw new UserError("@SYS:NotFound");
      const templates = await api.find("prt.template", { docType }, { take: 50, orderBy: { code: "asc" } });
      const tpl = templates.find((t) => t.id === templateId) ?? templates.find((t) => t.isDefault) ?? templates[0] ?? null;
      const data = await p.dataset(api, ctx.companyId, recordId);
      // způsob platby účtenky v jazyce uživatele
      const doc = data.doc as Record<string, unknown> | undefined;
      if (doc && (doc.payment === "cash" || doc.payment === "card")) doc.payment = resolveLabel(labelTable, doc.payment === "cash" ? "@POS:Cash" : "@POS:Card", ctx.lang ?? "cs");
      const record = (await api.get(docType, recordId)) as RecordData;
      return {
        title: String(record[p.numberField] ?? ""),
        layout: tpl ? parseLayout(tpl.layout, p) : p.defaultLayout(),
        templateId: tpl ? String(tpl.id) : null,
        templates: templates.map((t) => ({ id: String(t.id), name: String(t.name) })),
        data,
      };
    },
    client,
  );
}

/** Poslední doklady druhu pro výběr v náhledu návrháře. */
export async function recentDocs(ctx: Ctx, docType: string, q = "") {
  const p = assertPrintable(ctx, docType);
  return inTenant(ctx, async (s) => {
    const r = await s.list(docType, { q: q || undefined, sort: "createdAt", dir: "desc", pageSize: 30 });
    return r.rows.map((x) => ({ id: String(x.id), number: String(x[p.numberField] ?? "") }));
  });
}

export function printableObjectIds(): Set<string> {
  return new Set(modules.flatMap((m) => (m.printables ?? []).map((p) => p.id)));
}

void registry;
