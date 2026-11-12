/**
 * Hlavní kniha. Každá transakce v systému (faktura, pokladna, majetek…)
 * má svůj obraz v účetním dokladu (gl.voucher) a zápisech (gl.trans).
 * Doklady vznikají výhradně přes postVoucher() — ručně je nelze měnit.
 */
import { Edts, defineEdt, defineEnum, enumEdt, refEdt } from "@/core/edt";
import { defineModule } from "@/core/module";
import { defineObject } from "@/core/object";

export const AccountType = defineEnum({
  id: "AccountType",
  label: "@GL:AccountType",
  values: [
    { value: "asset", label: "@GL:Asset" },
    { value: "liability", label: "@GL:Liability" },
    { value: "equity", label: "@GL:Equity" },
    { value: "revenue", label: "@GL:Revenue" },
    { value: "expense", label: "@GL:Expense" },
  ],
});

export const JournalStatus = defineEnum({
  id: "JournalStatus",
  label: "@GL:Status",
  values: [
    { value: "draft", label: "@GL:Draft" },
    { value: "posted", label: "@GL:Posted" },
  ],
});

export const AccountNum = defineEdt({
  id: "AccountNum",
  kind: "string",
  label: "@GL:AccountNum",
  maxLength: 10,
  pattern: /^\d{3,10}$/,
  patternMessage: "@GL:AccountNumHelp",
});
export const VoucherNum = defineEdt({ id: "VoucherNum", kind: "string", label: "@GL:Voucher", maxLength: 30 });
const AccountRef = refEdt("gl.account", "@GL:Account");
const CostCenterRef = refEdt("gl.costCenter", "@GL:CostCenter");
const VoucherRef = refEdt("gl.voucher", "@GL:Voucher");
const JournalRef = refEdt("gl.journal", "@GL:Journal");

export const account = defineObject({
  id: "gl.account",
  table: "gl_account",
  label: "@GL:Account",
  labelPlural: "@GL:Accounts",
  scope: "company",
  fields: {
    accountNum: { edt: AccountNum, mandatory: true },
    name: { edt: Edts.Name, mandatory: true },
    type: { edt: enumEdt(AccountType), mandatory: true },
    blocked: { edt: Edts.NoYes, label: "@GL:Blocked" },
  },
  titleField: "accountNum",
  list: ["accountNum", "name", "type", "blocked"],
  form: [{ label: "@SYS:General", fields: ["accountNum", "name", "type", "blocked"] }],
  unique: [["accountNum"]],
  defaultSort: { field: "accountNum", dir: "asc" },
});

export const costCenter = defineObject({
  id: "gl.costCenter",
  table: "gl_cost_center",
  label: "@GL:CostCenter",
  labelPlural: "@GL:CostCenters",
  scope: "company",
  fields: {
    code: { edt: Edts.Code, mandatory: true },
    name: { edt: Edts.Name, mandatory: true },
  },
  titleField: "code",
  list: ["code", "name"],
  form: [{ label: "@SYS:General", fields: ["code", "name"] }],
  unique: [["code"]],
  defaultSort: { field: "code", dir: "asc" },
});

export const voucher = defineObject({
  id: "gl.voucher",
  table: "gl_voucher",
  label: "@GL:Voucher",
  labelPlural: "@GL:Vouchers",
  scope: "company",
  systemOnly: true,
  fields: {
    voucherNum: { edt: VoucherNum, mandatory: true },
    date: { edt: Edts.TransDate, mandatory: true },
    description: { edt: Edts.Description },
    sourceObject: { edt: Edts.Description, label: "@GL:SourceObject" },
    sourceId: { edt: Edts.Description, label: "@GL:SourceId" },
  },
  titleField: "voucherNum",
  list: ["voucherNum", "date", "description", "sourceObject"],
  form: [{ label: "@SYS:General", fields: ["voucherNum", "date", "description", "sourceObject"] }],
  unique: [["voucherNum"]],
  defaultSort: { field: "date", dir: "desc" },
  lines: [{ object: "gl.trans", field: "voucherId", label: "@GL:Transactions" }],
});

export const trans = defineObject({
  id: "gl.trans",
  table: "gl_trans",
  label: "@GL:Trans",
  labelPlural: "@GL:Transactions",
  scope: "company",
  systemOnly: true,
  fields: {
    voucherId: { edt: VoucherRef, mandatory: true },
    date: { edt: Edts.TransDate, mandatory: true },
    accountId: { edt: AccountRef, mandatory: true },
    costCenterId: { edt: CostCenterRef },
    /** kladná = MD (debet), záporná = D (kredit) */
    amount: { edt: Edts.Amount, mandatory: true, label: "@GL:AmountSigned" },
    text: { edt: Edts.Description, label: "@GL:Text" },
  },
  titleField: "text",
  list: ["date", "voucherId", "accountId", "costCenterId", "amount", "text"],
  form: [{ label: "@SYS:General", fields: ["voucherId", "date", "accountId", "costCenterId", "amount", "text"] }],
  defaultSort: { field: "date", dir: "desc" },
});

