/**
 * Výchozí nastavení hlavní knihy pro novou firmu (nebo po zapnutí modulu).
 * Zakládá jen to, co chybí — účtový rozvrh, jen když je úplně prázdný.
 */
import type { DataApi, RecordData } from "@/core/module";
import { createPeriods } from "./posting";

type Acc = [num: string, name: string, type: string, postingType?: string, noManualEntry?: boolean];

/**
 * Výřez směrné účtové osnovy pro malou firmu (firma si ho doplní).
 * Saldokontní a peněžní účty mají analytiku (…001) a zákaz ručního zápisu —
 * účtují na ně jen doklady modulů (faktury, banka, pokladna, DPH).
 */
export const DEFAULT_ACCOUNTS: Acc[] = [
  ["013", "Software", "asset", "fixedAsset"],
  ["022", "Hmotné movité věci a jejich soubory", "asset", "fixedAsset"],
  ["073", "Oprávky k softwaru", "asset", "fixedAsset"],
  ["082", "Oprávky k hmotným movitým věcem", "asset", "fixedAsset"],
  ["112", "Materiál na skladě", "asset", "inventory"],
  ["132", "Zboží na skladě", "asset", "inventory"],
  ["211", "Pokladna", "asset", "cash"],
  ["211001", "Pokladna CZK", "asset", "cash", true],
  ["221", "Bankovní účty", "asset", "bank"],
  ["221001", "Běžný účet", "asset", "bank", true],
  ["261", "Peníze na cestě", "asset", "cashInTransit"],
  ["311", "Odběratelé", "asset", "customer"],
  ["311001", "Odběratelé tuzemsko", "asset", "customer", true],
  ["314", "Poskytnuté zálohy", "asset", "vendor"],
  ["321", "Dodavatelé", "liability", "vendor"],
  ["321001", "Dodavatelé tuzemsko", "liability", "vendor", true],
  ["324", "Přijaté zálohy", "liability", "customer"],
  ["331", "Zaměstnanci", "liability", "employee"],
  ["336", "Zúčtování s institucemi sociálního a zdravotního pojištění", "liability"],
  ["341", "Daň z příjmů", "liability"],
  ["342", "Ostatní přímé daně", "liability"],
  ["343", "Daň z přidané hodnoty", "liability", "vat", true],
  ["395", "Vnitřní zúčtování", "asset"],
  ["411", "Základní kapitál", "equity"],
  ["428", "Nerozdělený zisk minulých let", "equity"],
  ["431", "Výsledek hospodaření ve schvalovacím řízení", "equity"],
  ["501", "Spotřeba materiálu", "expense"],
  ["502", "Spotřeba energie", "expense"],
  ["504", "Prodané zboží", "expense"],
  ["511", "Opravy a udržování", "expense"],
  ["512", "Cestovné", "expense"],
  ["518", "Ostatní služby", "expense"],
  ["521", "Mzdové náklady", "expense"],
  ["524", "Zákonné sociální a zdravotní pojištění", "expense"],
  ["548", "Ostatní provozní náklady", "expense"],
  ["551", "Odpisy dlouhodobého majetku", "expense"],
  ["562", "Úroky", "expense"],
  ["568", "Ostatní finanční náklady", "expense"],
  ["601", "Tržby za vlastní výrobky", "revenue"],
  ["602", "Tržby z prodeje služeb", "revenue"],
  ["604", "Tržby za zboží", "revenue"],
  ["648", "Ostatní provozní výnosy", "revenue"],
  ["662", "Úroky", "revenue"],
  ["668", "Ostatní finanční výnosy", "revenue"],
  ["701", "Počáteční účet rozvažný", "equity"],
  ["702", "Konečný účet rozvažný", "equity"],
  ["710", "Účet zisků a ztrát", "equity"],
];

/**
 * Účet, na který se dá účtovat: zadaný, a má-li analytiku, její první účet.
 * Pro výchozí nastavení modulů (skupiny odběratelů, pokladny, banky…).
 */
export async function postingAccount(data: DataApi, num: string): Promise<string | null> {
  const [acc] = await data.find("gl.account", { accountNum: num }, { take: 1 });
  if (!acc) return null;
  const [child] = await data.find("gl.account", { parentId: acc.id, blocked: false }, { take: 1, orderBy: { accountNum: "asc" } });
  return String((child ?? acc).id);
}

export async function glSetup(data: DataApi): Promise<void> {
  if (!(await data.find("gl.account", {}, { take: 1 })).length) {
    // syntetika před analytikou (analytika se k ní přiřadí)
    for (const [accountNum, name, type, postingType, noManualEntry] of DEFAULT_ACCOUNTS) {
      await data.create("gl.account", { accountNum, name, type, postingType: postingType ?? null, noManualEntry: !!noManualEntry });
    }
  } else {
    // stávající rozvrh: dopočítat úroveň a třídu (zakládá je až událost účtu)
    for (const a of await data.find("gl.account", { level: null }, { take: 5000, orderBy: { accountNum: "asc" } })) {
      await data.update("gl.account", String(a.id), { accountNum: a.accountNum });
    }
    // jen doplnit chybějící druh účtu u známých účtů (nic nepřepisovat)
    for (const [accountNum, , , postingType] of DEFAULT_ACCOUNTS) {
      if (!postingType) continue;
      const [a] = await data.find("gl.account", { accountNum }, { take: 1 });
      if (a && !a.postingType) await data.update("gl.account", String(a.id), { postingType });
    }
  }
  // fiskální rok = aktuální kalendářní rok s měsíčními obdobími
  if (!(await data.find("gl.fiscalYear", {}, { take: 1 })).length) {
    const y = new Date().getUTCFullYear();
    const fy = await data.create("gl.fiscalYear", { code: String(y), startDate: `${y}-01-01`, endDate: `${y}-12-31` });
    await createPeriods(data, fy);
  }
  if (!(await data.find("gl.journalName", { code: "GEN" }, { take: 1 })).length) {
    await data.create("gl.journalName", { code: "GEN", name: "Obecný deník" });
  }
}

export type { RecordData };
