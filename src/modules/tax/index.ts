/**
 * DPH. Daňové kódy nesou sazbu, směr (na výstupu / na vstupu), účet
 * v hlavní knize a řádek přiznání a oddíl kontrolního hlášení.
 * Výpočet daně z dokladů a podklady pro přiznání/KH přijdou s modulem
 * odběratelů a dodavatelů (viz docs/ARCHITEKTURA.md).
 */
import { Edts, defineEdt, defineEnum, enumEdt, refEdt } from "@/core/edt";
import { defineModule } from "@/core/module";
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

export default defineModule({
  id: "tax",
  label: "@TAX:Module",
  description: "@TAX:ModuleDesc",
  dependsOn: ["gl"],
  enums: [TaxDirection],
  objects: [taxCode],
  menu: [{ label: "@TAX:Module", items: [{ object: "tax.taxCode" }] }],
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
