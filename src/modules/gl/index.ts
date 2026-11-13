/**
 * Hlavní kniha. Každá transakce v systému (faktura, pokladna, majetek…)
 * má svůj obraz v účetním dokladu (gl.voucher) a zápisech (gl.trans).
 * Doklady vznikají výhradně přes postVoucher() — ručně je nelze měnit.
 */
import { Edts, defineEdt, defineEnum, enumEdt, refEdt } from "@/core/edt";
import { defineModule } from "@/core/module";
import { defineObject } from "@/core/object";
import { glSetup } from "./setup";

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

/**
 * Druh účtu (saldokonto a zvláštní účty) — obdoba „posting type“ v D365.
 * Určuje, který modul na účet účtuje; s Zákazem ručního zápisu hlídá,
 * aby se saldo účtu nerozjelo s pomocnou knihou.
 */
export const PostingType = defineEnum({
  id: "AccountPostingType",
  label: "@GL:PostingType",
  values: [
    { value: "customer", label: "@GL:PtCustomer" },
    { value: "vendor", label: "@GL:PtVendor" },
    { value: "bank", label: "@GL:PtBank" },
    { value: "cash", label: "@GL:PtCash" },
    { value: "cashInTransit", label: "@GL:PtCashInTransit" },
    { value: "vat", label: "@GL:PtVat" },
    { value: "employee", label: "@GL:PtEmployee" },
    { value: "fixedAsset", label: "@GL:PtFixedAsset" },
    { value: "inventory", label: "@GL:PtInventory" },
  ],
});

/** Parametry hlavní knihy firmy (obdoba Ledger + General ledger parameters v D365). */
const LedgerRateSource = defineEnum({
  id: "LedgerRateSource",
  label: "@SYS:RateSource",
  values: [
    { value: "cnb", label: "@SYS:RateCnb" },
    { value: "ecb", label: "@SYS:RateEcb" },
  ],
});
export { LedgerRateSource };

export const JournalStatus = defineEnum({
  id: "JournalStatus",
  label: "@GL:Status",
  values: [
    { value: "draft", label: "@GL:Draft" },
    { value: "posted", label: "@GL:Posted" },
  ],
});

export const PeriodStatus = defineEnum({
  id: "PeriodStatus",
  label: "@GL:PeriodStatus",
  values: [
    { value: "open", label: "@GL:Open" },
    { value: "onHold", label: "@GL:OnHold" },
    { value: "closed", label: "@GL:Closed" },
  ],
});

export const AccountNum = defineEdt({
  id: "AccountNum",
  kind: "string",
  label: "@GL:AccountNum",
  maxLength: 6,
  // 6 číslic: 3 syntetika + 3 analytika; zadání 3 číslic se doplní nulami
  pattern: /^\d{3}(\d{3})?$/,
  patternMessage: "@GL:AccountNumHelp6",
});
export const VoucherNum = defineEdt({ id: "VoucherNum", kind: "string", label: "@GL:Voucher", maxLength: 30 });
const AccountRef = refEdt("gl.account", "@GL:Account");
const CostCenterRef = refEdt("gl.costCenter", "@GL:CostCenter");
const VoucherRef = refEdt("gl.voucher", "@GL:Voucher");
const JournalRef = refEdt("gl.journal", "@GL:Journal");
const JournalNameRef = refEdt("gl.journalName", "@GL:JournalName");
const NumberSeqRef = refEdt("sys.numberSeq", "@SYS:NumberSeq");
const CurrencyRef = refEdt("sys.currency", "@SYS:Currency");
const FiscalYearRef = refEdt("gl.fiscalYear", "@GL:FiscalYear");

