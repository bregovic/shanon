/**
 * Pracovní položky — založení, uzavření a akce (logika nad DataApi).
 *
 * `createWorkItem` = obecné založení úkolu z logiky libovolného modulu; otevřený úkol se stejným
 * `sourceKey` se nezakládá znovu (jen se aktualizuje text). Řešitel dostane osobní upozornění
 * ve zvonečku. `closeWorkItems` uzavře otevřené úkoly záznamu / klíče (doklad vyřízen jinou cestou).
 * Bez zapnutého modulu Workflow ve firmě se nic nezakládá (volající to nemusí řešit).
 */
import { UserError, type DataApi, type ObjectHandlers, type RecordData } from "@/core/module";
import { notify } from "@/modules/sys/notify";
import { registry } from "@/registry";

export interface NewWorkItem {
  title: string;
  kind?: "task" | "fix" | "review" | "approval";
  assignedTo?: string | null;
  description?: string | null;
  dueDate?: string | null;
  ref?: { object: string; id: string; title?: string | null; href?: string | null };
  sourceKey?: string | null;
  /** běh workflow a krok, ze kterého úkol vzniká */
  instanceId?: string | null;
  stepNum?: number | null;
  /** upozornit řešitele ve zvonečku (výchozí ano) */
  notify?: boolean;
}

const hrefOf = (object: string, id: string) => `/${object.replace(".", "/")}/${id}`;

/** Založit úkol (nebo aktualizovat otevřený se stejným klíčem). Vrátí null, když Workflow ve firmě není. */
export async function createWorkItem(data: DataApi, w: NewWorkItem): Promise<RecordData | null> {
  let open: RecordData[] = [];
  try {
    open = w.sourceKey ? await data.find("wf.workItem", { sourceKey: w.sourceKey, status: "open" }, { take: 1 }) : [];
  } catch {
    return null; // modul Workflow vypnutý
  }
  const values: RecordData = {
    title: w.title.slice(0, 120),
    kind: w.kind ?? "task",
    assignedTo: w.assignedTo ?? null,
    description: w.description ?? null,
    dueDate: w.dueDate ?? null,
    refObject: w.ref?.object ?? null,
    refId: w.ref?.id ?? null,
    refTitle: w.ref?.title ? String(w.ref.title).slice(0, 120) : null,
    href: w.ref ? (w.ref.href ?? hrefOf(w.ref.object, w.ref.id)).slice(0, 255) : null,
    sourceKey: w.sourceKey ?? null,
    ...(w.instanceId ? { instanceId: w.instanceId, stepNum: w.stepNum ?? null } : {}),
  };
  if (open[0]) return data.update("wf.workItem", String(open[0].id), values);
  const item = await data.create("wf.workItem", { ...values, status: "open" });
  if (w.notify !== false)
    await notify(data, {
      kind: w.kind === "fix" ? "warning" : "info",
      title: "@WF:NotifyAssigned",
      params: { title: values.title as string },
      message: (w.description ?? "").slice(0, 255) || null,
      href: `/wf/workItem/${item.id}`,
      userId: w.assignedTo ?? null,
    });
  return item;
}

/** Uzavřít otevřené úkoly podle klíče (přesně, nebo začátkem `prefix*`) nebo záznamu. */
export async function closeWorkItems(data: DataApi, by: { sourceKey?: string; ref?: { object: string; id: string } }, status: "done" | "cancelled" = "done", result?: string, userId?: string | null): Promise<number> {
  let rows: RecordData[];
  try {
    rows = by.sourceKey
      ? await data.find("wf.workItem", { sourceKey: by.sourceKey, status: "open" }, { take: 100 })
      : by.ref
        ? await data.find("wf.workItem", { refObject: by.ref.object, refId: by.ref.id, status: "open" }, { take: 100 })
        : [];
  } catch {
    return 0;
  }
  for (const r of rows) await data.update("wf.workItem", String(r.id), { status, result: result?.slice(0, 255) ?? r.result ?? null, completedAt: new Date().toISOString(), completedBy: userId ?? null });
  return rows.length;
}

/** Zrušit čekající běhy workflow záznamu i s otevřenými úkoly (doklad odmítnut). */
export async function cancelWorkflows(data: DataApi, objectId: string, id: string, userId?: string | null): Promise<number> {
  let runs: RecordData[];
  try {
    runs = (await data.find("wf.instance", { refObject: objectId, refId: id }, { take: 20 })).filter((i) => i.status === "waiting" || i.status === "running");
  } catch {
    return 0; // Workflow ve firmě vypnuté
  }
  const now = new Date().toISOString();
  for (const i of runs) {
    await data.update("wf.instance", String(i.id), { status: "cancelled", completedAt: now });
    for (const w of await data.find("wf.workItem", { instanceId: i.id, status: "open" }, { take: 100 }))
      await data.update("wf.workItem", String(w.id), { status: "cancelled", completedAt: now, completedBy: userId ?? null });
  }
  return runs.length;
}

