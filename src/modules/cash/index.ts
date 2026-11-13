/**
 * Pokladní kniha (hotovost): pokladny s účtem 211xxx, příjmové a výdajové
 * pokladní doklady (PPD / VPD) s protiúčtem a volitelnou DPH (zjednodušený
 * daňový doklad), zaúčtování do hlavní knihy a report Pokladní kniha
 * (zůstatek z účtu pokladny — obsahuje i uzávěrky směn z kasy).
 */
import { Edts, defineEnum, enumEdt, refEdt } from "@/core/edt";
import { defineModule, type DataApi } from "@/core/module";
import { defineObject } from "@/core/object";
import { DIM_NAMES, JournalStatus, dimFields } from "@/modules/gl";
import { postingAccount } from "@/modules/gl/setup";
import { cashBook } from "./report";

export const CashDirection = defineEnum({
  id: "CashDirection",
  label: "@CASH:Direction",
  values: [
    { value: "in", label: "@CASH:In", color: "success" },
    { value: "out", label: "@CASH:Out", color: "warning" },
  ],
});

export const desk = defineObject({
  id: "cash.desk",
  table: "cash_desk",
  label: "@CASH:Desk",
  labelPlural: "@CASH:Desks",
  scope: "company",
  fields: {
    code: { edt: Edts.Code, mandatory: true },
    name: { edt: Edts.Name, mandatory: true },
    accountId: { edt: refEdt("gl.account", "@CASH:Account"), mandatory: true },
    // hotovost do mínusu nejde; volitelně limit zůstatku (upozornění)
    maxBalance: { edt: Edts.Balance, label: "@CASH:MaxBalance" },
    blocked: { edt: Edts.NoYes, label: "@GL:Blocked" },
  },
  titleField: "code",
  list: ["code", "name", "accountId", "maxBalance", "blocked"],
  form: [{ label: "@SYS:General", fields: ["code", "name", "accountId", "maxBalance", "blocked"] }],
  unique: [["code"]],
  defaultSort: { field: "code", dir: "asc" },
  lines: [{ object: "cash.voucher", field: "deskId", label: "@CASH:Vouchers", owned: false }],
});

export const voucher = defineObject({
  id: "cash.voucher",
  table: "cash_voucher",
  label: "@CASH:Voucher",
  labelPlural: "@CASH:Vouchers",
  scope: "company",
  fields: {
    // číslo z řady PPD / VPD podle směru (při uložení)
    docNum: { edt: Edts.Code, label: "@CASH:DocNum", readOnly: true },
    deskId: { edt: refEdt("cash.desk", "@CASH:Desk"), mandatory: true },
    direction: { edt: enumEdt(CashDirection), mandatory: true, default: "out" },
    date: { edt: Edts.TransDate, mandatory: true, default: "$today" },
    description: { edt: Edts.Description, label: "@CASH:Purpose", mandatory: true },
    partnerName: { edt: Edts.Name, label: "@CASH:PartnerName" },
    subjectId: { edt: refEdt("gab.subject", "@GAB:Subject"), optionalRef: true },
    amount: { edt: Edts.Amount, label: "@CASH:AmountGross", mandatory: true },
    offsetAccountId: { edt: refEdt("gl.account", "@CASH:OffsetAccount"), mandatory: true },
    // DPH (zjednodušený daňový doklad): základ a daň se dopočítají z částky
    taxCodeId: { edt: refEdt("tax.taxCode", "@TAX:TaxCode"), optionalRef: true },
    amountNet: { edt: Edts.Amount, label: "@CASH:AmountNet", readOnly: true },
    taxAmount: { edt: Edts.Amount, label: "@CASH:TaxAmount", readOnly: true },
    ...dimFields(),
    status: { edt: enumEdt(JournalStatus), mandatory: true, default: "draft", readOnly: true },
    voucherId: { edt: refEdt("gl.voucher", "@GL:Voucher"), readOnly: true },
  },
  titleField: "docNum",
  list: ["docNum", "date", "deskId", "direction", "description", "partnerName", "amount", "status"],
  form: [
    { label: "@SYS:General", fields: ["docNum", "deskId", "direction", "date", "description", "partnerName", "subjectId"] },
    { label: "@CASH:Amounts", fields: ["amount", "offsetAccountId", "taxCodeId", "amountNet", "taxAmount"] },
    { label: "@GL:Dimensions", fields: DIM_NAMES },
    { label: "@CASH:Posting", fields: ["status", "voucherId"] },
  ],
  unique: [["docNum"]],
  defaultSort: { field: "date", dir: "desc" },
  lockedWhen: { field: "status", equals: "posted" },
  actions: [{ id: "post", label: "@GL:Post", when: { field: "status", equals: "draft" } }],
});

