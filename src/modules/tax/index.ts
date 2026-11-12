/**
 * DPH. Daňové kódy nesou sazbu, směr (na výstupu / na vstupu), účet
 * v hlavní knize a řádek přiznání a oddíl kontrolního hlášení.
 * Výpočet daně z dokladů a podklady pro přiznání/KH přijdou s modulem
 * odběratelů a dodavatelů (viz docs/ARCHITEKTURA.md).
 */
import { Edts, defineEdt, defineEnum, enumEdt, refEdt } from "@/core/edt";
import { defineModule, type DataApi } from "@/core/module";
import { defineObject } from "@/core/object";

export const TaxDirection = defineEnum({
  id: "TaxDirection",
  label: "@TAX:Direction",
  values: [
    { value: "output", label: "@TAX:Output" },
    { value: "input", label: "@TAX:Input" },
  ],
});

const ReportLine = defineEdt({ id: "TaxReportLine", kind: "string", label: "@TAX:ReportLine", maxLength: 10 });
const KhSection = defineEdt({ id: "KhSection", kind: "string", label: "@TAX:KhSection", maxLength: 4, transform: "upper" });

export const taxCode = defineObject({
  id: "tax.taxCode",
  table: "tax_code",
  label: "@TAX:TaxCode",
  labelPlural: "@TAX:TaxCodes",
  scope: "company",
  fields: {
    code: { edt: Edts.Code, mandatory: true },
    name: { edt: Edts.Name, mandatory: true },
    rate: { edt: Edts.Percent, label: "@TAX:Rate", mandatory: true },
    direction: { edt: enumEdt(TaxDirection), mandatory: true },
    reverseCharge: { edt: Edts.NoYes, label: "@TAX:ReverseCharge" },
    accountId: { edt: refEdt("gl.account", "@TAX:Account"), mandatory: true },
    reportLine: { edt: ReportLine },
    khSection: { edt: KhSection },
  },
  titleField: "code",
  list: ["code", "name", "rate", "direction", "reverseCharge", "accountId", "reportLine", "khSection"],
  form: [
    { label: "@SYS:General", fields: ["code", "name", "rate", "direction", "reverseCharge"] },
    { label: "@TAX:Posting", fields: ["accountId", "reportLine", "khSection"] },
  ],
  unique: [["code"]],
  defaultSort: { field: "code", dir: "asc" },
});

/** Výchozí daňové kódy (jen pokud firma žádné nemá). */
async function taxSetup(data: DataApi) {
  if ((await data.find("tax.taxCode", {}, { take: 1 })).length) return;
  const [vat] = await data.find("gl.account", { accountNum: "343" }, { take: 1 });
  if (!vat) return;
  const codes: [string, string, string, string, string, string][] = [
    ["V21", "DPH na výstupu 21 %", "21", "output", "1", "A4"],
    ["V12", "DPH na výstupu 12 %", "12", "output", "2", "A4"],
    ["P21", "DPH na vstupu 21 %", "21", "input", "40", "B2"],
    ["P12", "DPH na vstupu 12 %", "12", "input", "41", "B2"],
  ];
  for (const [code, name, rate, direction, reportLine, khSection] of codes) {
    await data.create("tax.taxCode", { code, name, rate, direction, accountId: vat.id, reportLine, khSection });
  }
}

export default defineModule({
  id: "tax",
  label: "@TAX:Module",
  description: "@TAX:ModuleDesc",
  icon: "ReceiptMoney",
  dependsOn: ["gl"],
  enums: [TaxDirection],
  objects: [taxCode],
  menu: [{ label: "@TAX:Module", items: [{ object: "tax.taxCode" }] }],
  setup: taxSetup,
  labels: {
    cs: {
      Module: "DPH",
      ModuleDesc: "Daňové kódy, sazby, přiznání k DPH a kontrolní hlášení.",
      TaxCode: "Daňový kód",
      TaxCodes: "Daňové kódy",
      Rate: "Sazba %",
      Direction: "Směr",
      Output: "Na výstupu",
      Input: "Na vstupu",
      ReverseCharge: "Přenesená daňová povinnost",
      Account: "Účet DPH",
      ReportLine: "Řádek přiznání",
      KhSection: "Oddíl KH",
      Posting: "Zaúčtování a výkazy",
    },
    en: {
      Module: "VAT",
      ModuleDesc: "Tax codes, rates, VAT return and control statement.",
      TaxCode: "Tax code",
      TaxCodes: "Tax codes",
      Rate: "Rate %",
      Direction: "Direction",
      Output: "Output",
      Input: "Input",
      ReverseCharge: "Reverse charge",
      Account: "VAT account",
      ReportLine: "Return line",
      KhSection: "Control statement section",
      Posting: "Posting and reporting",
    },
  },
});
