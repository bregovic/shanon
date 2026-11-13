/**
 * Výchozí nastavení hlavní knihy pro novou firmu (nebo po zapnutí modulu).
 * Zakládá jen to, co chybí — účtový rozvrh, jen když je úplně prázdný.
 */
import type { DataApi, RecordData } from "@/core/module";
import { createPeriods } from "./posting";

type Acc = [num: string, name: string, type: string, postingType?: string, noManualEntry?: boolean];

/**
 * Výřez směrné účtové osnovy pro malou firmu — účty 6místné (syntetika + 000,
 * analytiky si firma doplní). Peněžní, saldokontní a daňové účty mají zákaz
 * ručního zápisu — účtují na ně jen doklady modulů.
 */
export const DEFAULT_ACCOUNTS: Acc[] = [
  ["013000", "Software", "asset", "fixedAsset"],
  ["018000", "Drobný dlouhodobý nehmotný majetek", "asset", "fixedAsset"],
  ["021000", "Stavby", "asset", "fixedAsset"],
  ["022000", "Hmotné movité věci a jejich soubory", "asset", "fixedAsset"],
  ["028000", "Drobný dlouhodobý hmotný majetek", "asset", "fixedAsset"],
  ["031000", "Pozemky", "asset", "fixedAsset"],
  ["042000", "Nedokončený dlouhodobý hmotný majetek", "asset", "fixedAsset"],
  ["073000", "Oprávky k softwaru", "asset", "fixedAsset"],
  ["081000", "Oprávky ke stavbám", "asset", "fixedAsset"],
  ["082000", "Oprávky k hmotným movitým věcem", "asset", "fixedAsset"],
  ["111000", "Pořízení materiálu", "asset", "inventory"],
  ["112000", "Materiál na skladě", "asset", "inventory"],
  ["131000", "Pořízení zboží", "asset", "inventory"],
  ["132000", "Zboží na skladě", "asset", "inventory"],
  ["211000", "Pokladna", "asset", "cash", true],
  ["213000", "Ceniny", "asset", "cash"],
  ["221000", "Bankovní účty", "asset", "bank", true],
  ["231000", "Krátkodobé úvěry", "liability"],
  ["261000", "Peníze na cestě", "asset", "cashInTransit"],
  ["311000", "Odběratelé", "asset", "customer", true],
  ["314000", "Poskytnuté zálohy", "asset", "vendor"],
  ["315000", "Ostatní pohledávky", "asset"],
  ["321000", "Dodavatelé", "liability", "vendor", true],
  ["324000", "Přijaté zálohy", "liability", "customer"],
  ["325000", "Ostatní závazky", "liability"],
  ["331000", "Zaměstnanci", "liability", "employee"],
  ["333000", "Ostatní závazky vůči zaměstnancům", "liability", "employee"],
  ["335000", "Pohledávky za zaměstnanci", "asset", "employee"],
  ["336000", "Zúčtování s institucemi sociálního a zdravotního pojištění", "liability"],
  ["341000", "Daň z příjmů", "liability"],
  ["342000", "Ostatní přímé daně", "liability"],
  ["343000", "Daň z přidané hodnoty", "liability", "vat", true],
  ["345000", "Ostatní daně a poplatky", "liability"],
  ["365000", "Ostatní závazky ke společníkům", "liability"],
  ["378000", "Jiné pohledávky", "asset"],
  ["379000", "Jiné závazky", "liability"],
  ["381000", "Náklady příštích období", "asset"],
  ["383000", "Výdaje příštích období", "liability"],
  ["384000", "Výnosy příštích období", "liability"],
  ["388000", "Dohadné účty aktivní", "asset"],
  ["389000", "Dohadné účty pasivní", "liability"],
  ["395000", "Vnitřní zúčtování", "asset"],
  ["411000", "Základní kapitál", "equity"],
  ["413000", "Ostatní kapitálové fondy", "equity"],
  ["428000", "Nerozdělený zisk minulých let", "equity"],
  ["429000", "Neuhrazená ztráta minulých let", "equity"],
  ["431000", "Výsledek hospodaření ve schvalovacím řízení", "equity"],
  ["461000", "Dlouhodobé úvěry", "liability"],
  ["491000", "Účet individuálního podnikatele", "equity"],
  ["501000", "Spotřeba materiálu", "expense"],
  ["502000", "Spotřeba energie", "expense"],
  ["503000", "Spotřeba ostatních neskladovatelných dodávek", "expense"],
  ["504000", "Prodané zboží", "expense"],
  ["511000", "Opravy a udržování", "expense"],
  ["512000", "Cestovné", "expense"],
  ["513000", "Náklady na reprezentaci", "expense"],
  ["518000", "Ostatní služby", "expense"],
  ["518100", "Nájemné", "expense"],
  ["518200", "Telefony a internet", "expense"],
  ["518300", "Účetní a poradenské služby", "expense"],
  ["518400", "Software a licence", "expense"],
  ["521000", "Mzdové náklady", "expense"],
  ["524000", "Zákonné sociální a zdravotní pojištění", "expense"],
  ["527000", "Zákonné sociální náklady", "expense"],
  ["531000", "Daň silniční", "expense"],
  ["538000", "Ostatní daně a poplatky", "expense"],
  ["543000", "Dary", "expense"],
  ["544000", "Smluvní pokuty a úroky z prodlení", "expense"],
  ["545000", "Ostatní pokuty a penále", "expense"],
  ["546000", "Odpis pohledávky", "expense"],
  ["548000", "Ostatní provozní náklady", "expense"],
  ["549000", "Manka a škody", "expense"],
  ["551000", "Odpisy dlouhodobého majetku", "expense"],
  ["562000", "Úroky", "expense"],
  ["563000", "Kurzové ztráty", "expense"],
  ["568000", "Ostatní finanční náklady", "expense"],
  ["591000", "Daň z příjmů splatná", "expense"],
  ["601000", "Tržby za vlastní výrobky", "revenue"],
  ["602000", "Tržby z prodeje služeb", "revenue"],
  ["604000", "Tržby za zboží", "revenue"],
  ["641000", "Tržby z prodeje dlouhodobého majetku", "revenue"],
  ["644000", "Smluvní pokuty a úroky z prodlení", "revenue"],
  ["648000", "Ostatní provozní výnosy", "revenue"],
  ["662000", "Úroky", "revenue"],
  ["663000", "Kurzové zisky", "revenue"],
  ["668000", "Ostatní finanční výnosy", "revenue"],
  ["701000", "Počáteční účet rozvažný", "equity"],
  ["702000", "Konečný účet rozvažný", "equity"],
  ["710000", "Účet zisků a ztrát", "equity"],
];

