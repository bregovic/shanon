/**
 * Kontrola před smazáním (obecně pro všechny objekty): co smazat půjde a co ne — a proč.
 *
 * 1. Mazání nanečisto: každý záznam zvlášť v savepointu jedné transakce, která se celá vrátí.
 *    Projde tak vše, co skutečné mazání (události `beforeDelete`, zámky, řádky dokladu, cizí klíče).
 * 2. U záznamu, na který něco odkazuje (`@SYS:InUse`), dohledá odkazující záznamy: pole typu
 *    odkaz ze všech objektů zapnutých modulů, i odkazy na vlastní řádky dokladu (řádek příjemky →
 *    řádek objednávky). Odkaz z řádku se ukáže jako jeho doklad. Dotazy hromadně (`in`), ne za záznam.
 */
import { UserError, type RecordData } from "@/core/module";
import type { LabelRef } from "@/core/labels";
import { can } from "@/core/security";
import { objectHref } from "@/lib/meta";
import { registry } from "@/registry";
import type { PrismaClient } from "@/generated/prisma/client";
import { forgetReads, getObject, inTenant, type Ctx } from "./data";

export interface DeleteRef {
  objectId: string;
  /** název agendy (label) */
  label: LabelRef;
  count: number;
  /** čísla / názvy odkazujících záznamů (jen s právem číst), nejvýš REF_TITLES */
  titles: string[];
  /** seznam odkazujících záznamů (filtr podle mazaného záznamu) */
  href?: string;
}

export interface DeleteCheckRow {
  id: string;
  title: string;
  ok: boolean;
  /** proč nejde smazat (label + parametry) */
  reason?: { label: LabelRef; params: Record<string, string> };
  refs: DeleteRef[];
}

const REF_TITLES = 5;
const MAX_IDS = 200;

class DryRun extends Error {}

/** řádky dokladů: objekt řádku → doklad + pole odkazu na doklad (jen vlastní řádky) */
function lineParents(): Map<string, { parent: string; field: string }> {
  const m = new Map<string, { parent: string; field: string }>();
  for (const o of registry.objects.values()) for (const l of o.lines ?? []) if (l.owned !== false) m.set(l.object, { parent: o.id, field: l.field });
  return m;
}

/** pole objektů zapnutých modulů, která odkazují na `target` */
function refFields(ctx: Ctx, target: string) {
  const out: { objectId: string; field: string }[] = [];
  for (const o of registry.objects.values()) {
    if (!ctx.modules.has(o.id.split(".")[0])) continue;
    for (const [k, f] of Object.entries(o.fields)) if (f.edt.kind === "ref" && f.edt.refObject === target) out.push({ objectId: o.id, field: k });
  }
  return out;
}

