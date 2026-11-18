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

export interface NewWorkItem {
  title: string;
  kind?: "task" | "fix" | "review" | "approval";
  assignedTo?: string | null;
  description?: string | null;
  dueDate?: string | null;
  ref?: { object: string; id: string; title?: string | null; href?: string | null };
  sourceKey?: string | null;
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

export const wfHandlers: Record<string, ObjectHandlers> = {
  "wf.workItem": {
    actions: {
      async openRecord(_ctx, w) {
        if (!w.refObject || !w.refId) throw new UserError("@WF:NoRecord");
        return { open: { object: String(w.refObject), id: String(w.refId) } };
      },
      async done(ctx, w) {
        if (w.status !== "open") throw new UserError("@SYS:Locked");
        await ctx.data.update("wf.workItem", String(w.id), { status: "done", completedAt: new Date().toISOString(), completedBy: ctx.userId });
      },
      async cancel(ctx, w) {
        if (w.status !== "open") throw new UserError("@SYS:Locked");
        await ctx.data.update("wf.workItem", String(w.id), { status: "cancelled", completedAt: new Date().toISOString(), completedBy: ctx.userId });
      },
    },
  },
};