/** Výchozí pokladna firmy na účtu 211 (pokud žádná není). */
async function cashSetup(data: DataApi) {
  if ((await data.find("cash.desk", {}, { take: 1 })).length) return;
  const acc = await postingAccount(data, "211");
  if (acc) await data.create("cash.desk", { code: "HOT", name: "Hlavní pokladna", accountId: acc });
}

export default defineModule({
  id: "cash",
  label: "@CASH:Module",
  description: "@CASH:ModuleDesc",
  icon: "Money",
  dependsOn: ["gl"],
  enums: [CashDirection],
  objects: [desk, voucher],
  menu: [
    { label: "@CASH:Module", items: [{ object: "cash.voucher" }] },
    { label: "@SYS:Reports", kind: "reports", items: [{ href: "/report/cash/cashBook", label: "@CASH:CashBook" }] },
    { label: "@SYS:Setup", kind: "setup", items: [{ object: "cash.desk" }] },
  ],
  numberSeqs: [
    { code: "CASHIN", name: "@CASH:SeqIn", format: "PPD{YY}{#####}" },
    { code: "CASHOUT", name: "@CASH:SeqOut", format: "VPD{YY}{#####}" },
  ],
  setup: cashSetup,
  reports: [cashBook],
  labels: {
    cs: {
      Module: "Pokladní kniha",
      ModuleDesc: "Hotovostní pokladny, příjmové a výdajové pokladní doklady, pokladní kniha.",
      Desk: "Pokladna hotovosti",
      Desks: "Pokladny hotovosti",
      Account: "Účet pokladny",
      MaxBalance: "Limit zůstatku",
      Voucher: "Pokladní doklad",
      Vouchers: "Pokladní doklady",
      DocNum: "Číslo dokladu",
      Direction: "Druh",
      In: "Příjem",
      Out: "Výdej",
      Purpose: "Účel",
      PartnerName: "Přijato od / vyplaceno komu",
      AmountGross: "Částka",
      AmountNet: "Základ",
      TaxAmount: "DPH",
      OffsetAccount: "Protiúčet",
      Amounts: "Částka a zaúčtování",
      Posting: "Stav",
      SeqIn: "Příjmové pokladní doklady",
      SeqOut: "Výdajové pokladní doklady",
      CashBook: "Pokladní kniha",
      CashBookDesc: "Příjmy, výdaje a průběžný zůstatek pokladny za období (včetně uzávěrek směn z kasy).",
      Opening: "Počáteční zůstatek",
      Closing: "Konečný zůstatek",
      Income: "Příjem",
      Expense: "Výdej",
      Balance: "Zůstatek",
      Text: "Text",
      NegativeBalance: "Pokladna {desk} by šla do mínusu (zůstatek k {date}: {balance}). Hotovost nelze vydat víc, než v pokladně je.",
      OverLimit: "Zůstatek pokladny {desk} ({balance}) by překročil limit {limit} — odveďte hotovost do banky.",
      AmountPositive: "Částka musí být kladná.",
      NoDesk: "Firma nemá pokladnu hotovosti.",
    },
    en: {
      Module: "Cash book",
      ModuleDesc: "Cash desks, cash receipts and payments, cash book.",
      Desk: "Cash desk",
      Desks: "Cash desks",
      Account: "Cash account",
      MaxBalance: "Balance limit",
      Voucher: "Cash voucher",
      Vouchers: "Cash vouchers",
      DocNum: "Document number",
      Direction: "Type",
      In: "Receipt",
      Out: "Payment",
      Purpose: "Purpose",
      PartnerName: "Received from / paid to",
      AmountGross: "Amount",
      AmountNet: "Net",
      TaxAmount: "VAT",
      OffsetAccount: "Offset account",
      Amounts: "Amount and posting",
      Posting: "Status",
      SeqIn: "Cash receipts",
      SeqOut: "Cash payments",
      CashBook: "Cash book",
      CashBookDesc: "Receipts, payments and running balance of the cash desk for a period (including register shift closings).",
      Opening: "Opening balance",
      Closing: "Closing balance",
      Income: "Receipt",
      Expense: "Payment",
      Balance: "Balance",
      Text: "Text",
      NegativeBalance: "Cash desk {desk} would go negative (balance at {date}: {balance}). You cannot pay out more cash than there is.",
      OverLimit: "Cash desk {desk} balance ({balance}) would exceed the limit {limit} — deposit cash to the bank.",
      AmountPositive: "The amount must be positive.",
      NoDesk: "The company has no cash desk.",
    },
  },
});
