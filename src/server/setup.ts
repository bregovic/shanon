/**
 * Výchozí nastavení firmy: číselné řady a další výchozí data zapnutých
 * modulů (ModuleDef.numberSeqs, ModuleDef.setup). Zakládá jen to, co chybí —
 * úpravy tenanta nikdy nepřepíše, lze ho tedy spouštět opakovaně.
 *
 * Spouští se samo: při založení firmy a při zapnutí modulu; ručně v
 * Systém → Výchozí nastavení.
 */
import { resolveLabel, type Lang } from "@/core/labels";
import type { DataApi } from "@/core/module";
import { labelTable, modules } from "@/registry";

/** Vrací počty založených záznamů podle objektu. */
export async function setupCompany(api: DataApi, enabled: Set<string>, lang: Lang = "cs"): Promise<Record<string, number>> {
  const created: Record<string, number> = {};
  const counting: DataApi = {
    ...api,
    create: async (o, d) => {
      const r = await api.create(o, d);
      created[o] = (created[o] ?? 0) + 1;
      return r;
    },
  };
  // pořadí registru = pořadí závislostí (sys, gab, gl, tax…)
  for (const m of modules) {
    if (!enabled.has(m.id)) continue;
    for (const s of m.numberSeqs ?? []) {
      // Použití jen pokud ho ještě nemá jiná řada (tenant si mohl určit vlastní)
      const usedFor = s.usedFor && !(await api.find("sys.numberSeq", { usedFor: s.usedFor }, { take: 1 })).length ? s.usedFor : null;
      const [existing] = await api.find("sys.numberSeq", { code: s.code }, { take: 1 });
      if (existing) {
        // existující řadě jen doplnit prázdné Použití, nic nepřepisovat
        if (usedFor && !existing.usedFor) await api.update("sys.numberSeq", String(existing.id), { usedFor });
        continue;
      }
      await counting.create("sys.numberSeq", {
        code: s.code,
        name: resolveLabel(labelTable, s.name, lang),
        format: s.format,
        nextNumber: 1,
        usedFor,
      });
    }
    await m.setup?.(counting);
  }
  return created;
}
