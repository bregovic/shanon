/**
 * Sloučit záznamy (obecně, `ObjectDef.mergeable`): vybrané záznamy číselníku se sloučí do jednoho — ponechá se ten
 * s nejnižším kódem (titleField), odkazy ze všech objektů (doklady, řádky, slevy…) a přílohy se přepojí na něj,
 * ostatní se smažou. Co se má na ponechaném záznamu změnit (název, cena, dodavatel), určí obsluha `ObjectHandlers.merge`.
 * Vše v jedné transakci; střet jedinečného klíče (např. zásoba téže položky na téže lokaci) sloučení odmítne.
 */
import { Prisma } from "@/generated/prisma/client";
import { UserError, type RecordData } from "@/core/module";
import type { ObjectDef } from "@/core/object";
import { registry } from "@/registry";
import { forgetReads, getObject, handlersFor, type Session } from "./data";

type Delegate = { updateMany(a: unknown): Promise<{ count: number }> };
const model = (s: Session, def: ObjectDef) => (s.tx as unknown as Record<string, Delegate>)[def.table.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())];

export const MERGE_MAX = 20;

export async function mergeRecords(s: Session, objectId: string, ids: string[]): Promise<RecordData> {
  const def = getObject(objectId);
  if (!def.mergeable) throw new UserError("@SYS:InvalidValue");
  const unique = [...new Set(ids)];
  if (unique.length < 2 || unique.length > MERGE_MAX) throw new UserError("@SYS:MergeCount", { max: String(MERGE_MAX) });
  const rows: RecordData[] = [];
  for (const id of unique) {
    const r = await s.get(objectId, id);
    if (!r) throw new UserError("@SYS:NotFound");
    rows.push(r);
  }
  const title = def.titleField;
  rows.sort((a, b) => String(a[title] ?? "").localeCompare(String(b[title] ?? ""), "cs", { numeric: true }));
  const [target, ...others] = rows;
  const targetId = String(target.id);
  const otherIds = others.map((r) => String(r.id));

  // úpravy ponechaného záznamu (obsluha modulu může sloučení i odmítnout)
  const patch: RecordData = {};
  for (const h of handlersFor(s.ctx, objectId)) Object.assign(patch, (await h.merge?.(s.eventCtx(objectId), target, others)) ?? {});

  // přepojit odkazy ze všech objektů a přílohy
  const tenantId = s.ctx.tenantId;
  for (const d of registry.objects.values()) {
    for (const [name, f] of Object.entries(d.fields)) {
      if (f.edt.kind !== "ref" || f.edt.refObject !== objectId) continue;
      try {
        await model(s, d).updateMany({ where: { tenantId, [name]: { in: otherIds } }, data: { [name]: targetId } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new UserError("@SYS:MergeConflict", { object: d.labelPlural });
        throw e;
      }
    }
  }
  await s.tx.sysDocuRef.updateMany({ where: { tenantId, objectId, recordId: { in: otherIds } }, data: { recordId: targetId } });
  forgetReads(s.tx); // odkazy přepojené hromadně mimo save

  for (const id of otherIds) await s.remove(objectId, id);
  if (Object.keys(patch).length) return s.save(objectId, targetId, patch);
  return (await s.get(objectId, targetId))!;
}