/** Fiskální rok (obdoba Fiscal calendar v D365) — období jsou jeho řádky. */
export const fiscalYear = defineObject({
  id: "gl.fiscalYear",
  table: "gl_fiscal_year",
  label: "@GL:FiscalYear",
  labelPlural: "@GL:FiscalYears",
  scope: "company",
  fields: {
    code: { edt: Edts.Code, mandatory: true },
    startDate: { edt: Edts.TransDate, label: "@GL:StartDate", mandatory: true },
    endDate: { edt: Edts.TransDate, label: "@GL:EndDate", mandatory: true },
  },
  titleField: "code",
  list: ["code", "startDate", "endDate"],
  form: [{ label: "@SYS:General", fields: ["code", "startDate", "endDate"] }],
  unique: [["code"]],
  defaultSort: { field: "startDate", dir: "desc" },
  lines: [{ object: "gl.period", field: "fiscalYearId", label: "@GL:Periods" }],
  actions: [{ id: "periods", label: "@GL:CreatePeriods" }],
});

/** Účetní období: do uzavřeného ani pozastaveného se neúčtuje. */
export const period = defineObject({
  id: "gl.period",
  table: "gl_period",
  label: "@GL:Period",
  labelPlural: "@GL:Periods",
  scope: "company",
  fields: {
    fiscalYearId: { edt: FiscalYearRef, mandatory: true },
    code: { edt: Edts.Code, mandatory: true },
    startDate: { edt: Edts.TransDate, label: "@GL:StartDate", mandatory: true },
    endDate: { edt: Edts.TransDate, label: "@GL:EndDate", mandatory: true },
    status: { edt: enumEdt(PeriodStatus), mandatory: true, default: "open" },
  },
  titleField: "code",
  list: ["fiscalYearId", "code", "startDate", "endDate", "status"],
  form: [{ label: "@SYS:General", fields: ["fiscalYearId", "code", "startDate", "endDate", "status"] }],
  unique: [["code"]],
  defaultSort: { field: "startDate", dir: "asc" },
});

const AccRef = (label: string) => refEdt("gl.account", label);

export const parameters = defineObject({
  id: "gl.parameters",
  table: "gl_parameters",
  label: "@GL:Parameters",
  labelPlural: "@GL:Parameters",
  scope: "company",
  fields: {
    accountingCurrencyId: { edt: refEdt("sys.currency", "@GL:AccountingCurrency"), mandatory: true },
    reportingCurrencyId: { edt: refEdt("sys.currency", "@GL:ReportingCurrency") },
    rateSource: { edt: enumEdt(LedgerRateSource), mandatory: true, default: "cnb" },
    rateMaxAgeDays: { edt: Edts.Int, label: "@GL:RateMaxAge", mandatory: true, default: 7 },
    realizedGainAccountId: { edt: AccRef("@GL:RealizedGain") },
    realizedLossAccountId: { edt: AccRef("@GL:RealizedLoss") },
    roundingGainAccountId: { edt: AccRef("@GL:RoundingGain") },
    roundingLossAccountId: { edt: AccRef("@GL:RoundingLoss") },
    profitLossAccountId: { edt: AccRef("@GL:ProfitLoss") },
    retainedEarningsAccountId: { edt: AccRef("@GL:RetainedEarnings") },
    openingAccountId: { edt: AccRef("@GL:OpeningAccount") },
    closingAccountId: { edt: AccRef("@GL:ClosingAccount") },
  },
  titleField: "accountingCurrencyId",
  list: ["accountingCurrencyId", "reportingCurrencyId", "rateSource", "rateMaxAgeDays"],
  form: [
    { label: "@GL:Currencies", fields: ["accountingCurrencyId", "reportingCurrencyId", "rateSource", "rateMaxAgeDays"] },
    { label: "@GL:ExchangeDiffs", fields: ["realizedGainAccountId", "realizedLossAccountId", "roundingGainAccountId", "roundingLossAccountId"] },
    { label: "@GL:YearEnd", fields: ["profitLossAccountId", "retainedEarningsAccountId", "openingAccountId", "closingAccountId"] },
  ],
});

