/**
 * Duplikovat záznam (obecně pro všechny objekty): kopie hodnot bez
 * primárního klíče (pole unikátních klíčů kromě odkazů), čísla z řady,
 * pouze-pro-čtení polí (stavy, součty), obrázků a tajných údajů.
 *
 * Doklad s číselnou řadou a vlastními řádky se zkopíruje rovnou i s řádky
 * (nové číslo přidělí řada). Ostatní: vrátí předvyplněné hodnoty pro nový
 * záznam a klíč doplní uživatel.
 */
import type { ObjectDef } from "@/core/object";
import type { RecordData } from "@/core/module";
import { getObject, inTenant, type Ctx, type Session } from "./data";
import type { PrismaClient } from "@/generated/prisma/client";

const SYSTEM = new Set(["id", "tenantId", "companyId", "version", "createdAt", "updatedAt", "createdBy", "updatedBy", "_titles"]);

/** Pole, která se do kopie nepřenášejí. */
function skipped(def: ObjectDef): Set<string> {
  const out = new Set<string>();
  for (const key of def.unique ?? []) for (const f of key) if (def.fields[f]?.edt.kind !== "ref") out.add(f);
  if (def.numberSeq) out.add(def.numberSeq.field);
  for (const [n, f] of Object.entries(def.fields)) if (f.readOnly || f.image || f.secret) out.add(n);
  return out;
}

function copyValues(def: ObjectDef, rec: RecordData): RecordData {
  const skip = skipped(def);
  const out: RecordData = {};
  for (const [k, v] of Object.entries(rec)) if (!SYSTEM.has(k) && !skip.has(k) && k !== "ext" && v !== null && v !== undefined) out[k] = v;
  // pole rozšíření
  for (const [k, v] of Object.entries((rec.ext as RecordData) ?? {})) if (v !== null && v !== undefined) out[k] = v;
  return out;
}

/** Řádky, které se kopírují s dokladem (vlastní, ne systémové, ne historie). */
const copiedLines = (def: ObjectDef) => (def.lines ?? []).filter((l) => l.owned !== false && l.copy !== false && !getObject(l.object).systemOnly);

/** Lze kopii založit rovnou (klíč přidělí číselná řada)? */
export function copiesDirectly(def: ObjectDef): boolean {
  const keyFields = (def.unique ?? []).flat().filter((f) => def.fields[f]?.edt.kind !== "ref" && f !== def.numberSeq?.field);
  return !!def.numberSeq && keyFields.length === 0;
}

async function loadCopy(s: Session, def: ObjectDef, id: string) {
  const rec = await s.get(def.id, id);
  if (!rec) return null;
  await s.attachRefTitles(def, [rec]);
  return rec;
}

export type DuplicateResult = { id: string } | { values: RecordData; titles: Record<string, string> };

export function duplicateRecord(ctx: Ctx, objectId: string, id: string, client?: PrismaClient): Promise<DuplicateResult | null> {
  const def = getObject(objectId);
  return inTenant(
    ctx,
    async (s) => {
      const rec = await loadCopy(s, def, id);
      if (!rec) return null;
      const values = copyValues(def, rec);
      if (!copiesDirectly(def)) return { values, titles: (rec._titles as Record<string, string>) ?? {} };
      const created = await s.save(objectId, null, values);
      for (const l of copiedLines(def)) {
        const ldef = getObject(l.object);
        for (const row of await s.find(l.object, { [l.field]: id }, 5000)) {
          await s.save(l.object, null, { ...copyValues(ldef, row), [l.field]: created.id });
        }
      }
      return { id: String(created.id) };
    },
    client,
  );
}
