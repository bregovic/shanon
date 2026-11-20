/**
 * Jádro workflow (CR-098): spouštění definic, postup kroky, úkoly, zamčené akce.
 *
 * Spouštěče sbírá datová služba během operace (`queueWorkflow`: založení záznamu, provedená akce) a modul
 * (`fireWorkflowEvent`: např. int.document „extracted“); vyhodnotí je `flushWorkflow` na konci operace
 * ve stejné transakci (`inTenant`) — doklad tak má i řádky, které operace založila po hlavičce.
 *
 * Běh (`wf.instance`) jde kroky definice podle pořadí:
 * - podmínka kroku nesplněna → krok se přeskočí;
 * - automatická akce = akce objektu (Zaúčtovat, Zalistovat…) spuštěná systémově; při opakování nejdřív kontrola,
 *   pak předpoklad (zápis jako filtr). Nesplněný předpoklad nebo chyba akce → úkol Doplnit údaje (změny akce
 *   se vrátí savepointem) a běh čeká; Hotovo úkolu krok zopakuje, ruční provedení té akce běh posune dál;
 * - úkol / schválení → pracovní položka a běh čeká; Hotovo / Schválit = další krok, Zamítnout = konec.
 * Komu: původce (`ObjectHandlers.originator`, jinak kdo záznam založil), typ účastníka firmy, uživatel —
 * když vybraný nikoho nemá, dostane úkol druhý z dvojice původce / typ účastníka.
 */
import { UserError, type RecordData } from "@/core/module";
import { closeWorkItems, createWorkItem, parseCondition } from "@/modules/wf/work";
import { notify } from "@/modules/sys/notify";
import { registry } from "@/registry";
import type { Session } from "./data";

export interface WorkflowEvent {
  kind: "created" | "action" | "event";
  objectId: string;
  id: string;
  /** id akce / název události */
  name?: string;
  /** akci spustil sám krok workflow (nepokračuje tím čekající krok) */
  byWorkflow?: boolean;
}

/** fronta transakce: událost + relace, ve které vznikla (firma, uživatel — nastavení firmy zakládá relace jiné firmy) */
const QUEUE = new WeakMap<object, { s: Session; ev: WorkflowEvent }[]>();
const FLUSHING = new WeakSet<object>();
const LIVE = ["running", "waiting"];

/** Zařadit spouštěč (vyhodnotí se na konci operace). Bez Workflow ve firmě nic. */
export function queueWorkflow(s: Session, ev: WorkflowEvent) {
  if (!s.ctx.modules.has("wf") || !s.ctx.companyId) return;
  const mod = ev.objectId.split(".")[0];
  if (mod === "sys") return;
  // vlastní objekty Workflow: jen akce nad úkolem (Hotovo, Schválit…)
  if (mod === "wf" && !(ev.kind === "action" && ev.objectId === "wf.workItem")) return;
  let q = QUEUE.get(s.tx);
  if (!q) QUEUE.set(s.tx, (q = []));
  q.push({ s: s.sys(), ev });
}

/** Událost modulu (např. vytěženo) — spustí definice se spouštěčem „událost“ hned. */
export async function fireWorkflowEvent(s: Session, objectId: string, id: string, name: string) {
  queueWorkflow(s, { kind: "event", objectId, id, name });
  await flushWorkflow(s);
}

export async function flushWorkflow(s: Session) {
  const q = QUEUE.get(s.tx);
  if (!q?.length || FLUSHING.has(s.tx)) return;
  FLUSHING.add(s.tx);
  try {
    for (let guard = 0; q.length && guard < 500; guard++) {
      const { s: es, ev } = q.shift()!;
      await handle(es, ev);
    }
  } finally {
    FLUSHING.delete(s.tx);
  }
}

/** Záznam čeká ve workflow, které akci zamyká → chyba (kromě akce, na kterou čeká automatický krok). */
export async function workflowLock(s: Session, objectId: string, id: string, actionId: string) {
  if (!s.ctx.modules.has("wf") || !s.ctx.companyId || objectId.startsWith("wf.") || objectId.startsWith("sys.")) return;
  const sys = s.sys();
  const waiting = await sys.find("wf.instance", { refObject: objectId, refId: id, status: "waiting" }, 10);
  for (const inst of waiting) {
    const def = await sys.get("wf.definition", String(inst.definitionId));
    const locked = String(def?.lockActions ?? "")
      .split(/[,\s]+/)
      .includes(actionId);
    if (!locked) continue;
    const step = await stepOf(sys, inst);
    if (step?.kind === "auto" && step.action === actionId) continue;
    throw new UserError("@WF:Locked", { name: String(def?.name ?? ""), step: String(inst.stepName ?? "") });
  }
}

// ---------------------------------------------------------------------------