/**
 * Účet syntetiky, na který se účtuje: xxx000, jinak první účet té syntetiky.
 * Pro výchozí nastavení modulů (skupiny odběratelů, pokladny, banky…).
 */
export async function postingAccount(data: DataApi, synthetic: string): Promise<string | null> {
  const syn = synthetic.slice(0, 3);
  const [exact] = await data.find("gl.account", { accountNum: `${syn}000` }, { take: 1 });
  if (exact && !exact.blocked) return String(exact.id);
  const [first] = await data.find("gl.account", { synthetic: syn, blocked: false }, { take: 1, orderBy: { accountNum: "asc" } });
  return first ? String(first.id) : null;
}

export async function glSetup(data: DataApi): Promise<void> {
  if (!(await data.find("gl.account", {}, { take: 1 })).length) {
    // syntetika před analytikou (analytika se k ní přiřadí)
    for (const [accountNum, name, type, postingType, noManualEntry] of DEFAULT_ACCOUNTS) {
      await data.create("gl.account", { accountNum, name, type, postingType: postingType ?? null, noManualEntry: !!noManualEntry });
    }
  } else {
    // stávající rozvrh: 3místné účty doplnit na 6 míst (211 → 211000), dopočítat syntetiku a třídu
    for (const a of await data.find("gl.account", { synthetic: null }, { take: 5000, orderBy: { accountNum: "asc" } })) {
      const num = String(a.accountNum);
      const padded = num.length === 3 ? `${num}000` : num;
      // 211 i 211000 zároveň (nemělo by nastat) — nechat, firma to vyřeší ručně
      if (padded !== num && (await data.find("gl.account", { accountNum: padded }, { take: 1 })).length) continue;
      await data.update("gl.account", String(a.id), { accountNum: padded });
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
  // parametry hlavní knihy: účetní měna firmy, účty podle osnovy
  if (!(await data.find("gl.parameters", {}, { take: 1 })).length && data.companyId) {
    const company = await data.get("sys.company", data.companyId);
    const [cur] = await data.find("sys.currency", { code: String(company?.currency ?? "CZK") }, { take: 1 });
    if (cur) {
      await data.create("gl.parameters", {
        accountingCurrencyId: cur.id,
        rateSource: cur.code === "CZK" ? "cnb" : "ecb",
        rateMaxAgeDays: 7,
        realizedGainAccountId: await postingAccount(data, "663"),
        realizedLossAccountId: await postingAccount(data, "563"),
        roundingGainAccountId: await postingAccount(data, "648"),
        roundingLossAccountId: await postingAccount(data, "548"),
        profitLossAccountId: await postingAccount(data, "431"),
        retainedEarningsAccountId: await postingAccount(data, "428"),
        openingAccountId: await postingAccount(data, "701"),
        closingAccountId: await postingAccount(data, "702"),
      });
    }
  }
  // finanční dimenze (sdílené v tenantovi): středisko, zakázka, partner
  for (const [code, name, position, source] of [
    ["STR", "Středisko", 1, "custom"],
    ["ZAK", "Zakázka", 2, "custom"],
    ["PAR", "Partner", 3, "partner"],
  ] as const) {
    // jen chybějící kód na volném pořadí (tenant si mohl dimenze upravit)
    const taken = await data.find("gl.dimension", { position }, { take: 1 });
    if (!taken.length && !(await data.find("gl.dimension", { code }, { take: 1 })).length) await data.create("gl.dimension", { code, name, position, source, active: true });
  }
  if (!(await data.find("gl.journalName", { code: "GEN" }, { take: 1 })).length) {
    await data.create("gl.journalName", { code: "GEN", name: "Obecný deník" });
  }
}

export type { RecordData };
