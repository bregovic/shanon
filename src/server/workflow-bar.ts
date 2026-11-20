/**
 * Proužek workflow nad detailem záznamu (jako v AX): poslední běh workflow záznamu, aktuální krok, otevřené úkoly
 * s tlačítky (Schválit / Zamítnout / Hotovo — jen řešitel, nepřiřazený úkol kdo smí upravovat úkoly, superuživatel)
 * a historie všech kroků. Obecně pro každý objekt; bez běhu workflow nic.
 */
import type { RecordData } from "@/core/module";
import { ADMIN, can } from "@/core/security";
import { UserError } from "@/core/module";
import { inTenant, runAction, saveRecord, type Ctx } from "./data";

export interface WorkflowBarItem {
  id: string;
  title: string;
  kind: string;
  kindLabel: string;
  status: string;
  statusLabel: string;
  assignee: string | null;
  dueDate: string | null;
  createdAt: string;
  completedAt: string | null;
  completedBy: string | null;
  result: string | null;
  description: string | null;
  /** smí přihlášený úkol vyřídit */
  canAct: boolean;
}

export interface WorkflowBarData {
  instanceId: string;
  definition: string;
  status: string;
  statusLabel: string;
  stepName: string | null;
  message: string | null;
  canCancel: boolean;
  open: WorkflowBarItem[];
  history: (WorkflowBarItem & { workflow: string })[];
  runs: number;
}

const iso = (v: unknown) => (v ? String(v instanceof Date ? v.toISOString() : v) : null);

/** Řešitel smí úkol vyřídit; nepřiřazený kdo smí upravovat úkoly; superuživatel vždy. */
function mayAct(ctx: Ctx, w: RecordData): boolean {
  if (w.status !== "open") return false;
  if (ctx.perms.admin || w.assignedTo === ctx.userId) return true;
  return !w.assignedTo && can(ctx.perms, "wf.workItem", "write");
}

export async function workflowBar(ctx: Ctx, objectId: string, id: string, t: (ref: string) => string): Promise<WorkflowBarData | null> {
  if (!ctx.modules.has("wf") || !ctx.companyId || objectId.startsWith("wf.") || objectId.startsWith("sys.")) return null;
  return inTenant(ctx, async (s) => {
    const sys = s.sys();
    const runs = await sys.find("wf.instance", { refObject: objectId, refId: id }, 20, { createdAt: "desc" });
    if (!runs.length) return null;
    // definic je ve firmě pár — jednou všechny (find neumí filtr podle id)
    const defs = await sys.find("wf.definition", {}, 200);
    const defName = new Map(defs.map((d) => [String(d.id), String(d.name)]));
    const items = await sys.find("wf.workItem", { instanceId: { in: runs.map((r) => String(r.id)) } }, 500, { createdAt: "asc" });
    const names = new Map((ctx.users ?? []).map((u) => [u.id, u.name]));
    // řešitelé mimo uživatele firmy (odešel, jiná firma): jména jedním dotazem (aplikační role čte jen id a jméno)
    const missing = [...new Set(items.flatMap((w) => [w.assignedTo, w.completedBy]).filter((v): v is string => !!v && !names.has(String(v))))];
    if (missing.length) for (const u of await s.tx.sysUser.findMany({ where: { tenantId: ctx.tenantId, id: { in: missing } }, select: { id: true, name: true } })) names.set(u.id, u.name);
    const user = (v: unknown) => (v ? (names.get(String(v)) ?? "—") : null);
    const toItem = (w: RecordData): WorkflowBarItem => ({
      id: String(w.id),
      title: String(w.title ?? ""),
      kind: String(w.kind),
      kindLabel: t(`@WF:Kind${String(w.kind).charAt(0).toUpperCase()}${String(w.kind).slice(1)}`),
      status: String(w.status),
      statusLabel: t(`@WF:Status${String(w.status).charAt(0).toUpperCase()}${String(w.status).slice(1)}`),
      assignee: user(w.assignedTo),
      dueDate: iso(w.dueDate),
      createdAt: iso(w.createdAt) ?? "",
      completedAt: iso(w.completedAt),
      completedBy: user(w.completedBy),
      result: (w.result as string) ?? null,
      description: (w.description as string) ?? null,
      canAct: mayAct(ctx, w),
    });
    // proužek ukazuje běh, který čeká (jinak poslední)
    const cur = runs.find((r) => r.status === "waiting" || r.status === "running") ?? runs[0];
    const st = String(cur.status);
    const statusKey = { running: "InstRunning", waiting: "InstWaiting", completed: "InstCompleted", rejected: "InstRejected", cancelled: "StatusCancelled" }[st] ?? "InstRunning";
    return {
      instanceId: String(cur.id),
      definition: defName.get(String(cur.definitionId)) ?? "",
      status: st,
      statusLabel: t(`@WF:${statusKey}`),
      // krok a zpráva jen u běhu, který čeká (dokončený ukazuje stav a historii)
      stepName: st === "waiting" || st === "running" ? ((cur.stepName as string) ?? null) : null,
      message: st === "waiting" || st === "running" || st === "rejected" ? ((cur.message as string) ?? null) : null,
      canCancel: (st === "waiting" || st === "running") && (ctx.perms.admin || can(ctx.perms, "wf.workItem", "write")),
      open: items.filter((w) => String(w.instanceId) === String(cur.id) && w.status === "open").map(toItem),
      history: items.map((w) => ({ ...toItem(w), workflow: defName.get(String(runs.find((r) => String(r.id) === String(w.instanceId))?.definitionId)) ?? "" })).reverse(),
      runs: runs.length,
    };
  });
}

/**
 * Vyřídit úkol z proužku: komentář do výsledku, pak akce (approve / reject / done). Řešitel úkolu smí, i když nemá
 * právo upravovat agendu úkolů (úkol mu workflow přidělilo) — jen tento úkol, s jeho jménem v Dokončil.
 */
export async function actOnWorkItem(ctx: Ctx, itemId: string, action: "approve" | "reject" | "done", comment: string | null) {
  const w = await inTenant(ctx, (s) => s.sys().get("wf.workItem", itemId));
  if (!w) throw new UserError("@SYS:NotFound");
  if (!mayAct(ctx, w)) throw new UserError("@SYS:NoAccess");
  if (action === "approve" && w.kind !== "approval") throw new UserError("@SYS:Locked");
  const asAssignee: Ctx = { ...ctx, perms: ADMIN };
  if (comment?.trim()) await saveRecord(asAssignee, "wf.workItem", itemId, { result: comment.trim().slice(0, 255) });
  await runAction(asAssignee, "wf.workItem", itemId, action);
}

/** Zrušit běh workflow z proužku. */
export async function cancelWorkflowRun(ctx: Ctx, instanceId: string) {
  if (!ctx.perms.admin && !can(ctx.perms, "wf.workItem", "write")) throw new UserError("@SYS:NoAccess");
  await runAction({ ...ctx, perms: ADMIN }, "wf.instance", instanceId, "cancel");
}