async function handle(s: Session, ev: WorkflowEvent) {
  if (ev.objectId === "wf.workItem") {
    if (ev.kind === "action" && ev.name) await onWorkItem(s, ev.id, ev.name);
    return;
  }
  if (ev.kind === "action" && !ev.byWorkflow) await resumeOnAction(s, ev);
  const defs = (await s.find("wf.definition", { objectId: ev.objectId, active: true }, 50)).filter(
    (d) => d.trigger === ev.kind && (ev.kind === "created" || d.triggerName === ev.name),
  );
  if (!defs.length) return;
  if (!(await s.get(ev.objectId, ev.id))) return;
  for (const d of defs) {
    const live = (await s.find("wf.instance", { definitionId: d.id, refObject: ev.objectId, refId: ev.id }, 20)).filter((i) => LIVE.includes(String(i.status)));
    if (live.length) {
      // opakovaná událost (doklad znovu vytěžen) = zkusit čekající krok znovu
      for (const i of live) if (ev.kind === "event") await advance(s, i, Number(i.stepNum ?? 0), true);
      continue;
    }
    if (!(await s.matches(ev.objectId, ev.id, parseCondition(d.condition)))) continue;
    await start(s, d, ev.objectId, ev.id);
  }
}

async function recordTitle(s: Session, objectId: string, rec: RecordData): Promise<string> {
  const def = registry.objects.get(objectId)!;
  await s.attachRefTitles(def, [rec]);
  const ref = def.titleRef ? (rec._titles as RecordData | undefined)?.[def.titleRef] : null;
  const partner = Object.entries((rec._titles as RecordData | undefined) ?? {}).find(([k]) => k === "vendorId" || k === "customerId")?.[1];
  return [rec[def.titleField], ref ?? partner ?? rec.partnerName]
    .filter((x) => x !== null && x !== undefined && String(x) !== "")
    .map(String)
    .join(" · ")
    .slice(0, 120);
}

async function start(s: Session, d: RecordData, objectId: string, id: string) {
  const rec = (await s.get(objectId, id))!;
  const inst = await s.save(
    "wf.instance",
    null,
    { definitionId: d.id, refObject: objectId, refId: id, refTitle: await recordTitle(s, objectId, rec), href: `/${objectId.replace(".", "/")}/${id}`, status: "running" },
    { system: true },
  );
  await advance(s, inst, Number.NEGATIVE_INFINITY, true);
}

const stepsOf = (s: Session, definitionId: unknown) => s.find("wf.definitionStep", { definitionId }, 100, { lineNum: "asc" });

async function stepOf(s: Session, inst: RecordData): Promise<RecordData | null> {
  if (inst.stepNum === null || inst.stepNum === undefined) return null;
  return (await stepsOf(s, inst.definitionId)).find((x) => Number(x.lineNum) === Number(inst.stepNum)) ?? null;
}

/** Projít kroky od `from` (včetně / za ním) až k prvnímu, který čeká na člověka, nebo do konce. */
async function advance(s: Session, inst: RecordData, from: number, inclusive: boolean, retry = false) {
  const objectId = String(inst.refObject);
  const id = String(inst.refId);
  const steps = (await stepsOf(s, inst.definitionId)).filter((x) => (inclusive ? Number(x.lineNum) >= from : Number(x.lineNum) > from));
  for (const step of steps) {
    const rec = await s.get(objectId, id);
    if (!rec) return finish(s, inst, "cancelled");
    if (step.condition && !(await s.matches(objectId, id, parseCondition(step.condition)))) continue;
    if (step.kind === "auto") {
      const problem = await runAuto(s, objectId, id, step, retry && Number(step.lineNum) === from);
      if (problem === null) continue;
      return wait(s, inst, step, "fix", problem);
    }
    return wait(s, inst, step, step.kind === "approval" ? "approval" : "task", null);
  }
  return finish(s, inst, "completed");
}

/** Spustit akci v savepointu: chyba = její zápisy (i nasbírané spouštěče) se vrátí. */
async function guarded(s: Session, fn: () => Promise<unknown>) {
  const q = QUEUE.get(s.tx);
  const before = q?.length ?? 0;
  await s.tx.$executeRawUnsafe("SAVEPOINT shanon_wf_step");
  try {
    await fn();
    await s.tx.$executeRawUnsafe("RELEASE SAVEPOINT shanon_wf_step");
  } catch (e) {
    await s.tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT shanon_wf_step");
    s.forget();
    if (q) q.length = before;
    throw e;
  }
}