export async function deleteCheck(ctx: Ctx, objectId: string, ids: string[], client?: PrismaClient): Promise<DeleteCheckRow[]> {
  const def = getObject(objectId);
  ids = [...new Set(ids)].slice(0, MAX_IDS);
  const rows = new Map<string, DeleteCheckRow>();

  // 1. nanečisto
  try {
    await inTenant(
      ctx,
      async (s) => {
        for (const id of ids) {
          const rec = await s.sys().get(objectId, id).catch(() => null);
          const row: DeleteCheckRow = { id, title: String(rec?.[def.titleField] ?? id), ok: true, refs: [] };
          rows.set(id, row);
          await s.tx.$executeRawUnsafe("SAVEPOINT shanon_delete_check");
          try {
            await s.remove(objectId, id);
          } catch (e) {
            if (!(e instanceof UserError)) throw e;
            row.ok = false;
            row.reason = { label: e.label, params: e.params ?? {} };
          }
          await s.tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT shanon_delete_check");
          forgetReads(s.tx);
        }
        throw new DryRun();
      },
      client,
    );
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }

  // 2. kde je záznam použitý (jen u těch, na které něco odkazuje)
  const used = [...rows.values()].filter((r) => r.reason?.label === "@SYS:InUse").map((r) => r.id);
  if (!used.length) return [...rows.values()];
  const parents = lineParents();
  await inTenant(
    ctx,
    async (s) => {
      const sys = s.sys();
      // cíle: mazané záznamy + jejich vlastní řádky (řádek → záznam, kvůli přiřazení odkazu)
      const owner = new Map<string, string>(); // `${objekt}:${id}` → id mazaného záznamu
      const targets = new Map<string, string[]>([[objectId, used]]);
      for (const id of used) owner.set(`${objectId}:${id}`, id);
      for (const l of (def.lines ?? []).filter((x) => x.owned !== false && ctx.modules.has(x.object.split(".")[0]))) {
        const lines = await sys.find(l.object, { [l.field]: { in: used } }, 20000);
        if (!lines.length) continue;
        targets.set(l.object, lines.map((x) => String(x.id)));
        for (const x of lines) owner.set(`${l.object}:${x.id}`, String(x[l.field]));
      }
      // odkazující záznamy, seskupené po mazaném záznamu a agendě (řádek → jeho doklad)
      const found = new Map<string, Map<string, { label: LabelRef; ids: Set<string>; titles: Map<string, string>; field?: string }>>();
      for (const [target, targetIds] of targets) {
        for (const r of refFields(ctx, target)) {
          // vlastní řádky mazaného dokladu se mažou s ním
          if (target === objectId && parents.get(r.objectId)?.parent === objectId && parents.get(r.objectId)?.field === r.field) continue;
          const refs = await sys.find(r.objectId, { [r.field]: { in: targetIds } }, 2000);
          if (!refs.length) continue;
          // řádek cizího dokladu → ukázat doklad
          const lp = parents.get(r.objectId);
          const showObj = lp && ctx.modules.has(lp.parent.split(".")[0]) ? lp.parent : r.objectId;
          const showDef = getObject(showObj);
          let shown: RecordData[] = refs;
          const via = new Map<string, string>(); // id zobrazeného → id odkazujícího
          if (showObj !== r.objectId && lp) {
            const parentIds = [...new Set(refs.map((x) => String(x[lp.field])))];
            // doklady po jednom: find filtruje jen podle polí objektu (id mezi nimi není); stačí prvních pár
            shown = [];
            for (const pid of parentIds.slice(0, 50)) {
              const x = await sys.get(showObj, pid);
              if (x) shown.push(x);
            }
            for (const x of refs) via.set(String(x[lp.field]), String(x.id));
          }
          const readable = can(ctx.perms, showObj, "read");
          for (const rec of shown) {
            const src = refs.find((x) => String(x.id) === (via.get(String(rec.id)) ?? String(rec.id))) ?? rec;
            const delId = owner.get(`${target}:${src[r.field]}`);
            if (!delId) continue;
            const byObj = found.get(delId) ?? found.set(delId, new Map()).get(delId)!;
            const g = byObj.get(showObj) ?? byObj.set(showObj, { label: showDef.labelPlural, ids: new Set(), titles: new Map(), field: showObj === r.objectId && target === objectId ? r.field : undefined }).get(showObj)!;
            g.ids.add(String(rec.id));
            if (readable) g.titles.set(String(rec.id), String(rec[showDef.titleField] ?? ""));
          }
        }
      }
      for (const id of used) {
        const row = rows.get(id)!;
        for (const [obj, g] of found.get(id) ?? []) {
          const titles = [...g.titles.values()].filter(Boolean).sort();
          row.refs.push({
            objectId: obj,
            label: g.label,
            count: g.ids.size,
            titles: titles.slice(0, REF_TITLES),
            // seznam dokladů agendy: s jedním záznamem rovnou ten, jinak celý seznam
            // přímý odkaz → seznam vyfiltrovaný podle mazaného záznamu (filtr odkazu bere kód i název)
            href: can(ctx.perms, obj, "read")
              ? g.ids.size === 1
                ? objectHref(obj, [...g.ids][0])
                : g.field
                  ? `${objectHref(obj)}?filter.${g.field}=${encodeURIComponent(row.title)}`
                  : objectHref(obj)
              : undefined,
          });
        }
      }
    },
    client,
  );
  return [...rows.values()];
}

/** Text „Vydané faktury (3): FV…, FV…; Příjemky: SKL…“ do chybové hlášky (mazání bez dialogu, API). */
export function usedInText(rows: DeleteCheckRow[], t: (l: LabelRef, p?: Record<string, string>) => string): string {
  const parts: string[] = [];
  for (const r of rows.filter((x) => x.refs.length)) {
    const refs = r.refs.map((x) => `${t(x.label)} (${x.count})${x.titles.length ? `: ${x.titles.join(", ")}${x.count > x.titles.length ? ", …" : ""}` : ""}`).join("; ");
    parts.push(rows.length > 1 ? `${r.title} — ${refs}` : refs);
  }
  return parts.join(" · ");
}
