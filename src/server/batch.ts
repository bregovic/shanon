/**
 * Dávkové úlohy (obdoba AX batch): úlohy definují moduly (`ModuleDef.jobs`),
 * firma má záznamy `sys.batchJob` s opakováním; každý běh do `sys.batchRun`.
 *
 * Plánovač (`startScheduler`, z `src/instrumentation.ts`) jednou za minutu
 * projde tenanty a spustí úlohy, jejichž čas nastal. Úloha běží v transakci
 * jako systémová operace firmy; chyba se zapíše do historie a úloha běží dál
 * podle plánu. Zmeškané běhy se nedohánějí — další termín je vždy v budoucnu.
 */
import type { EventContext, JobDef, RecordData } from "@/core/module";
import { moduleOf } from "@/core/object";
import { ADMIN } from "@/core/security";
import { dependencyClosure } from "@/core/module";
import { modules, registry } from "@/registry";
import { inTenant, type Ctx } from "./data";
import { prisma, withTenant } from "./db";
import type { PrismaClient } from "@/generated/prisma/client";

export const jobDefs = (): Map<string, JobDef> => new Map(modules.flatMap((m) => (m.jobs ?? []).map((j) => [j.id, j] as const)));

const TZ = "Europe/Prague";

/** Posun pražského času o UTC (minuty) v daném okamžiku. */
function pragueOffset(d: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((local - Math.floor(d.getTime() / 60000) * 60000) / 60000);
}

/** Nejbližší okamžik „HH:MM pražského času“ po `now`. */
export function nextPragueTime(at: string, now = new Date()): Date {
  const [h, m] = at.split(":").map(Number);
  for (let add = 0; add < 3; add++) {
    const day = new Date(now.getTime() + add * 86400000);
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(day); // YYYY-MM-DD
    const guess = new Date(`${ymd}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
    const t = new Date(guess.getTime() - pragueOffset(guess) * 60000);
    if (t > now) return t;
  }
  return new Date(now.getTime() + 86400000);
}

/**
 * Další termín po `from` podle opakování; dny, týdny a měsíce drží pražský
 * čas (letní/zimní čas). Vrací null u jednorázové úlohy.
 */
export function nextRun(from: Date, recurrence: string, every: number, now = new Date()): Date | null {
  const n = Math.max(1, Math.floor(every || 1));
  if (recurrence === "once") return null;
  let t = new Date(from);
  for (let i = 0; i < 100000 && t <= now; i++) {
    if (recurrence === "minutes") t = new Date(t.getTime() + n * 60000);
    else if (recurrence === "hours") t = new Date(t.getTime() + n * 3600000);
    else {
      // kalendářně v pražském čase
      const off = pragueOffset(t);
      const local = new Date(t.getTime() + off * 60000);
      if (recurrence === "days") local.setUTCDate(local.getUTCDate() + n);
      else if (recurrence === "weeks") local.setUTCDate(local.getUTCDate() + 7 * n);
      else local.setUTCMonth(local.getUTCMonth() + n);
      const guess = new Date(local.getTime() - off * 60000);
      t = new Date(guess.getTime() - (pragueOffset(guess) - off) * 60000);
    }
  }
  return t;
}

/**
 * Spustí úlohu v rámci dané operace (akce „Spustit nyní“ i plánovač).
 * Chybu nezahodí: zapíše ji do historie a úlohy, další termín zůstane.
 */
export async function executeJob(ctx: EventContext, job: RecordData, now = new Date()): Promise<RecordData> {
  const def = jobDefs().get(String(job.jobClass));
  const started = Date.now();
  let status = "ok";
  let message = "";
  try {
    if (!def) throw new Error(ctx.t("@SYS:BatchUnknownClass"));
    message = (await def.run(ctx)) ?? ctx.t("@SYS:BatchDone");
  } catch (e) {
    status = "error";
    const ref = (e as { label?: string }).label;
    message = ref ? ctx.t(ref, (e as { params?: Record<string, string> }).params) : e instanceof Error ? e.message : String(e);
  }
  const next = job.nextRunAt ? nextRun(new Date(String(job.nextRunAt)), String(job.recurrence), Number(job.every), now) : null;
  await ctx.data.create("sys.batchRun", { jobId: job.id, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, status, message: message.slice(0, 255) });
  return ctx.data.update("sys.batchJob", String(job.id), {
    status,
    lastRunAt: new Date(started).toISOString(),
    lastMessage: message.slice(0, 255),
    // jednorázová úloha po běhu skončí; jinak další termín
    nextRunAt: next ? next.toISOString() : null,
    active: next ? job.active : false,
  });
}

/** Projde všechny tenanty a spustí úlohy, jejichž čas nastal. Vrací počet spuštěných. */
export async function runDueJobs(now = new Date(), client: PrismaClient = prisma): Promise<number> {
  let count = 0;
  for (const t of await client.sysTenant.findMany({ include: { modules: true, users: { where: { role: "admin" }, take: 1 } } })) {
    const enabled = new Set([...dependencyClosure(registry, ["sys", ...t.modules.map((m) => m.moduleId)])].filter((x) => registry.modules.has(x)));
    const due = await withTenant(
      t.id,
      (tx) => tx.sysBatchJob.findMany({ where: { tenantId: t.id, active: true, nextRunAt: { lte: now } }, orderBy: { nextRunAt: "asc" }, take: 50 }),
      client,
    );
    for (const job of due) {
      const ctx: Ctx = {
        tenantId: t.id,
        companyId: job.companyId,
        userId: job.createdBy ?? t.users[0]?.id ?? t.id,
        userName: "Batch",
        role: "admin",
        perms: ADMIN,
        modules: enabled,
        extensions: new Set(),
        lang: "cs",
      };
      await inTenant(
        ctx,
        async (s) => {
          const sys = s.sys();
          const rec = await sys.api().get("sys.batchJob", job.id);
          if (!rec) return;
          if (!enabled.has(moduleOf(String(rec.jobClass)))) {
            // modul vypnutý: úlohu pozastavit s vysvětlením
            await sys.api().update("sys.batchJob", job.id, { active: false, status: "error", lastMessage: sys.eventCtx("sys.batchJob").t("@SYS:BatchModuleOff") });
            return;
          }
          await executeJob(sys.eventCtx("sys.batchJob"), rec, now);
        },
        client,
      ).catch((e) => console.error(`[batch] ${t.code}/${job.code}:`, e));
      count++;
    }
  }
  return count;
}

let timer: ReturnType<typeof setInterval> | null = null;
let busy = false;

/** Spustí plánovač v procesu serveru (jednou za minutu, běhy se nepřekrývají). */
export function startScheduler(intervalMs = 60_000) {
  if (timer) return;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await runDueJobs();
    } catch (e) {
      console.error("[batch]", e);
    } finally {
      busy = false;
    }
  };
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  setTimeout(tick, 20_000).unref?.();
}