export const account = defineObject({
  id: "gl.account",
  table: "gl_account",
  label: "@GL:Account",
  labelPlural: "@GL:Accounts",
  scope: "company",
  fields: {
    accountNum: { edt: AccountNum, mandatory: true },
    name: { edt: Edts.Name, mandatory: true },
    /** prázdné = podle třídy (5 náklady, 6 výnosy) nebo podle syntetického účtu */
    type: { edt: enumEdt(AccountType) },
    /** první 3 číslice — pro výkazy a přehledy podle syntetických účtů */
    synthetic: { edt: defineEdt({ id: "SyntheticAccount", kind: "string", label: "@GL:SyntheticAccount", maxLength: 3 }), readOnly: true },
    accountClass: { edt: Edts.Int, label: "@GL:AccountClass", readOnly: true },
    postingType: { edt: enumEdt(PostingType) },
    noManualEntry: { edt: Edts.NoYes, label: "@GL:NoManualEntry" },
    blocked: { edt: Edts.NoYes, label: "@GL:Blocked" },
  },
  titleField: "accountNum",
  list: ["accountNum", "name", "type", "postingType", "noManualEntry", "blocked"],
  form: [
    { label: "@SYS:General", fields: ["accountNum", "name", "type", "synthetic", "accountClass", "blocked"] },
    { label: "@GL:Control", fields: ["postingType", "noManualEntry"] },
  ],
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
  numberSeq: { field: "voucherNum", seq: "GLVOUCHER" },
  defaultSort: { field: "date", dir: "desc" },
  lines: [{ object: "gl.trans", field: "voucherId", label: "@GL:Transactions" }],
});

/** Nastavení deníku (obdoba Journal names v AX): řada dokladů, protiúčet. */
export const journalName = defineObject({
  id: "gl.journalName",
  table: "gl_journal_name",
  label: "@GL:JournalName",
  labelPlural: "@GL:JournalNames",
  scope: "company",
  fields: {
    code: { edt: Edts.Code, mandatory: true },
    name: { edt: Edts.Name, mandatory: true },
    voucherSeqId: { edt: NumberSeqRef, label: "@GL:VoucherSeq" },
    offsetAccountId: { edt: AccountRef, label: "@GL:OffsetAccount" },
    blocked: { edt: Edts.NoYes, label: "@GL:Blocked" },
  },
  titleField: "code",
  list: ["code", "name", "voucherSeqId", "offsetAccountId", "blocked"],
  form: [
    { label: "@SYS:General", fields: ["code", "name", "blocked"] },
    { label: "@GL:Posting", fields: ["voucherSeqId", "offsetAccountId"] },
  ],
  unique: [["code"]],
  defaultSort: { field: "code", dir: "asc" },
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
    currencyId: { edt: CurrencyRef },
    amountCur: { edt: Edts.AmountCur, label: "@GL:AmountCur" },
    text: { edt: Edts.Description, label: "@GL:Text" },
  },
  titleField: "text",
  list: ["date", "voucherId", "accountId", "costCenterId", "amount", "currencyId", "amountCur", "text"],
  form: [
    { label: "@SYS:General", fields: ["voucherId", "date", "accountId", "costCenterId", "amount", "text"] },
    { label: "@SYS:Currency", fields: ["currencyId", "amountCur"] },
  ],
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
    /** prázdné = výchozí název deníku (GEN, jinak první) — doplní se při uložení */
    journalNameId: { edt: JournalNameRef },
    date: { edt: Edts.TransDate, mandatory: true },
    description: { edt: Edts.Description, mandatory: true },
    status: { edt: enumEdt(JournalStatus), mandatory: true, default: "draft", readOnly: true },
    voucherId: { edt: VoucherRef, readOnly: true },
  },
  titleField: "journalNum",
  list: ["journalNum", "journalNameId", "date", "description", "status", "voucherId"],
  form: [
    { label: "@SYS:General", fields: ["journalNum", "journalNameId", "date", "description"] },
    { label: "@GL:Status", fields: ["status", "voucherId"] },
  ],
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
    /** prázdné = účetní měna firmy */
    currencyId: { edt: CurrencyRef },
    debit: { edt: Edts.Amount, label: "@GL:Debit" },
    credit: { edt: Edts.Amount, label: "@GL:Credit" },
    text: { edt: Edts.Description, label: "@GL:Text" },
  },
  titleField: "text",
  list: ["accountId", "costCenterId", "currencyId", "debit", "credit", "text"],
  form: [{ label: "@SYS:General", fields: ["journalId", "accountId", "costCenterId", "currencyId", "debit", "credit", "text"] }],
});

