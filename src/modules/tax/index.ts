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

/**
 * Daňová transakce — obraz DPH každého zaúčtovaného dokladu (obdoba
 * TaxTrans v AX/D365). Z nich vzniká přiznání k DPH a kontrolní hlášení.
 */
export const taxTrans = defineObject({
  id: "tax.trans",
  table: "tax_trans",
  label: "@TAX:Trans",
  labelPlural: "@TAX:TransPlural",
  scope: "company",
  systemOnly: true,
  fields: {
    taxDate: { edt: Edts.TransDate, label: "@TAX:TaxDate", mandatory: true },
    taxCodeId: { edt: refEdt("tax.taxCode", "@TAX:TaxCode"), mandatory: true },
    direction: { edt: enumEdt(TaxDirection), mandatory: true },
    base: { edt: Edts.Amount, label: "@TAX:Base", mandatory: true },
    tax: { edt: Edts.Amount, label: "@TAX:Tax", mandatory: true },
    currencyId: { edt: refEdt("sys.currency", "@SYS:Currency") },
    baseCur: { edt: Edts.AmountCur, label: "@TAX:BaseCur" },
    taxCur: { edt: Edts.AmountCur, label: "@TAX:TaxCur" },
    subjectId: { edt: refEdt("gab.subject", "@TAX:Partner") },
    vatId: { edt: Edts.VatId, label: "@TAX:PartnerVatId" },
    documentNum: { edt: Edts.Description, label: "@TAX:DocumentNum" },
    voucherId: { edt: refEdt("gl.voucher", "@GL:Voucher") },
    sourceObject: { edt: Edts.Description, label: "@GL:SourceObject" },
    sourceId: { edt: Edts.Description, label: "@GL:SourceId" },
  },
  titleField: "documentNum",
  list: ["taxDate", "taxCodeId", "direction", "base", "tax", "currencyId", "subjectId", "vatId", "documentNum", "voucherId"],
  form: [
    { label: "@SYS:General", fields: ["taxDate", "taxCodeId", "direction", "base", "tax"] },
    { label: "@TAX:Partner", fields: ["subjectId", "vatId", "documentNum", "voucherId"] },
    { label: "@SYS:Currency", fields: ["currencyId", "baseCur", "taxCur"] },
  ],
  defaultSort: { field: "taxDate", dir: "desc" },
});

export default defineModule({
  id: "tax",
  label: "@TAX:Module",
  description: "@TAX:ModuleDesc",
  icon: "ReceiptMoney",
  dependsOn: ["gl", "gab"],
  enums: [TaxDirection],
  objects: [taxCode, taxTrans],
  menu: [
    { label: "@TAX:Module", items: [{ object: "tax.trans" }] },
    { label: "@SYS:Setup", items: [{ object: "tax.taxCode" }] },
  ],
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
      Trans: "Daňová transakce",
      TransPlural: "Daňové transakce",
      TaxDate: "DUZP",
      Base: "Základ",
      Tax: "Daň",
      BaseCur: "Základ v měně",
      TaxCur: "Daň v měně",
      Partner: "Partner",
      PartnerVatId: "DIČ partnera",
      DocumentNum: "Číslo dokladu",
      InvoiceNum: "Číslo faktury",
      InvoiceDate: "Datum vystavení",
      DueDate: "Splatnost",
      AmountNet: "Základ",
      TaxAmount: "DPH",
      AmountGross: "Celkem s DPH",
      PaymentDays: "Splatnost (dní)",
      UnitPrice: "Cena za jednotku",
      Header: "Hlavička",
      Amounts: "Částky",
      Lines: "Řádky faktury",
      Line: "Řádek faktury",
      OpenAmount: "Částka",
      Dates: "Data",
      Vs: "Variabilní symbol",
      VsHelp: "Variabilní symbol má 1–10 číslic.",
      TransKind: "Druh",
      KindInvoice: "Faktura",
      KindPayment: "Úhrada",
      PaidAmount: "Uhrazeno",
      Closed: "Vyrovnáno",
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
      Trans: "Tax transaction",
      TransPlural: "Tax transactions",
      TaxDate: "Tax point date",
      Base: "Base",
      Tax: "Tax",
      BaseCur: "Base in currency",
      TaxCur: "Tax in currency",
      Partner: "Partner",
      PartnerVatId: "Partner VAT ID",
      DocumentNum: "Document number",
      InvoiceNum: "Invoice number",
      InvoiceDate: "Invoice date",
      DueDate: "Due date",
      AmountNet: "Net amount",
      TaxAmount: "VAT",
      AmountGross: "Total incl. VAT",
      PaymentDays: "Payment terms (days)",
      UnitPrice: "Unit price",
      Header: "Header",
      Amounts: "Amounts",
      Lines: "Invoice lines",
      Line: "Invoice line",
      OpenAmount: "Amount",
      Dates: "Dates",
      Vs: "Variable symbol",
      VsHelp: "The variable symbol has 1–10 digits.",
      TransKind: "Type",
      KindInvoice: "Invoice",
      KindPayment: "Payment",
      PaidAmount: "Paid",
      Closed: "Settled",
    },
  },
});
