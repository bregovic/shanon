/**
 * Finanční dimenze (obdoba Financial dimensions v D365).
 *
 * - Dimenze jsou sdílené v tenantovi, max. 6 (pořadí = sloupec dim1…dim6 na
 *   zápisech, deníku a řádcích dokladů). Popisky polí jsou názvy dimenzí,
 *   nepoužité sloupce se nezobrazují (src/server/ui.ts).
 * - Hodnoty: vlastní seznam (středisko, zakázka…), nebo partner (číslo
 *   odběratele / dodavatele — doklad modulu ho doplní sám).
 * - Pravidla firmy podle začátku čísla účtu (5, 518, 518100…) určí, zda je
 *   dimenze na účtu povinná, nepovolená, nebo volitelná; nejdelší shoda vyhrává.
 *   Účty si nastavení drží v polích dimNReq — pravidla se do nich propíšou samy.
 */
import { UserError, type DataApi, type JobDef, type ObjectHandlers, type RecordData } from "@/core/module";

export const DIM_SLOTS = [1, 2, 3, 4, 5, 6] as const;
export const dimField = (n: number) => `dim${n}`;
export const reqField = (n: number) => `dim${n}Req`;
export type Dims = Partial<Record<string, string | null>>;

export interface DimDef {
  id: string;
  slot: number;
  code: string;
  name: string;
  source: "custom" | "partner";
}

/** Aktivní dimenze tenanta podle pořadí. */
export async function activeDimensions(data: DataApi): Promise<DimDef[]> {
  let rows: RecordData[];
  try {
    rows = await data.find("gl.dimension", { active: true }, { take: 6, orderBy: { position: "asc" } });
  } catch {
    return [];
  }
  return rows.map((r) => ({ id: String(r.id), slot: Number(r.position), code: String(r.code), name: String(r.name), source: r.source === "partner" ? "partner" : "custom" }));
}

/** Dimenze řádku (dim1…dim6) jako prosté hodnoty. */
export const dimsOf = (r: RecordData): Dims => Object.fromEntries(DIM_SLOTS.map((n) => [dimField(n), (r[dimField(n)] as string) || null]));

/** Nastavení dimenzí pro účet podle pravidel (nejdelší shoda začátku čísla). */
export async function requirementsFor(data: DataApi, accountNum: string, dims?: DimDef[]): Promise<Record<string, string>> {
  const defs = dims ?? (await activeDimensions(data));
  const rules = await data.find("gl.dimensionRule", {}, { take: 5000 });
  const out: Record<string, string> = {};
  for (const n of DIM_SLOTS) {
    const d = defs.find((x) => x.slot === n);
    const best = d
      ? rules
          .filter((r) => r.dimensionId === d.id && accountNum.startsWith(String(r.accountMask)))
          .sort((a, b) => String(b.accountMask).length - String(a.accountMask).length)[0]
      : undefined;
    out[reqField(n)] = (best?.requirement as string) ?? "optional";
  }
  return out;
}

/** Propíše pravidla do všech účtů firmy. Vrací počet změněných účtů. */
export async function applyDimensionRules(data: DataApi): Promise<number> {
  const defs = await activeDimensions(data);
  let n = 0;
  for (const acc of await data.find("gl.account", {}, { take: 10000 })) {
    const req = await requirementsFor(data, String(acc.accountNum), defs);
    if (Object.entries(req).some(([k, v]) => acc[k] !== v)) {
      await data.update("gl.account", String(acc.id), req);
      n++;
    }
  }
  return n;
}

/**
 * Kontrola a úprava dimenzí řádku účtování.
 * - partner se doplní z dokladu (když ho účet nezakazuje)
 * - ruční zápis: nepovolená dimenze s hodnotou = chyba; doklad modulu ji vynechá
 * - povinná bez hodnoty = chyba; hodnota musí existovat
 */
export async function resolveDims(
  data: DataApi,
  account: RecordData,
  dims: Dims,
  opts: { manual: boolean; partner?: string | null; defs?: DimDef[] },
): Promise<Dims> {
  const defs = opts.defs ?? (await activeDimensions(data));
  const out: Dims = {};
  const acc = `${account.accountNum} ${account.name}`;
  for (const n of DIM_SLOTS) {
    const f = dimField(n);
    const d = defs.find((x) => x.slot === n);
    let v = dims[f] ? String(dims[f]).trim().toUpperCase() : null;
    if (!d) {
      out[f] = null;
      continue;
    }
    const req = String(account[reqField(n)] ?? "optional");
    if (!v && d.source === "partner" && opts.partner && req !== "notAllowed") v = opts.partner;
    if (req === "notAllowed" && v) {
      if (opts.manual) throw new UserError("@GL:DimNotAllowed", { dim: d.name, account: acc });
      v = null;
    }
    if (req === "mandatory" && !v) throw new UserError("@GL:DimMandatory", { dim: d.name, account: acc });
    if (v && !(await dimValueExists(data, d, v))) throw new UserError("@GL:DimValueUnknown", { dim: d.name, value: v });
    out[f] = v;
  }
  return out;
}

async function dimValueExists(data: DataApi, d: DimDef, v: string): Promise<boolean> {
  if (d.source === "custom") return (await data.find("gl.dimensionValue", { dimensionId: d.id, code: v, blocked: false }, { take: 1 })).length > 0;
  for (const obj of ["ar.customer", "ap.vendor"]) {
    try {
      if ((await data.find(obj, { accountNum: v }, { take: 1 })).length) return true;
    } catch {
      /* modul není zapnutý */
    }
  }
  return false;
}

export const dimensionHandlers: Record<string, ObjectHandlers> = {
  "gl.dimension": {
    beforeSave(_ctx, d) {
      if (!(Number(d.position) >= 1 && Number(d.position) <= 6)) return { position: "@GL:DimPosition" };
    },
  },
  "gl.dimensionRule": {
    beforeSave(_ctx, d) {
      if (!/^\d{1,6}$/.test(String(d.accountMask ?? ""))) return { accountMask: "@GL:DimMaskHelp" };
    },
    // pravidla se hned propíšou do účtů (i nově založených — viz gl.account)
    async afterSave(ctx) {
      await applyDimensionRules(ctx.data);
    },
    async afterDelete(ctx) {
      await applyDimensionRules(ctx.data);
    },
  },
  "gl.dimensionValue": {
    beforeSave(_ctx, d) {
      if (d.code) d.code = String(d.code).trim().toUpperCase();
    },
  },
};

/** Dávka: propsat pravidla dimenzí do účtů (např. po importu účtového rozvrhu). */
export const dimensionJobs: JobDef[] = [
  {
    id: "gl.dimensionRules",
    label: "@GL:JobDimensionRules",
    default: { recurrence: "days", every: 1, at: "02:00" },
    async run(ctx) {
      return ctx.t("@GL:DimRulesApplied", { n: String(await applyDimensionRules(ctx.data)) });
    },
  },
];
