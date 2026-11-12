/**
 * Filtry sloupců (src/core/filter.ts) → Prisma where. Odkazy se filtrují
 * podle titulku cílového záznamu (např. číslo účtu), výčty podle popisku.
 */
import { parseFilter, type Cond } from "@/core/filter";
import { resolveLabel, type Lang } from "@/core/labels";
import type { RecordData } from "@/core/module";
import type { FieldDef, ObjectDef } from "@/core/object";
import { labelTable, registry } from "@/registry";

type Where = RecordData;

const startOfDay = (d: string) => new Date(`${d}T00:00:00.000Z`);
const endOfDay = (d: string) => new Date(`${d}T23:59:59.999Z`);

function textCond(field: string, c: Cond): Where | null {
  const m = { mode: "insensitive" };
  let w: Where;
  switch (c.op) {
    case "empty":
      w = { OR: [{ [field]: null }, { [field]: "" }] };
      break;
    case "eq":
      w = { [field]: { equals: c.value, ...m } };
      break;
    case "contains":
      w = { [field]: { contains: c.value, ...m } };
      break;
    case "starts":
      w = { [field]: { startsWith: c.value, ...m } };
      break;
    case "ends":
      w = { [field]: { endsWith: c.value, ...m } };
      break;
    case "like": {
      // a*b: začíná a, končí b, obsahuje vnitřní části (pořadí se neověřuje)
      const parts = c.parts;
      const and: Where[] = parts.filter(Boolean).map((p) => ({ [field]: { contains: p, ...m } }));
      if (parts[0]) and.push({ [field]: { startsWith: parts[0], ...m } });
      if (parts[parts.length - 1]) and.push({ [field]: { endsWith: parts[parts.length - 1], ...m } });
      w = { AND: and };
      break;
    }
    default:
      return null;
  }
  return "not" in c && c.not ? { NOT: w } : w;
}

function scalarCond(field: string, f: FieldDef, c: Cond): Where | null {
  const k = f.edt.kind;
  const conv = (v: string, end: boolean) =>
    k === "int" ? Number(v) : k === "date" ? startOfDay(v) : k === "datetime" ? (end ? endOfDay(v) : startOfDay(v)) : v;
  switch (c.op) {
    case "empty":
      return c.not ? { NOT: { [field]: null } } : { [field]: null };
    case "bool":
      return { [field]: c.value };
    case "gt":
      return { [field]: k === "datetime" ? { gt: endOfDay(c.value) } : { gt: conv(c.value, false) } };
    case "lt":
      return { [field]: { lt: conv(c.value, false) } };
    case "range": {
      const r: Where = {};
      if (c.from) r.gte = conv(c.from, false);
      if (c.to) r.lte = conv(c.to, true);
      return { [field]: r };
    }
    default:
      return null;
  }
}

/** Podmínka pro jeden sloupec, nebo null když výraz nic neříká. */
export function fieldWhere(def: ObjectDef, field: string, expr: string, lang: Lang): Where | null {
  const f = def.fields[field];
  if (!f || !expr.trim()) return null;
  const kind = f.edt.kind;

  if (kind === "ref") {
    const target = registry.objects.get(f.edt.refObject!)!;
    const inner = fieldWhere(target, target.titleField, expr, lang);
    if (!inner) return null;
    const rel = field.replace(/Id$/, "");
    // prázdný odkaz = null ve sloupci, ne podmínka na cíl
    const conds = parseFilter("string", expr);
    if (conds.length === 1 && conds[0].op === "empty") return conds[0].not ? { NOT: { [field]: null } } : { [field]: null };
    return { [rel]: { is: inner } };
  }

  const conds = parseFilter(kind, expr);
  if (conds.length === 0) return { id: { in: [] } }; // nesmyslný výraz → nic

  if (kind === "enum") {
    // porovnání proti popisku i kódu hodnoty
    const values = registry.enums.get(f.edt.enumId!)!.values;
    const out: Where[] = [];
    for (const c of conds) {
      if (c.op === "empty") {
        out.push(c.not ? { NOT: { [field]: null } } : { [field]: null });
        continue;
      }
      const test = (s: string) => {
        const v = s.toLowerCase();
        switch (c.op) {
          case "eq":
            return v === c.value.toLowerCase();
          case "contains":
            return v.includes(c.value.toLowerCase());
          case "starts":
            return v.startsWith(c.value.toLowerCase());
          case "ends":
            return v.endsWith(c.value.toLowerCase());
          case "like":
            return new RegExp(`^${c.parts.map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "i").test(s);
          default:
            return false;
        }
      };
      const hit = values
        .filter((v) => test(v.value) || test(resolveLabel(labelTable, v.label, lang)))
        .map((v) => v.value);
      out.push("not" in c && c.not ? { [field]: { notIn: hit } } : { [field]: { in: hit } });
    }
    return out.length === 1 ? out[0] : { OR: out };
  }

  const isText = kind === "string" || kind === "text";
  const out = conds.map((c) => (isText ? textCond(field, c) : scalarCond(field, f, c))).filter(Boolean) as Where[];
  if (out.length === 0) return { id: { in: [] } };
  return out.length === 1 ? out[0] : { OR: out };
}

/** Řazení podle sloupce; u odkazu podle titulku cíle. */
export function orderByFor(def: ObjectDef, field: string, dir: "asc" | "desc"): Where | null {
  const f = def.fields[field];
  if (!f) return null;
  if (f.edt.kind === "ref") {
    const target = registry.objects.get(f.edt.refObject!)!;
    return { [field.replace(/Id$/, "")]: { [target.titleField]: dir } };
  }
  return { [field]: dir };
}