/** Automatický krok: null = proběhl, jinak text, proč ne (úkol Doplnit údaje). Opakování po doplnění údajů nejdřív zkontroluje záznam. */
async function runAuto(s: Session, objectId: string, id: string, step: RecordData, retry: boolean): Promise<string | null> {
  const t = s.eventCtx(objectId).t;
  try {
    if (retry && step.checkAction) await guarded(s, () => s.action(objectId, id, String(step.checkAction), undefined, false, { workflow: true }));
    const pre = parseCondition(step.precondition);
    if (pre.length && !(await s.matches(objectId, id, pre))) {
      const rec = await s.get(objectId, id);
      return String(rec?.message ?? "") || t("@WF:PreconditionFailed", { condition: String(step.precondition) });
    }
    await guarded(s, () => s.action(objectId, id, String(step.action), undefined, false, { workflow: true }));
    return null;
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    const fields = Object.entries(e.fields ?? {}).map(([f, l]) => `${f}: ${t(l)}`);
    return [t(e.label, e.params), ...fields].join(" · ").slice(0, 1000);
  }
}

async function assignee(s: Session, step: RecordData, objectId: string, rec: RecordData): Promise<string | null> {
  const participant = async () => {
    if (!step.participantTypeId) return null;
    return ((await s.get("wf.participantType", String(step.participantTypeId)))?.userId as string) || null;
  };
  const originator = () => s.originator(objectId, rec);
  if (step.assignTo === "user") return (step.userId as string) || (await originator()) || (await participant());
  if (step.assignTo === "participant") return (await participant()) || (await originator());
  return (await originator()) || (await participant());
}

async function wait(s: Session, inst: RecordData, step: RecordData, kind: "fix" | "task" | "approval", problem: string | null) {
  const objectId = String(inst.refObject);
  const id = String(inst.refId);
  const rec = (await s.get(objectId, id))!;
  const t = s.eventCtx("wf.instance").t;
  const title = await recordTitle(s, objectId, rec);
  const days = Number(step.dueDays ?? 0);
  const due = days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10) : null;
  await createWorkItem(s.api(), {
    title: kind === "fix" ? t("@WF:TaskFix", { title }) : t("@WF:TaskStep", { step: String(step.name), title }),
    kind,
    assignedTo: await assignee(s, step, objectId, rec),
    description: problem,
    dueDate: due,
    ref: { object: objectId, id, title },
    sourceKey: `wf:${inst.id}:${step.lineNum}`,
    instanceId: String(inst.id),
    stepNum: Number(step.lineNum),
  });
  await s.save("wf.instance", String(inst.id), { status: "waiting", stepNum: Number(step.lineNum), stepName: step.name, message: problem?.slice(0, 255) ?? null, refTitle: title }, { system: true });
}

async function finish(s: Session, inst: RecordData, status: "completed" | "rejected" | "cancelled", message?: string | null) {
  await s.save("wf.instance", String(inst.id), { status, message: message?.slice(0, 255) ?? null, completedAt: new Date().toISOString() }, { system: true });
  if (status !== "completed")
    for (const w of await s.find("wf.workItem", { instanceId: inst.id, status: "open" }, 100))
      await s.save("wf.workItem", String(w.id), { status: "cancelled", completedAt: new Date().toISOString() }, { system: true });
}

/** Úkol z běhu dokončen / schválen / zamítnut / zrušen. */
async function onWorkItem(s: Session, itemId: string, action: string) {
  const w = await s.get("wf.workItem", itemId);
  if (!w?.instanceId) return;
  const inst = await s.get("wf.instance", String(w.instanceId));
  if (!inst || inst.status !== "waiting" || Number(w.stepNum) !== Number(inst.stepNum)) return;
  if (action === "done" || action === "approve") {
    // Doplnit údaje = zopakovat automatický krok, jinak další krok
    return w.kind === "fix" ? advance(s, inst, Number(inst.stepNum), true, true) : advance(s, inst, Number(inst.stepNum), false);
  }
  if (action === "reject") {
    await finish(s, inst, "rejected", (w.result as string) ?? null);
    const rec = await s.get(String(inst.refObject), String(inst.refId));
    const to = rec ? await s.originator(String(inst.refObject), rec) : null;
    await notify(s.api(), { kind: "warning", title: "@WF:NotifyRejected", params: { title: String(inst.refTitle ?? "") }, message: (w.result as string) ?? null, href: String(inst.href ?? ""), userId: to });
    return;
  }
  if (action === "cancel") return finish(s, inst, "cancelled");
}

/** Člověk provedl akci, na kterou čeká automatický krok (Zalistovat ručně) → krok je hotový. */
async function resumeOnAction(s: Session, ev: WorkflowEvent) {
  const waiting = await s.find("wf.instance", { refObject: ev.objectId, refId: ev.id, status: "waiting" }, 10);
  for (const inst of waiting) {
    const step = await stepOf(s, inst);
    if (step?.kind !== "auto" || step.action !== ev.name) continue;
    await closeWorkItems(s.api(), { sourceKey: `wf:${inst.id}:${step.lineNum}` }, "done", undefined, s.ctx.userId);
    await advance(s, inst, Number(step.lineNum), false);
  }
}