export const journal = defineObject({
  id: "gl.journal",
  table: "gl_journal",
  label: "@GL:Journal",
  labelPlural: "@GL:Journals",
  scope: "company",
  fields: {
    journalNum: { edt: VoucherNum, label: "@GL:JournalNum", mandatory: true, readOnly: true },
    date: { edt: Edts.TransDate, mandatory: true },
    description: { edt: Edts.Description, mandatory: true },
    status: { edt: enumEdt(JournalStatus), mandatory: true, default: "draft", readOnly: true },
    voucherId: { edt: VoucherRef, readOnly: true },
  },
  titleField: "journalNum",
  list: ["journalNum", "date", "description", "status", "voucherId"],
  form: [{ label: "@SYS:General", fields: ["journalNum", "date", "description", "status", "voucherId"] }],
  numberSeq: { field: "journalNum", seq: "GLJOURNAL" },
  defaultSort: { field: "date", dir: "desc" },
  lines: [{ object: "gl.journalLine", field: "journalId", label: "@SYS:Lines" }],
  actions: [{ id: "post", label: "@GL:Post", when: { field: "status", equals: "draft" } }],
  lockedWhen: { field: "status", equals: "posted" },
});

export const journalLine = defineObject({
  id: "gl.journalLine",
  table: "gl_journal_line",
  label: "@GL:JournalLine",
  labelPlural: "@SYS:Lines",
  scope: "company",
  fields: {
    journalId: { edt: JournalRef, mandatory: true },
    accountId: { edt: AccountRef, mandatory: true },
    costCenterId: { edt: CostCenterRef },
    debit: { edt: Edts.Amount, label: "@GL:Debit" },
    credit: { edt: Edts.Amount, label: "@GL:Credit" },
    text: { edt: Edts.Description, label: "@GL:Text" },
  },
  titleField: "text",
  list: ["accountId", "costCenterId", "debit", "credit", "text"],
  form: [{ label: "@SYS:General", fields: ["journalId", "accountId", "costCenterId", "debit", "credit", "text"] }],
});

export default defineModule({
  id: "gl",
  label: "@GL:Module",
  description: "@GL:ModuleDesc",
  icon: "BookNumber",
  dependsOn: ["sys"],
  enums: [AccountType, JournalStatus],
  objects: [account, costCenter, voucher, trans, journal, journalLine],
  menu: [
    {
      label: "@GL:Module",
      items: [{ object: "gl.journal" }, { object: "gl.voucher" }, { object: "gl.trans" }],
    },
    { label: "@SYS:Setup", items: [{ object: "gl.account" }, { object: "gl.costCenter" }] },
  ],
  labels: {
    cs: {
      Module: "Hlavní kniha",
      ModuleDesc: "Účtový rozvrh, střediska, účetní deníky a doklady.",
      Account: "Účet",
      Accounts: "Účtový rozvrh",
      AccountNum: "Číslo účtu",
      AccountNumHelp: "Číslo účtu má 3–10 číslic.",
      AccountType: "Druh účtu",
      Asset: "Aktiva",
      Liability: "Závazky",
      Equity: "Vlastní kapitál",
      Revenue: "Výnosy",
      Expense: "Náklady",
      Blocked: "Blokovaný",
      CostCenter: "Středisko",
      CostCenters: "Střediska",
      Voucher: "Účetní doklad",
      Vouchers: "Účetní doklady",
      Trans: "Účetní zápis",
      Transactions: "Účetní zápisy",
      AmountSigned: "Částka (MD +, D −)",
      Text: "Text",
      SourceObject: "Zdroj",
      SourceId: "Zdrojový záznam",
      Journal: "Účetní deník",
      Journals: "Účetní deníky",
      JournalNum: "Číslo deníku",
      JournalLine: "Řádek deníku",
      Status: "Stav",
      Draft: "Rozpracováno",
      Posted: "Zaúčtováno",
      Post: "Zaúčtovat",
      Debit: "MD",
      Credit: "D",
      NotBalanced: "Doklad není vyrovnaný: MD a D se liší o {diff}.",
      NoLines: "Doklad nemá žádné řádky.",
      LineBothSides: "Řádek {line}: vyplňte jen MD, nebo jen D.",
      AccountBlocked: "Účet {account} je blokovaný.",
      Locked: "Zaúčtovaný doklad nelze měnit.",
    },
    en: {
      Module: "General ledger",
      ModuleDesc: "Chart of accounts, cost centers, journals and vouchers.",
      Account: "Main account",
      Accounts: "Chart of accounts",
      AccountNum: "Account number",
      AccountNumHelp: "Account number has 3–10 digits.",
      AccountType: "Account type",
      Asset: "Assets",
      Liability: "Liabilities",
      Equity: "Equity",
      Revenue: "Revenue",
      Expense: "Expenses",
      Blocked: "Blocked",
      CostCenter: "Cost center",
      CostCenters: "Cost centers",
      Voucher: "Voucher",
      Vouchers: "Vouchers",
      Trans: "Ledger transaction",
      Transactions: "Ledger transactions",
      AmountSigned: "Amount (debit +, credit −)",
      Text: "Text",
      SourceObject: "Source",
      SourceId: "Source record",
      Journal: "General journal",
      Journals: "General journals",
      JournalNum: "Journal number",
      JournalLine: "Journal line",
      Status: "Status",
      Draft: "Draft",
      Posted: "Posted",
      Post: "Post",
      Debit: "Debit",
      Credit: "Credit",
      NotBalanced: "Voucher is not balanced: debit and credit differ by {diff}.",
      NoLines: "Voucher has no lines.",
      LineBothSides: "Line {line}: fill in either debit or credit.",
      AccountBlocked: "Account {account} is blocked.",
      Locked: "A posted journal cannot be changed.",
    },
  },
});
