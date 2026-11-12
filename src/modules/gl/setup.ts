/**
 * Výchozí nastavení hlavní knihy pro novou firmu (nebo po zapnutí modulu).
 * Zakládá jen to, co chybí — účtový rozvrh, jen když je úplně prázdný.
 */
import type { DataApi } from "@/core/module";

/** Výřez směrné účtové osnovy pro start (firma si ho doplní). */
export const DEFAULT_ACCOUNTS: [string, string, string][] = [
  ["211", "Pokladna", "asset"],
  ["221", "Bankovní účty", "asset"],
  ["311", "Odběratelé", "asset"],
  ["321", "Dodavatelé", "liability"],
  ["343", "Daň z přidané hodnoty", "liability"],
  ["395", "Vnitřní zúčtování", "asset"],
  ["411", "Základní kapitál", "equity"],
  ["501", "Spotřeba materiálu", "expense"],
  ["518", "Ostatní služby", "expense"],
  ["602", "Tržby z prodeje služeb", "revenue"],
  ["604", "Tržby za zboží", "revenue"],
];

export async function glSetup(data: DataApi): Promise<void> {
  if (!(await data.find("gl.account", {}, { take: 1 })).length) {
    for (const [accountNum, name, type] of DEFAULT_ACCOUNTS) await data.create("gl.account", { accountNum, name, type });
  }
  if (!(await data.find("gl.journalName", { code: "GEN" }, { take: 1 })).length) {
    await data.create("gl.journalName", { code: "GEN", name: "Obecný deník" });
  }
}