export default defineModule({
  id: "gl",
  label: "@GL:Module",
  description: "@GL:ModuleDesc",
  icon: "BookNumber",
  dependsOn: ["sys"],
  enums: [LedgerRateSource, PostingType, AccountType, JournalStatus, PeriodStatus],
  objects: [parameters, account, costCenter, fiscalYear, period, voucher, trans, journalName, journal, journalLine],
  menu: [
    {
      label: "@GL:Module",
      items: [{ object: "gl.journal" }, { object: "gl.voucher" }, { object: "gl.trans" }],
    },
    {
      label: "@SYS:Setup",
      items: [{ object: "gl.parameters" }, { object: "gl.account" }, { object: "gl.costCenter" }, { object: "gl.journalName" }, { object: "gl.fiscalYear" }],
    },
  ],
  numberSeqs: [
    { code: "GLJOURNAL", name: "@GL:Journals", format: "DEN{YY}-{#####}", usedFor: "gl.journal" },
    { code: "GLVOUCHER", name: "@GL:Vouchers", format: "UD{YY}-{######}", usedFor: "gl.voucher" },
  ],
  setup: glSetup,
  labels: {
    cs: {
      Module: "Hlavní kniha",
      ModuleDesc: "Účtový rozvrh, střediska, účetní deníky a doklady.",
      Account: "Účet",
      Accounts: "Účtový rozvrh",
      AccountNum: "Číslo účtu",
      AccountNumHelp: "Číslo účtu má 3–10 číslic.",
      SyntheticAccount: "Syntetický účet",
      Parameters: "Parametry hlavní knihy",
      AccountingCurrency: "Účetní měna",
      ReportingCurrency: "Vykazovací měna",
      RateMaxAge: "Nejstarší použitelný kurz (dní)",
      Currencies: "Měny a kurzy",
      ExchangeDiffs: "Kurzové rozdíly a zaokrouhlení",
      RealizedGain: "Kurzové zisky",
      RealizedLoss: "Kurzové ztráty",
      RoundingGain: "Zaokrouhlení – výnos",
      RoundingLoss: "Zaokrouhlení – náklad",
      YearEnd: "Uzávěrka roku",
      ProfitLoss: "Výsledek hospodaření",
      RetainedEarnings: "Nerozdělený zisk / neuhrazená ztráta",
      OpeningAccount: "Počáteční účet rozvažný",
      ClosingAccount: "Konečný účet rozvažný",
      OneParameters: "Firma už parametry hlavní knihy má.",
      CurrencyLocked: "Účetní měnu nelze změnit — firma už má účetní zápisy.",
      AccountNumHelp6: "Číslo účtu má 6 číslic (3 syntetika + 3 analytika); 211 se doplní na 211000.",
      AccountClass: "Účtová třída",
      PostingType: "Druh účtu",
      PtCustomer: "Odběratelé (saldokonto)",
      PtVendor: "Dodavatelé (saldokonto)",
      PtBank: "Banka",
      PtCash: "Pokladna",
      PtCashInTransit: "Peníze na cestě",
      PtVat: "DPH",
      PtEmployee: "Zaměstnanci",
      PtFixedAsset: "Dlouhodobý majetek",
      PtInventory: "Zásoby",
      NoManualEntry: "Zakázat ruční zápis",
      Control: "Řízení účtu",
      ManualEntryDenied: "Na účet {account} nelze účtovat ručně — účtují na něj doklady modulu (faktury, banka, pokladna).",
      AccountType: "Typ účtu",
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
      JournalName: "Název deníku",
      JournalNames: "Názvy deníků",
      VoucherSeq: "Řada účetních dokladů",
      OffsetAccount: "Protiúčet",
      Posting: "Účtování",
      JournalNameBlocked: "Název deníku {name} je blokovaný.",
      MissingJournalName: "Chybí název deníku. Založte ho v Nastavení → Názvy deníků.",
      GeneralJournal: "Obecný deník",
      FiscalYear: "Fiskální rok",
      FiscalYears: "Fiskální roky",
      Period: "Účetní období",
      Periods: "Účetní období",
      PeriodStatus: "Stav období",
      Open: "Otevřené",
      OnHold: "Pozastavené",
      Closed: "Uzavřené",
      StartDate: "Od",
      EndDate: "Do",
      CreatePeriods: "Vytvořit měsíční období",
      NoPeriod: "Pro datum {date} neexistuje účetní období. Založte fiskální rok v Nastavení → Fiskální roky.",
      PeriodClosed: "Období {period} není otevřené, do něj nelze účtovat.",
      PeriodsExist: "Fiskální rok už období má.",
      AmountCur: "Částka v měně",
    },
    en: {
      Module: "General ledger",
      ModuleDesc: "Chart of accounts, cost centers, journals and vouchers.",
      Account: "Main account",
      Accounts: "Chart of accounts",
      AccountNum: "Account number",
      AccountNumHelp: "Account number has 3–10 digits.",
      SyntheticAccount: "Synthetic account",
      Parameters: "General ledger parameters",
      AccountingCurrency: "Accounting currency",
      ReportingCurrency: "Reporting currency",
      RateMaxAge: "Oldest usable rate (days)",
      Currencies: "Currencies and rates",
      ExchangeDiffs: "Exchange differences and rounding",
      RealizedGain: "Realized exchange gain",
      RealizedLoss: "Realized exchange loss",
      RoundingGain: "Rounding – gain",
      RoundingLoss: "Rounding – loss",
      YearEnd: "Year end",
      ProfitLoss: "Profit and loss",
      RetainedEarnings: "Retained earnings",
      OpeningAccount: "Opening balance account",
      ClosingAccount: "Closing balance account",
      OneParameters: "The company already has general ledger parameters.",
      CurrencyLocked: "The accounting currency cannot change — the company already has postings.",
      AccountNumHelp6: "The account number has 6 digits (3 synthetic + 3 analytic); 211 becomes 211000.",
      AccountClass: "Account class",
      PostingType: "Posting type",
      PtCustomer: "Customers (control account)",
      PtVendor: "Vendors (control account)",
      PtBank: "Bank",
      PtCash: "Cash",
      PtCashInTransit: "Cash in transit",
      PtVat: "VAT",
      PtEmployee: "Employees",
      PtFixedAsset: "Fixed assets",
      PtInventory: "Inventory",
      NoManualEntry: "Do not allow manual entry",
      Control: "Account control",
      ManualEntryDenied: "Account {account} does not allow manual entry — module documents post to it (invoices, bank, cash).",
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
      JournalName: "Journal name",
      JournalNames: "Journal names",
      VoucherSeq: "Voucher number sequence",
      OffsetAccount: "Offset account",
      Posting: "Posting",
      JournalNameBlocked: "Journal name {name} is blocked.",
      MissingJournalName: "Journal name is missing. Create it in Setup → Journal names.",
      GeneralJournal: "General journal",
      FiscalYear: "Fiscal year",
      FiscalYears: "Fiscal years",
      Period: "Ledger period",
      Periods: "Ledger periods",
      PeriodStatus: "Period status",
      Open: "Open",
      OnHold: "On hold",
      Closed: "Closed",
      StartDate: "From",
      EndDate: "To",
      CreatePeriods: "Create monthly periods",
      NoPeriod: "No ledger period exists for {date}. Create a fiscal year in Setup → Fiscal years.",
      PeriodClosed: "Period {period} is not open; posting is not allowed.",
      PeriodsExist: "The fiscal year already has periods.",
      AmountCur: "Amount in currency",
    },
  },
});