/** Podmínka workflow „pole: výraz; pole: výraz“ → dvojice (výraz ve tvaru filtru sloupce seznamu). */
export function parseCondition(text: unknown): [string, string][] {
  return String(text ?? "")
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const at = p.indexOf(":");
      return (at < 0 ? [p, ""] : [p.slice(0, at).trim(), p.slice(at + 1).trim()]) as [string, string];
    });
}

/** akce objektu, kterou smí spustit automatický krok (v transakci, bez souboru) */
export function autoActionOk(objectId: string, actionId: string): boolean {
  const a = registry.objects.get(objectId)?.actions?.find((x) => x.id === actionId);
  return !!a && !a.outside && !a.upload && !a.download;
}

function conditionErrors(objectId: string, text: unknown): string | null {
  const def = registry.objects.get(objectId);
  if (!def) return null;
  for (const [f] of parseCondition(text)) if (!(f in def.fields)) return f;
  return null;
}

async function closeItem(data: DataApi, w: RecordData, status: string, userId: string) {
  if (w.status !== "open") throw new UserError("@SYS:Locked");
  await data.update("wf.workItem", String(w.id), { status, completedAt: new Date().toISOString(), completedBy: userId });
}

export const wfHandlers: Record<string, ObjectHandlers> = {
  "wf.workItem": {
    actions: {
      async openRecord(_ctx, w) {
        if (!w.refObject || !w.refId) throw new UserError("@WF:NoRecord");
        return { open: { object: String(w.refObject), id: String(w.refId) } };
      },
      // pokračování běhu workflow (další krok / zamítnutí) řídí jádro po akci (src/server/workflow.ts)
      async done(ctx, w) {
        await closeItem(ctx.data, w, "done", ctx.userId);
      },
      async approve(ctx, w) {
        await closeItem(ctx.data, w, "done", ctx.userId);
      },
      async reject(ctx, w) {
        await closeItem(ctx.data, w, "rejected", ctx.userId);
      },
      async cancel(ctx, w) {
        await closeItem(ctx.data, w, "cancelled", ctx.userId);
      },
    },
  },
  "wf.instance": {
    actions: {
      async openRecord(_ctx, i) {
        if (!i.refObject || !i.refId) throw new UserError("@WF:NoRecord");
        return { open: { object: String(i.refObject), id: String(i.refId) } };
      },
      async cancel(ctx, i) {
        if (i.status !== "waiting" && i.status !== "running") throw new UserError("@SYS:Locked");
        await cancelWorkflows(ctx.data, String(i.refObject), String(i.refId), ctx.userId);
      },
    },
  },
  "wf.definition": {
    beforeSave(_ctx, d) {
      const e: Record<string, string> = {};
      const def = registry.objects.get(String(d.objectId ?? ""));
      if (!def) e.objectId = "@WF:BadObject";
      else {
        if (d.trigger === "action" && !def.actions?.some((a) => a.id === d.triggerName)) e.triggerName = "@WF:BadAction";
        if (d.trigger === "event" && !d.triggerName) e.triggerName = "@WF:NeedTriggerName";
        if (conditionErrors(def.id, d.condition)) e.condition = "@WF:BadCondition";
        const bad = String(d.lockActions ?? "")
          .split(/[,\s]+/)
          .filter(Boolean)
          .find((x) => !def.actions?.some((a) => a.id === x));
        if (bad) e.lockActions = "@WF:BadAction";
      }
      if (Object.keys(e).length) return e;
    },
  },
  "wf.definitionStep": {
    async beforeSave(ctx, d) {
      const e: Record<string, string> = {};
      const head = d.definitionId ? await ctx.data.get("wf.definition", String(d.definitionId)) : null;
      const obj = String(head?.objectId ?? "");
      if (d.kind === "auto") {
        if (!d.action) e.action = "@WF:NeedAction";
        else if (!autoActionOk(obj, String(d.action))) e.action = "@WF:BadAction";
      }
      if (d.checkAction && !autoActionOk(obj, String(d.checkAction))) e.checkAction = "@WF:BadAction";
      if (conditionErrors(obj, d.precondition)) e.precondition = "@WF:BadCondition";
      if (conditionErrors(obj, d.condition)) e.condition = "@WF:BadCondition";
      if (d.assignTo === "participant" && !d.participantTypeId) e.participantTypeId = "@WF:NeedParticipant";
      if (d.assignTo === "user" && !d.userId) e.userId = "@WF:NeedUser";
      if (Object.keys(e).length) return e;
    },
  },
};

