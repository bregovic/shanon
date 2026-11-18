/**
 * Přehled „Moje úkoly“ (úvodní stránka): otevřené pracovní položky přihlášeného + počet nepřiřazených
 * (jen pro toho, kdo smí číst celou agendu Workflow). Vlastní úkoly vidí řešitel vždy.
 */
import "server-only";
import { inTenant, type Ctx } from "./data";
import { can } from "@/core/security";
import type { T } from "./i18n";
import { registry } from "@/registry";

export interface MyTask {
  id: string;
  title: string;
  kind: string;
  kindLabel: string;
  kindColor?: string;
  refTitle: string | null;
  href: string;
  taskHref: string;
  due: string | null;
  overdue: boolean;
}

export interface MyTasks {
  items: MyTask[];
  total: number;
  unassigned: number | null;
}

export async function myTasks(ctx: Ctx, t: T): Promise<MyTasks | null> {
  if (!ctx.modules.has("wf") || !ctx.companyId) return null;
  const kinds = registry.enums.get("WfWorkItemKind")!.values;
  const today = new Date().toISOString().slice(0, 10);
  return inTenant(ctx, async (s) => {
    const sys = s.sys();
    const mine = await sys.list("wf.workItem", { filters: { assignedTo: "me", status: "open" }, sort: "dueDate", dir: "asc", pageSize: 10 });
    const unassigned = can(ctx.perms, "wf.workItem", "read") ? (await sys.list("wf.workItem", { filters: { assignedTo: '""', status: "open" }, pageSize: 1 })).total : null;
    return {
      total: mine.total,
      unassigned,
      items: mine.rows.map((w) => {
        const k = kinds.find((x) => x.value === w.kind);
        const due = w.dueDate ? String(w.dueDate).slice(0, 10) : null;
        return {
          id: String(w.id),
          title: String(w.title),
          kind: String(w.kind),
          kindLabel: k ? t(k.label) : String(w.kind),
          kindColor: k?.color,
          refTitle: (w.refTitle as string) ?? null,
          href: (w.href as string) || `/wf/workItem/${w.id}`,
          taskHref: `/wf/workItem/${w.id}`,
          due,
          overdue: !!due && due < today,
        };
      }),
    };
  });
}
