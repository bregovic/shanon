/**
 * Přehled „Moje úkoly“ (úvodní stránka): otevřené pracovní položky přihlášeného + počet nepřiřazených
 * (jen pro toho, kdo smí číst celou agendu Workflow). Vlastní úkoly vidí řešitel vždy.
 * Pořadí: po termínu → podle termínu → bez termínu od nejstaršího; počty podle druhu do hlavičky.
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
  refObject: string | null;
  refId: string | null;
  /** co chybí / k čemu úkol je (zkráceně) */
  description: string | null;
  href: string;
  taskHref: string;
  due: string | null;
  overdue: boolean;
  /** dny od zadání */
  ageDays: number;
}

export interface MyTasks {
  items: MyTask[];
  total: number;
  unassigned: number | null;
  /** počty podle druhu (jen zobrazené, v pořadí výčtu) */
  byKind: { kind: string; label: string; color?: string; count: number }[];
  overdue: number;
}

const SHOWN = 12;

export async function myTasks(ctx: Ctx, t: T): Promise<MyTasks | null> {
  if (!ctx.modules.has("wf") || !ctx.companyId) return null;
  const kinds = registry.enums.get("WfWorkItemKind")!.values;
  const today = new Date().toISOString().slice(0, 10);
  return inTenant(ctx, async (s) => {
    const sys = s.sys();
    // dost řádků na řazení po termínu nahoru (víc úkolů = odkaz Všechny)
    const mine = await sys.list("wf.workItem", { filters: { assignedTo: "me", status: "open" }, sort: "createdAt", dir: "asc", pageSize: 100 });
    const unassigned = can(ctx.perms, "wf.workItem", "read") ? (await sys.list("wf.workItem", { filters: { assignedTo: '""', status: "open" }, pageSize: 1 })).total : null;
    const items = mine.rows.map((w): MyTask => {
      const k = kinds.find((x) => x.value === w.kind);
      const due = w.dueDate ? String(w.dueDate).slice(0, 10) : null;
      const title = String(w.title);
      const ref = (w.refTitle as string) ?? null;
      const desc = String(w.description ?? "").replace(/\s+/g, " ").trim();
      return {
        id: String(w.id),
        title,
        kind: String(w.kind),
        kindLabel: k ? t(k.label) : String(w.kind),
        kindColor: k?.color,
        // název záznamu jen když už není v názvu úkolu
        refTitle: ref && !title.includes(ref) ? ref : null,
        refObject: (w.refObject as string) ?? null,
        refId: (w.refId as string) ?? null,
        description: desc ? (desc.length > 160 ? `${desc.slice(0, 157)}…` : desc) : null,
        href: (w.href as string) || `/wf/workItem/${w.id}`,
        taskHref: `/wf/workItem/${w.id}`,
        due,
        overdue: !!due && due < today,
        ageDays: Math.max(0, Math.floor((Date.now() - new Date(String(w.createdAt)).getTime()) / 86_400_000)),
      };
    });
    items.sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.due ?? "9999").localeCompare(b.due ?? "9999") || b.ageDays - a.ageDays);
    const byKind = kinds
      .map((k) => ({ kind: k.value, label: t(k.label), color: k.color, count: items.filter((i) => i.kind === k.value).length }))
      .filter((k) => k.count > 0);
    return { total: mine.total, unassigned, items: items.slice(0, SHOWN), byKind, overdue: items.filter((i) => i.overdue).length };
  });
}
