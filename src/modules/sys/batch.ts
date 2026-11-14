/** Dávkové úlohy: obsluha záznamu (Spustit nyní, výchozí termín) a výchozí úlohy firmy. */
import type { DataApi, JobDef, ObjectHandlers } from "@/core/module";

export const batchHandlers: Record<string, ObjectHandlers> = {
  "sys.batchJob": {
    async beforeSave(_ctx, d) {
      // aktivní úloha bez termínu: poprvé za minutu
      if (d.active && !d.nextRunAt && d.recurrence !== "once") d.nextRunAt = new Date(Date.now() + 60000).toISOString();
    },
    actions: {
      async run(ctx, rec) {
        const { executeJob, jobDefs } = await import("@/server/batch");
        // úloha se sítí běží mimo transakci — plánovač ji spustí do minuty
        if (jobDefs().get(String(rec.jobClass))?.outside) {
          await ctx.data.update("sys.batchJob", String(rec.id), { active: true, nextRunAt: new Date().toISOString(), lastMessage: ctx.t("@SYS:BatchQueued") });
          return;
        }
        await executeJob(ctx, rec);
      },
    },
  },
};

/** Založí ve firmě chybějící výchozí úlohy modulů (podle druhu úlohy). */
export async function setupJobs(data: DataApi, jobs: JobDef[]) {
  const { nextPragueTime } = await import("@/server/batch");
  for (const j of jobs) {
    if (!j.default || (await data.find("sys.batchJob", { jobClass: j.id }, { take: 1 })).length) continue;
    const code = j.id.split(".").pop()!.replace(/([a-z])([A-Z])/g, "$1-$2").toUpperCase().slice(0, 20);
    await data.create("sys.batchJob", {
      code,
      name: j.label,
      jobClass: j.id,
      recurrence: j.default.recurrence,
      every: j.default.every,
      active: j.default.active ?? true,
      nextRunAt: (j.default.at ? nextPragueTime(j.default.at) : new Date(Date.now() + 60000)).toISOString(),
    });
  }
}
