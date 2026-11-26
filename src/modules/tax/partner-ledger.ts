/**
 * Továrna na pomocnou knihu partnerů (odběratelé AR, dodavatelé AP).
 * Obě knihy mají stejnou stavbu — skupina (účtovací profil), partner,
 * faktura s řádky a otevřené položky; liší se jen názvy, účty a stranou
 * účtování. Modul dodá parametry a labely, objekty a logika jsou společné.
 */
import { Edts, defineEdt, defineEnum, enumEdt, refEdt } from "@/core/edt";
import { UserError, type DataApi, type EventContext, type ObjectHandlers, type RecordData } from "@/core/module";
import { defineObject, type ObjectDef } from "@/core/object";
import { DIM_NAMES, DupCheck, JournalStatus, dimFields } from "@/modules/gl";
import { documentLineHandlers, invoiceHandlers, type InvoiceConfig } from "./document";
import { orderHandlers, releaseOrder, vatPayer } from "./orders";
import { AgreementLineStatus, AgreementMode, AgreementStatus, agreementDeleteHooks, agreementHandlers, agreementLineObject, agreementObject, agreementParamFields, invoiceScheduleLine, runAgreements, type AgreementDocs } from "./agreements";
import { postingAccount } from "@/modules/gl/setup";
import { fillFromAres } from "@/modules/gab/ares";
import { createFromRegistry } from "@/modules/gab/registry-lookup";

/** Variabilní symbol — jen číslice, do 10 znaků (jako v příkazu k úhradě). */
export const Vs = defineEdt({ id: "Vs", kind: "string", label: "@TAX:Vs", maxLength: 10, pattern: /^\d{1,10}$/, patternMessage: "@TAX:VsHelp" });

/** Druh otevřené položky. */
export const TransKind = defineEnum({
  id: "PartnerTransKind",
  label: "@TAX:TransKind",
  values: [
    { value: "invoice", label: "@TAX:KindInvoice" },
    { value: "payment", label: "@TAX:KindPayment" },
    { value: "advance", label: "@TAX:KindAdvance" },
  ],
});

export const OrderStatus = defineEnum({
  id: "OrderStatus",
  label: "@TAX:OrderStatus",
  values: [
    { value: "open", label: "@TAX:OrderOpen", color: "warning" },
    { value: "confirmed", label: "@TAX:OrderConfirmed", color: "brand" },
    { value: "invoiced", label: "@TAX:OrderInvoiced", color: "success" },
    { value: "cancelled", label: "@TAX:OrderCancelled", color: "danger" },
  ],
});

export const AdvanceStatus = defineEnum({
  id: "AdvanceStatus",
  label: "@TAX:AdvanceStatus",
  values: [
    { value: "open", label: "@TAX:AdvanceOpen", color: "warning" },
    { value: "paid", label: "@TAX:AdvancePaid", color: "brand" },
    { value: "settled", label: "@TAX:AdvanceSettled", color: "success" },
    { value: "cancelled", label: "@TAX:OrderCancelled", color: "danger" },
  ],
});

/** Typ přijatého dokladu: faktura, účtenka (zjednodušený daňový doklad), dar (bez DPH, účet darů). */
/** Úhrada přijatého dokladu: k zaplacení, už zaplaceno (karta, hotově — mimo platební příkaz), placeno zaměstnancem. */
export const ApPaymentState = defineEnum({
  id: "ApPaymentState",
  label: "@TAX:PaymentState",
  values: [
    { value: "toPay", label: "@TAX:PayToPay" },
    { value: "paid", label: "@TAX:PayPaid", color: "success" },
    { value: "employee", label: "@TAX:PayEmployee", color: "brand" },
  ],
});

export const InvoiceDocType = defineEnum({
  id: "InvoiceDocType",
  label: "@TAX:DocType",
  values: [
    { value: "invoice", label: "@TAX:DocTypeInvoice" },
    { value: "receipt", label: "@TAX:Receipt" },
    { value: "donation", label: "@TAX:DocTypeDonation", color: "brand" },
  ],
});

/** Pro koho platí řádek účtovacího profilu (jako Account code v AX: tabulka / skupina / vše). */
export const ProfileAccountCode = defineEnum({
  id: "ProfileAccountCode",
  label: "@TAX:ProfileAccountCode",
  values: [
    { value: "partner", label: "@TAX:ProfileForPartner" },
    { value: "group", label: "@TAX:ProfileForGroup" },
    { value: "all", label: "@TAX:ProfileForAll" },
  ],
});

export interface PartnerLedgerSpec {
  /** id modulu, např. "ar" */
  module: string;
  /** prefix labelů modulu, např. "AR" */
  L: string;
  /** názvy objektů a polí */
  partner: string; // "customer"
  summaryField: string; // "receivableAccountId"
  lineAccountField: string; // "revenueAccountId"
  side: 1 | -1;
  /** číselné řady (výchozí kódy) */
  partnerSeq: string;
  invoiceSeq: string;
  orderSeq: string;
  advanceSeq: string;
  /** smlouvy (předplatné na období) */
  agreementSeq: string;
  /** účet záloh (přijaté 324 / poskytnuté 314) — výchozí syntetika */
  advanceAccount: string;
  /** u přijatých faktur číslo dokladu dodavatele */
  externalNum?: boolean;
  /**
   * výchozí účtovací profily (zakládají se jen chybějící kódy): účet = syntetika („321“ → 321000)
   * nebo celé číslo účtu; bez účtu = profil bez řádků (účet ze skupiny partnera)
   */
  profiles?: { code: string; name: string; account?: string }[];
  /** kód výchozího profilu faktur, profilu darů a profilu finančního úřadu (Daňové parametry → dodavatel FÚ) */
  defaultProfile?: string;
  donationProfile?: string;
  taxOfficeProfile?: string;
}

export function partnerLedger(sp: PartnerLedgerSpec) {
  const m = sp.module;
  const L = (k: string) => `@${sp.L}:${k}`;
  const id = (o: string) => `${m}.${o}`;
  const partnerId = `${sp.partner}Id`;
  const AccountRef = (label: string) => refEdt("gl.account", label);

  const group = defineObject({
    id: id("group"),
    table: `${m}_group`,
    label: L("Group"),
    labelPlural: L("Groups"),
    scope: "company",
    shareable: true,
    fields: {
      code: { edt: Edts.Code, mandatory: true },
      name: { edt: Edts.Name, mandatory: true },
      [sp.summaryField]: { edt: AccountRef(L("SummaryAccount")), mandatory: true },
      [sp.lineAccountField]: { edt: AccountRef(L("LineAccount")) },
      /** skupina DPH partnerů skupiny (tuzemsko, EU…) — s položkou DPH dá daňový kód */
      taxGroupId: { edt: refEdt("tax.taxGroup", "@TAX:TaxGroup") },
      taxCodeId: { edt: refEdt("tax.taxCode", "@TAX:TaxCode") },
      /** prázdné = první účet syntetiky záloh (324 / 314) */
      advanceAccountId: { edt: AccountRef(L("AdvanceAccount")) },
      /** prázdné = doklady splatné ihned (0 dní) */
      paymentTermId: { edt: refEdt("tax.paymentTerm", "@TAX:PaymentTerm") },
    },
    titleField: "code",
    list: ["code", "name", sp.summaryField, sp.lineAccountField, "taxGroupId", "taxCodeId", "paymentTermId"],
    form: [
      { label: "@SYS:General", fields: ["code", "name", "paymentTermId"] },
      { label: "@GL:Posting", fields: [sp.summaryField, sp.lineAccountField, "taxGroupId", "taxCodeId", "advanceAccountId"] },
    ],
    unique: [["code"]],
    defaultSort: { field: "code", dir: "asc" },
  });

  // parametry odběratelů / dodavatelů (jeden záznam za firmu)
  const params = defineObject({
    id: id("parameters"),
    datTemplate: true,
    table: `${m}_parameters`,
    label: L("Parameters"),
    labelPlural: L("Parameters"),
    scope: "company",
    fields: {
      /** číslo faktury (dodavatele / naše), které už existuje: přijmout / varovat / odmítnout / odmítnout ve stejném roce */
      invoiceNumCheck: { edt: enumEdt(DupCheck), label: L("InvoiceNumCheck"), mandatory: true, default: "reject" },
      /** výchozí účtovací profil faktur (prázdné = účet ze skupiny partnera) */
      postingProfileId: { edt: refEdt(id("postingProfile"), "@TAX:PostingProfileDefault") },
      ...(sp.side === -1 ? { donationProfileId: { edt: refEdt(id("postingProfile"), "@TAX:PostingProfileDonation") } } : {}),
      ...agreementParamFields,
    },
    titleField: "invoiceNumCheck",
    list: ["invoiceNumCheck", "postingProfileId"],
    form: [
      { label: "@GL:Checks", fields: ["invoiceNumCheck"] },
      { label: "@GL:Posting", fields: ["postingProfileId", ...(sp.side === -1 ? ["donationProfileId"] : [])] },
      { label: L("Agreements"), fields: Object.keys(agreementParamFields) },
    ],
  });

  // účtovací profil (Posting profile v AX): účet salda podle partnera / skupiny / všech;
  // faktura si profil vybere (výchozí z parametrů, dar z profilu darů), bez profilu platí účet skupiny
  const profile = defineObject({
    id: id("postingProfile"),
    table: `${m}_posting_profile`,
    label: "@TAX:PostingProfile",
    labelPlural: "@TAX:PostingProfiles",
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
    lines: [{ object: id("postingProfileLine"), field: "profileId", label: "@TAX:Lines" }],
  });

  const profileLine = defineObject({
    id: id("postingProfileLine"),
    table: `${m}_posting_profile_line`,
    label: "@TAX:PostingProfileLine",
    labelPlural: "@TAX:PostingProfileLines",
    scope: "company",
    fields: {
      profileId: { edt: refEdt(id("postingProfile"), "@TAX:PostingProfile"), mandatory: true },
      accountCode: { edt: enumEdt(ProfileAccountCode), mandatory: true, default: "all" },
      [partnerId]: { edt: refEdt(id(sp.partner), L("Partner")) },
      groupId: { edt: refEdt(id("group"), L("Group")) },
      summaryAccountId: { edt: AccountRef(L("SummaryAccount")), mandatory: true },
    },
    titleField: "accountCode",
    list: ["accountCode", partnerId, "groupId", "summaryAccountId"],
    form: [{ label: "@SYS:General", fields: ["profileId", "accountCode", partnerId, "groupId", "summaryAccountId"] }],
  });

  const partner = defineObject({
    id: id(sp.partner),
    table: `${m}_${sp.partner}`,
    label: L("Partner"),
    labelPlural: L("Partners"),
    scope: "company",
    shareable: true,
    fields: {
      accountNum: { edt: Edts.Code, label: L("AccountNum"), mandatory: true, readOnly: true },
      // subjekt povinný (hlídá událost): bez něj se založí z registru podle IČO (import dodavatelů)
      subjectId: { edt: refEdt("gab.subject", "@GAB:Subject") },
      /** IČO subjektu (kopie pro hledání a import: jen IČO → subjekt z ARES) */
      regNo: { edt: Edts.RegNo, aliases: ["ičo", "ico", "ic", "identifikační číslo"] },
      // výchozí dimenze dokladů partnera (z adresáře se doplní samy)
      ...dimFields(),
      // prázdná skupina = první skupina partnerů (hlídá událost)
      groupId: { edt: refEdt(id("group"), L("Group")) },
      /** prázdné = skupina DPH ze skupiny partnerů */
      taxGroupId: { edt: refEdt("tax.taxGroup", "@TAX:TaxGroup") },
      currencyId: { edt: refEdt("sys.currency", "@SYS:Currency") },
      /** prázdné = splatnost ze skupiny partnerů, jinak ihned */
      paymentTermId: { edt: refEdt("tax.paymentTerm", "@TAX:PaymentTerm"), help: "@TAX:PaymentTermHelp", aliases: ["splatnost (dní)", "splatnost", "payment terms", "paymentdays"] },
      /** výchozí účet pro platby (z bankovních účtů subjektu) */
      bankAccountId: { edt: refEdt("gab.bankAccount", "@GAB:BankAccount") },
      paymentMethodId: { edt: refEdt("bank.paymentMethod", "@TAX:PaymentMethod"), optionalRef: true },
      /** výchozí účtovací profil dokladů partnera (prázdné = z parametrů) */
      postingProfileId: { edt: refEdt(id("postingProfile"), "@TAX:PostingProfile") },
      /** kam posílat doklady e-mailem (prázdné = e-mail subjektu v adresáři) */
      docEmail: { edt: Edts.Email, label: "@TAX:DocEmail" },
      blocked: { edt: Edts.NoYes, label: "@GL:Blocked" },
    },
    titleField: "accountNum",
    list: ["accountNum", "subjectId", "regNo", "groupId", "currencyId", "paymentTermId", "blocked"],
    form: [
      { label: "@SYS:General", fields: ["accountNum", "subjectId", "regNo", "groupId", "taxGroupId", "postingProfileId", "blocked"] },
      { label: L("Terms"), fields: ["currencyId", "paymentTermId", "paymentMethodId", "bankAccountId", "docEmail"] },
      { label: "@GL:DefaultDims", fields: ["dim1", "dim2", "dim3", "dim4", "dim5", "dim6"] },
    ],
    // import: podle čísla, subjektu, nebo jen podle IČO (opakovaný import partnera nezdvojí)
    unique: [["accountNum"], ["subjectId"], ["regNo"]],
    numberSeq: { field: "accountNum", seq: sp.partnerSeq },
    // v odkazech a výběru „číslo · název subjektu“, hledání i podle názvu
    titleRef: "subjectId",
    defaultSort: { field: "accountNum", dir: "asc" },
    actions: [{ id: "ares", label: "@GAB:FromAres" }],
    lines: [
      // kontakty a adresy subjektu adresáře přímo na kartě partnera (jako v AX)
      { object: "gab.contact", field: "subjectId", label: "@GAB:Contacts", owned: false, via: "subjectId" },
      { object: "gab.address", field: "subjectId", label: "@GAB:Addresses", owned: false, via: "subjectId" },
      { object: id("trans"), field: partnerId, label: L("TransPlural"), owned: false },
      { object: id("order"), field: partnerId, label: L("Orders"), owned: false },
      { object: id("invoice"), field: partnerId, label: L("Invoices"), owned: false },
      { object: id("advance"), field: partnerId, label: L("Advances"), owned: false },
    ],
  });

  const invoiceFields: ObjectDef["fields"] = {
    // vydaná: číslo jde přepsat (koncept; navazuje na jiný systém), přijatá: interní číslo z řady
    invoiceNum: { edt: Edts.Code, label: "@TAX:InvoiceNum", mandatory: true, readOnly: sp.side !== 1 },
    // povinné až při zaúčtování (faktura z objednávky ho ještě nezná)
    ...(sp.externalNum ? { externalNum: { edt: Edts.Code, label: L("ExternalNum") } } : {}),
    // přijatá: účtenka = zjednodušený daňový doklad (KH souhrnně, číslo dodavatele nepovinné),
    // dar = bez DPH, náklad 543, závazek podle profilu darů (379)
    ...(sp.side === -1 ? { docType: { edt: enumEdt(InvoiceDocType), mandatory: true, default: "invoice" }, paymentState: { edt: enumEdt(ApPaymentState), mandatory: true, default: "toPay" } } : {}),
    /** účet závazků / pohledávek dokladu (prázdné = účet ze skupiny partnera) */
    postingProfileId: { edt: refEdt(id("postingProfile"), "@TAX:PostingProfile") },
    // vydaná: jednotkové ceny řádků včetně DPH (e-shop, maloobchod) — daň se počítá z ceny s DPH jako v pokladně
    ...(sp.side === 1 ? { pricesInclTax: { edt: Edts.NoYes, label: "@TAX:PricesInclTax" } } : {}),
    [partnerId]: { edt: refEdt(id(sp.partner), L("Partner")), mandatory: true },
    invoiceDate: { edt: Edts.TransDate, label: "@TAX:InvoiceDate", mandatory: true, default: "$today" },
    taxDate: { edt: Edts.TransDate, label: "@TAX:TaxDate" },
    dueDate: { edt: Edts.TransDate, label: "@TAX:DueDate" },
    currencyId: { edt: refEdt("sys.currency", "@SYS:Currency") },
    /** z partnera; nové řádky ji převezmou */
    taxGroupId: { edt: refEdt("tax.taxGroup", "@TAX:TaxGroup") },
    /** prázdné = číslice z čísla faktury (u přijaté z čísla dodavatele) */
    vs: { edt: Vs },
    description: { edt: Edts.Description },
    amountNet: { edt: Edts.Amount, label: "@TAX:AmountNet", readOnly: true },
    taxAmount: { edt: Edts.Amount, label: "@TAX:TaxAmount", readOnly: true },
    /** zaokrouhlení celkové částky podle měny (Zaokrouhlení faktur), mimo základ DPH */
    roundingAmount: { edt: Edts.Amount, label: "@TAX:Rounding", readOnly: sp.side !== 1 },
    // vydaná: náš účet pro platbu (výchozí účet měny faktury) a způsob úhrady (z odběratele) → tisk
    ...(sp.side === 1
      ? {
          bankAccountId: { edt: refEdt("bank.account", "@TAX:OurBankAccount"), optionalRef: true },
          paymentMethodId: { edt: refEdt("bank.paymentMethod", "@TAX:PaymentMethod"), optionalRef: true },
        }
      : {}),
    amountGross: { edt: Edts.Amount, label: "@TAX:AmountGross", readOnly: true },
    paidAmount: { edt: Edts.Amount, label: "@TAX:PaidAmount", readOnly: true },
    status: { edt: enumEdt(JournalStatus), mandatory: true, default: "draft", readOnly: true },
    voucherId: { edt: refEdt("gl.voucher", "@GL:Voucher"), readOnly: true },
    orderId: { edt: refEdt(id("order"), L("Order")), readOnly: true },
    agreementId: { edt: refEdt(id("agreement"), L("Agreement")), readOnly: true },
    /** uhrazená záloha partnera — odečte se při zaúčtování */
    advanceId: { edt: refEdt(id("advance"), L("Advance")) },
    advanceAmount: { edt: Edts.Amount, label: "@TAX:AdvanceDeducted", readOnly: true },
    emailedAt: { edt: Edts.DateTime, label: "@TAX:EmailedAt", readOnly: true },
    emailedTo: { edt: Edts.Description, label: "@TAX:EmailedTo", readOnly: true },
  };
  const headerFields = ["invoiceNum", ...(sp.externalNum ? ["externalNum"] : []), ...(sp.side === -1 ? ["docType", "paymentState"] : []), partnerId, "taxGroupId", "postingProfileId", ...(sp.side === 1 ? ["pricesInclTax"] : []), "description", "orderId", "advanceId", "agreementId"];
  const invoice = defineObject({
    id: id("invoice"),
    table: `${m}_invoice`,
    label: L("Invoice"),
    labelPlural: L("Invoices"),
    scope: "company",
    fields: invoiceFields,
    titleField: "invoiceNum",
    list: ["invoiceNum", ...(sp.externalNum ? ["externalNum"] : []), ...(sp.side === -1 ? ["docType", "paymentState"] : []), partnerId, "invoiceDate", "dueDate", "vs", "currencyId", "amountNet", "taxAmount", "amountGross", "paidAmount", "status"],
    form: [
      { label: "@TAX:Header", fields: headerFields },
      { label: "@TAX:Dates", fields: ["invoiceDate", "taxDate", "dueDate", "currencyId", "vs", ...(sp.side === 1 ? ["bankAccountId", "paymentMethodId"] : [])] },
      { label: "@TAX:Amounts", fields: ["amountNet", "taxAmount", "roundingAmount", "amountGross", "advanceAmount", "paidAmount", "status", "voucherId", ...(sp.side === 1 ? ["emailedAt", "emailedTo"] : [])] },
    ],
    numberSeq: { field: "invoiceNum", seq: sp.invoiceSeq },
    defaultSort: { field: "invoiceDate", dir: "desc" },
    related: [{ object: "gl.trans", field: "voucherId", label: "@GL:VoucherLines", ref: "voucherId" }, { object: "tax.trans", field: "voucherId", label: "@TAX:VatShort", ref: "voucherId" }],
    lines: [{ object: id("invoiceLine"), field: "invoiceId", label: "@TAX:Lines" }],
    actions: [
      // hromadně ze seznamu (vybrané faktury, každá zvlášť)
      { id: "post", label: "@GL:Post", when: { field: "status", equals: "draft" }, bulk: true },
      // úhrada z nezaúčtovaného řádku deníku (výpis) – vyrovná se zaúčtováním deníku
      { id: "markSettle", label: "@GL:MarkSettle", dialog: "markSettle", when: { field: "status", equals: "posted" }, group: "process" as const },
      { id: "unpost", label: "@TAX:Unpost", when: { field: "status", equals: "posted" }, adminOnly: true, group: "more" as const, confirm: { field: "invoiceNum", text: "@TAX:UnpostConfirm" } },
      ...(sp.side === 1
        ? [
            { id: "isdoc", label: "@TAX:Isdoc", download: true, bulk: true, module: "prt", group: "print" as const },
            { id: "email", label: "@INT:SendByEmail", outside: true, module: "int", when: { field: "status", equals: "posted" }, group: "print" as const },
          ]
        : []),
    ],
    lockedWhen: { field: "status", equals: "posted" },
    postingPreview: "post",
  });

  const invoiceLine = defineObject({
    id: id("invoiceLine"),
    table: `${m}_invoice_line`,
    label: "@TAX:Line",
    labelPlural: "@TAX:Lines",
    scope: "company",
    fields: {
      invoiceId: { edt: refEdt(id("invoice"), L("Invoice")), mandatory: true },
      /** položka doplní popis, cenu, DPH a účet (když nejsou vyplněné) */
      itemId: { edt: refEdt("inv.item", "@TAX:Item"), optionalRef: true },
      // povinnost hlídá událost — vyplní je i položka
      description: { edt: Edts.Description },
      qty: { edt: Edts.Qty, mandatory: true, default: 1 },
      unitId: { edt: refEdt("inv.unit", "@TAX:Unit"), optionalRef: true },
      unitPrice: { edt: Edts.Price, label: "@TAX:UnitPrice" },
      [sp.lineAccountField]: { edt: AccountRef(L("LineAccount")) },
      // skupina × položka DPH → daňový kód (ručně zadaný kód má přednost)
      taxGroupId: { edt: refEdt("tax.taxGroup", "@TAX:TaxGroup") },
      itemTaxGroupId: { edt: refEdt("tax.itemTaxGroup", "@TAX:ItemTaxGroup") },
      taxCodeId: { edt: refEdt("tax.taxCode", "@TAX:TaxCode") },
      ...dimFields(),
      amountNet: { edt: Edts.Amount, label: "@TAX:AmountNet", readOnly: true },
      taxAmount: { edt: Edts.Amount, label: "@TAX:TaxAmount", readOnly: true },
    },
    titleField: "description",
    list: ["itemId", "description", "qty", "unitId", "unitPrice", sp.lineAccountField, "taxGroupId", "itemTaxGroupId", "taxCodeId", ...DIM_NAMES, "amountNet", "taxAmount"],
    form: [
      { label: "@SYS:General", fields: ["invoiceId", "itemId", "description", "qty", "unitId", "unitPrice"] },
      { label: "@GL:Posting", fields: [sp.lineAccountField, "taxGroupId", "itemTaxGroupId", "taxCodeId", "amountNet", "taxAmount"] },
      { label: "@GL:Dimensions", fields: DIM_NAMES },
    ],
  });

  // objednávka (prodejní / nákupní): mimo účetnictví, z ní faktura (později rezervace a příjem na sklad)
  const order = defineObject({
    id: id("order"),
    table: `${m}_order`,
    label: L("Order"),
    labelPlural: L("Orders"),
    scope: "company",
    fields: {
      orderNum: { edt: Edts.Code, label: "@TAX:OrderNum", mandatory: true, readOnly: true },
      externalRef: { edt: Edts.Code, label: L("OrderRef") },
      [partnerId]: { edt: refEdt(id(sp.partner), L("Partner")), mandatory: true },
      orderDate: { edt: Edts.TransDate, label: "@TAX:OrderDate", mandatory: true, default: "$today" },
      deliveryDate: { edt: Edts.TransDate, label: "@TAX:DeliveryDate" },
      warehouseId: { edt: refEdt("whs.warehouse", "@TAX:Warehouse"), optionalRef: true },
      currencyId: { edt: refEdt("sys.currency", "@SYS:Currency") },
      taxGroupId: { edt: refEdt("tax.taxGroup", "@TAX:TaxGroup") },
      ...(sp.side === 1 ? { pricesInclTax: { edt: Edts.NoYes, label: "@TAX:PricesInclTax" } } : {}),
      description: { edt: Edts.Description },
      amountNet: { edt: Edts.Amount, label: "@TAX:AmountNet", readOnly: true },
      taxAmount: { edt: Edts.Amount, label: "@TAX:TaxAmount", readOnly: true },
      amountGross: { edt: Edts.Amount, label: "@TAX:AmountGross", readOnly: true },
      status: { edt: enumEdt(OrderStatus), mandatory: true, default: "open", readOnly: true },
      invoiceId: { edt: refEdt(id("invoice"), L("Invoice")), readOnly: true },
      agreementId: { edt: refEdt(id("agreement"), L("Agreement")), readOnly: true },
    },
    titleField: "orderNum",
    titleRef: partnerId,
    list: ["orderNum", "externalRef", partnerId, "orderDate", "deliveryDate", "currencyId", "amountNet", "taxAmount", "amountGross", "status", "invoiceId"],
    form: [
      { label: "@TAX:Header", fields: ["orderNum", "externalRef", partnerId, "description", "agreementId"] },
      { label: "@TAX:Dates", fields: ["orderDate", "deliveryDate", "warehouseId", "currencyId", "taxGroupId", ...(sp.side === 1 ? ["pricesInclTax"] : [])] },
      { label: "@TAX:Amounts", fields: ["amountNet", "taxAmount", "amountGross", "status", "invoiceId"] },
    ],
    numberSeq: { field: "orderNum", seq: sp.orderSeq },
    defaultSort: { field: "orderDate", dir: "desc" },
    lines: [{ object: id("orderLine"), field: "orderId", label: "@TAX:OrderLines" }],
    related: [
      ...(sp.side === -1 ? [{ object: "whs.journal", field: "purchaseOrderId", label: "@TAX:Receipts" }] : []),
      { object: id("invoice"), field: "orderId", label: L("Invoices") },
      { object: id("advance"), field: "orderId", label: L("Advances") },
    ],
    actions: [
      { id: "confirm", label: "@TAX:Confirm", when: { field: "status", equals: "open" } },
      { id: "createAdvance", label: "@TAX:CreateAdvance" },
      // i hromadně ze seznamu (objednávky splátek smluv K fakturaci)
      { id: "createInvoice", label: "@TAX:CreateInvoice", bulk: true },
      ...(sp.side === -1 ? [{ id: "receive", label: "@TAX:Receive", module: "whs" }] : []),
      { id: "cancel", label: "@TAX:CancelDoc" },
    ],
    lockedWhen: { field: "status", equals: "invoiced" },
  });

  const orderLine = defineObject({
    id: id("orderLine"),
    table: `${m}_order_line`,
    label: "@TAX:OrderLine",
    labelPlural: "@TAX:OrderLines",
    scope: "company",
    fields: {
      orderId: { edt: refEdt(id("order"), L("Order")), mandatory: true },
      itemId: { edt: refEdt("inv.item", "@TAX:Item"), optionalRef: true },
      description: { edt: Edts.Description },
      qty: { edt: Edts.Qty, mandatory: true, default: 1 },
      unitId: { edt: refEdt("inv.unit", "@TAX:Unit"), optionalRef: true },
      unitPrice: { edt: Edts.Price, label: "@TAX:UnitPrice" },
      [sp.lineAccountField]: { edt: AccountRef(L("LineAccount")) },
      // skupina × položka DPH → daňový kód (ručně zadaný kód má přednost)
      taxGroupId: { edt: refEdt("tax.taxGroup", "@TAX:TaxGroup") },
      itemTaxGroupId: { edt: refEdt("tax.itemTaxGroup", "@TAX:ItemTaxGroup") },
      taxCodeId: { edt: refEdt("tax.taxCode", "@TAX:TaxCode") },
      ...dimFields(),
      amountNet: { edt: Edts.Amount, label: "@TAX:AmountNet", readOnly: true },
      taxAmount: { edt: Edts.Amount, label: "@TAX:TaxAmount", readOnly: true },
      /** přijato (nákup) / dodáno (prodej) — sklad */
      deliveredQty: { edt: Edts.Qty, label: "@TAX:DeliveredQty", readOnly: true },
    },
    titleField: "description",
    list: ["itemId", "description", "qty", "deliveredQty", "unitId", "unitPrice", sp.lineAccountField, "itemTaxGroupId", "taxCodeId", ...DIM_NAMES, "amountNet", "taxAmount"],
    form: [
      { label: "@SYS:General", fields: ["orderId", "itemId", "description", "qty", "unitId", "unitPrice"] },
      { label: "@GL:Posting", fields: [sp.lineAccountField, "taxGroupId", "itemTaxGroupId", "taxCodeId", "amountNet", "taxAmount"] },
      { label: "@GL:Dimensions", fields: DIM_NAMES },
    ],
  });

  // zálohová faktura: výzva k platbě mimo účetnictví; úhradu účtuje banka na účet záloh,
  // konečná faktura zálohu odečte
  const advance = defineObject({
    id: id("advance"),
    table: `${m}_advance`,
    label: L("Advance"),
    labelPlural: L("Advances"),
    scope: "company",
    fields: {
      advanceNum: { edt: Edts.Code, label: "@TAX:AdvanceNum", mandatory: true, readOnly: true },
      ...(sp.externalNum ? { externalNum: { edt: Edts.Code, label: L("ExternalNum") } } : {}),
      [partnerId]: { edt: refEdt(id(sp.partner), L("Partner")), mandatory: true },
      orderId: { edt: refEdt(id("order"), L("Order")) },
      issueDate: { edt: Edts.TransDate, label: "@TAX:InvoiceDate", mandatory: true, default: "$today" },
      dueDate: { edt: Edts.TransDate, label: "@TAX:DueDate" },
      currencyId: { edt: refEdt("sys.currency", "@SYS:Currency") },
      vs: { edt: Vs },
      description: { edt: Edts.Description },
      amount: { edt: Edts.Amount, label: "@TAX:AdvanceAmount", mandatory: true },
      /** sazba DPH zálohy — plátce DPH přizná daň z přijaté platby (daňový doklad k platbě) */
      taxCodeId: { edt: refEdt("tax.taxCode", "@TAX:TaxCode") },
      taxDocNum: { edt: Edts.Code, label: "@TAX:AdvanceTaxDoc", readOnly: !sp.externalNum },
      taxDate: { edt: Edts.TransDate, label: "@TAX:AdvanceTaxDate", readOnly: true },
      taxBase: { edt: Edts.Amount, label: "@TAX:AmountNet", readOnly: true },
      taxAmount: { edt: Edts.Amount, label: "@TAX:TaxAmount", readOnly: true },
      paidAmount: { edt: Edts.Amount, label: "@TAX:PaidAmount", readOnly: true },
      settledAmount: { edt: Edts.Amount, label: "@TAX:SettledAmount", readOnly: true },
      status: { edt: enumEdt(AdvanceStatus), mandatory: true, default: "open", readOnly: true },
      agreementId: { edt: refEdt(id("agreement"), L("Agreement")), readOnly: true },
    },
    titleField: "advanceNum",
    titleRef: partnerId,
    list: ["advanceNum", ...(sp.externalNum ? ["externalNum"] : []), partnerId, "issueDate", "dueDate", "vs", "currencyId", "amount", "paidAmount", "settledAmount", "status"],
    form: [
      { label: "@TAX:Header", fields: ["advanceNum", ...(sp.externalNum ? ["externalNum"] : []), partnerId, "orderId", "agreementId", "description"] },
      { label: "@TAX:Dates", fields: ["issueDate", "dueDate", "currencyId", "vs"] },
      { label: "@TAX:Amounts", fields: ["amount", "paidAmount", "settledAmount", "status"] },
      { label: "@TAX:AdvanceVat", fields: ["taxCodeId", "taxDocNum", "taxDate", "taxBase", "taxAmount"] },
    ],
    numberSeq: { field: "advanceNum", seq: sp.advanceSeq },
    related: [{ object: "tax.trans", field: "sourceId", label: "@TAX:VatShort" }],
    defaultSort: { field: "issueDate", dir: "desc" },
    actions: [
      { id: "cancel", label: "@TAX:CancelDoc", when: { field: "status", equals: "open" } },
      { id: "markSettle", label: "@GL:MarkSettle", dialog: "markSettle", group: "process" as const },
      ...(sp.side === 1 ? [{ id: "email", label: "@INT:SendByEmail", outside: true, module: "int", group: "print" as const }] : []),
    ],
    lockedWhen: { field: "status", equals: "settled" },
  });

  const agreement = agreementObject(m, L, partnerId, id(sp.partner), sp.agreementSeq);
  const agreementLine = agreementLineObject(m, L);

  const trans = defineObject({
    id: id("trans"),
    attachmentsFromSource: true,
    table: `${m}_trans`,
    label: L("Trans"),
    labelPlural: L("TransPlural"),
    scope: "company",
    systemOnly: true,
    fields: {
      [partnerId]: { edt: refEdt(id(sp.partner), L("Partner")), mandatory: true },
      invoiceId: { edt: refEdt(id("invoice"), L("Invoice")) },
      advanceId: { edt: refEdt(id("advance"), L("Advance")) },
      /** platba smlouvy přijatá před fakturou (uhradí fakturu splátky, až vznikne) */
      agreementId: { edt: refEdt(id("agreement"), L("Agreement")) },
      voucherId: { edt: refEdt("gl.voucher", "@GL:Voucher") },
      kind: { edt: enumEdt(TransKind), mandatory: true, default: "invoice" },
      documentNum: { edt: Edts.Description, label: "@TAX:DocumentNum" },
      vs: { edt: Vs },
      date: { edt: Edts.TransDate, mandatory: true },
      dueDate: { edt: Edts.TransDate, label: "@TAX:DueDate" },
      currencyId: { edt: refEdt("sys.currency", "@SYS:Currency") },
      amount: { edt: Edts.Amount, label: "@TAX:OpenAmount", mandatory: true },
      amountCur: { edt: Edts.AmountCur, label: "@GL:AmountCur" },
      /** u faktury: kolik už bylo uhrazeno (součet úhrad) */
      paidAmount: { edt: Edts.AmountCur, label: "@TAX:PaidAmount" },
      closed: { edt: Edts.NoYes, label: "@TAX:Closed" },
      /** účet salda, na kterém položka vznikla (z účtovacího profilu); prázdné = účet skupiny partnera */
      accountId: { edt: AccountRef(L("SummaryAccount")) },
    },
    titleField: "documentNum",
    list: [partnerId, "kind", "documentNum", "vs", "date", "dueDate", "currencyId", "amountCur", "amount", "paidAmount", "closed", "voucherId"],
    form: [
      { label: "@SYS:General", fields: [partnerId, "kind", "invoiceId", "documentNum", "vs", "date", "dueDate"] },
      { label: "@TAX:Amounts", fields: ["currencyId", "amountCur", "amount", "paidAmount", "closed", "voucherId", "accountId"] },
    ],
    defaultSort: { field: "date", dir: "desc" },
  });

  const cfg: InvoiceConfig = {
    header: invoice.id,
    line: invoiceLine.id,
    lineHeaderField: "invoiceId",
    partnerField: partnerId,
    partnerObject: partner.id,
    groupObject: group.id,
    groupSummaryField: sp.summaryField,
    groupLineAccountField: sp.lineAccountField,
    vsSourceField: sp.externalNum ? "externalNum" : "invoiceNum",
    lineAccountField: sp.lineAccountField,
    item: sp.side === 1
      ? { price: "priceNet", tax: "taxCodeId", groupAccount: "revenueAccountId" }
      : { price: "purchasePrice", tax: "purchaseTaxCodeId", groupAccount: "costAccountId" },
    partnerTrans: trans.id,
    parameters: params.id,
    profileLine: profileLine.id,
    docNumField: sp.externalNum ? "externalNum" : "invoiceNum",
    side: sp.side,
    advance: { object: advance.id, groupAccountField: "advanceAccountId", defaultAccount: sp.advanceAccount },
  };
  const orderCfg: InvoiceConfig = { ...cfg, header: order.id, line: orderLine.id, lineHeaderField: "orderId", lockedStatuses: ["invoiced", "cancelled"], deleteLockedStatuses: ["invoiced"] };
  const docs = { cfg, order: order.id, orderLine: orderLine.id, invoiceLine: invoiceLine.id, advance: advance.id, vsSource: sp.externalNum ? "externalNum" : "advanceNum" };
  const inv = invoiceHandlers(cfg);
  const agrDocs: AgreementDocs = { ...docs, agreement: agreement.id, agreementLine: agreementLine.id, parameters: params.id, partnerField: partnerId, sales: sp.side === 1 };
  const agrDel = agreementDeleteHooks(agrDocs);

  return {
    /** konfigurace faktur (zaúčtování faktury z jiného modulu, např. prodej na fakturu z pokladny) */
    cfg,
    /** smlouvy (dávka, portál) */
    agreementDocs: agrDocs,
    enums: [TransKind, OrderStatus, AdvanceStatus, InvoiceDocType, ApPaymentState, ProfileAccountCode, AgreementStatus, AgreementLineStatus, AgreementMode],
    objects: [params, group, profile, profileLine, partner, agreement, agreementLine, order, orderLine, invoice, invoiceLine, advance, trans],
    /** smlouvy: výzvy k platbě na další období a blokace po lhůtě (denně) */
    jobs: [
      {
        id: `${m}.${m}Agreements`,
        label: "@TAX:AgrJob",
        default: { recurrence: "days" as const, every: 1, at: "06:00" },
        async run(ctx: EventContext) {
          const r = await runAgreements(ctx.data, agrDocs);
          return ctx.t("@TAX:AgrJobDone", { issued: String(r.issued), blocked: String(r.blocked) });
        },
      },
    ],
    handlers: {
      ...inv,
      ...agreementHandlers(agrDocs),
      ...documentLineHandlers(orderCfg),
      ...orderHandlers(docs),
      // mazání nezaúčtované smlouvy / objednávky / zálohy přes vzájemné odkazy (agreementDeleteHooks)
      [agrDocs.agreement]: { ...agreementHandlers(agrDocs)[agrDocs.agreement], beforeDelete: agrDel.agreement },
      [docs.order]: {
        ...orderHandlers(docs)[docs.order],
        beforeDelete: agrDel.order,
        actions: {
          ...orderHandlers(docs)[docs.order].actions,
          // objednávka splátky smlouvy: faktura se VS smlouvy, DUZP = den platby, úhrada přijatou platbou smlouvy
          async createInvoice(ctx: EventContext, o: RecordData) {
            const [ln] = o.agreementId ? await ctx.data.find(agrDocs.agreementLine, { orderId: o.id, status: "toInvoice" }, { take: 1 }) : [];
            if (ln) await invoiceScheduleLine(ctx.data, agrDocs, ln);
            else await orderHandlers(docs)[docs.order].actions!.createInvoice(ctx, o);
          },
        },
      },
      [docs.advance]: { ...orderHandlers(docs)[docs.advance], beforeDelete: agrDel.advance },
      // faktura z objednávky: smazáním konceptu se objednávka vrátí k fakturaci
      [invoice.id]: { ...inv[invoice.id], beforeDelete: (ctx: EventContext, d: RecordData) => releaseOrder(ctx.data, docs, d) },
      // řádek profilu: partner jen pro „Partner“, skupina jen pro „Skupina“
      [profileLine.id]: {
        async beforeSave(_ctx: EventContext, d: RecordData) {
          if (d.accountCode !== "partner") d[partnerId] = null;
          if (d.accountCode !== "group") d.groupId = null;
          if (d.accountCode === "partner" && !d[partnerId]) return { [partnerId]: "@SYS:Required" };
          if (d.accountCode === "group" && !d.groupId) return { groupId: "@SYS:Required" };
        },
      } as ObjectHandlers,
      [params.id]: {
        async beforeSave(ctx: EventContext, _d: RecordData, isNew: boolean) {
          if (isNew && (await ctx.data.find(params.id, {}, { take: 1 })).length) throw new UserError("@GL:OneParameters");
        },
      } as ObjectHandlers,
      // údaje partnera = údaje jeho subjektu v adresáři
      [partner.id]: {
        // výchozí účet musí patřit subjektu partnera; bez zadání první zveřejněný / výchozí
        async beforeSave(ctx: EventContext, d: RecordData) {
          // jen IČO (import, rychlé založení): subjekt z adresáře, jinak z registru (ARES / VIES)
          const ico = String(d.regNo ?? "").replace(/\s/g, "");
          if (!d.subjectId && ico) {
            const [have] = await ctx.data.find("gab.subject", { regNo: ico }, { take: 1 });
            d.subjectId = have?.id ?? (await createFromRegistry(ctx.data, ico, {}));
          }
          if (!d.subjectId) return { subjectId: "@SYS:Required" };
          if (!d.groupId) d.groupId = (await ctx.data.find(group.id, {}, { take: 1, orderBy: { code: "asc" } }))[0]?.id ?? null;
          if (!d.groupId) return { groupId: "@SYS:Required" };
          // IČO na partnerovi = IČO subjektu
          const subj = await ctx.data.get("gab.subject", String(d.subjectId));
          d.regNo = subj?.regNo ?? null;
          if (d.bankAccountId) {
            const acc = await ctx.data.get("gab.bankAccount", String(d.bankAccountId));
            if (!acc || acc.subjectId !== d.subjectId) return { bankAccountId: "@GAB:AccountOtherSubject" };
          } else if (d.subjectId) {
            const accs = (await ctx.data.find("gab.bankAccount", { subjectId: d.subjectId, blocked: false }, { take: 50 })) as RecordData[];
            const pick = accs.find((a) => a.isDefault) ?? accs.find((a) => a.published) ?? accs[0] ?? null;
            if (pick) d.bankAccountId = pick.id;
          }
        },
        actions: { ares: async (ctx: EventContext, p: RecordData) => void (await fillFromAres(ctx.data, String(p.subjectId))) },
      } as ObjectHandlers,
    },
    menu: [
      { label: L("Module"), items: [{ object: partner.id }, { object: agreement.id }, { object: order.id }, { object: invoice.id }, { object: advance.id }, { object: trans.id }, { object: "gl.journal", href: `/gl/journal?filter.journalType=${sp.side === 1 ? "customerPayment" : "vendorPayment"}`, label: "@GL:JournalsPayment", module: "gl" }, ...(sp.side === -1 ? [{ object: "bank.paymentOrder", module: "bank" }] : [])] },
      // nahrání dokladů k vytěžení (Integrace), cíl předvolený podle agendy
      { label: L("Module"), kind: "functions" as const, items: [{ href: `/int/doc-import?target=${m}Invoice`, label: "@INT:DocImport", module: "int" }] },
      { label: "@SYS:Setup", items: [{ object: params.id }, { object: group.id }, { object: profile.id }, { object: "tax.paymentTerm" }] },
    ],
    /** výchozí skupina partnerů (účtovací profil) podle čísel účtů */
    setup: (groupDefaults: { code: string; name: string; summary: string; line: string; taxCode: string }) =>
      async (data: DataApi) => {
        // skupina DPH Tuzemsko skupinám partnerů, které žádnou nemají
        const [tuz] = await data.find("tax.taxGroup", { code: "TUZ" }, { take: 1 });
        if (tuz) for (const g of await data.find(group.id, { taxGroupId: null }, { take: 500 })) await data.update(group.id, String(g.id), { taxGroupId: tuz.id });
        // výchozí účtovací profily (jen chybějící kódy; firma si je může upravit nebo smazat)
        const profileIds = new Map<string, string>();
        for (const pd of sp.profiles ?? []) {
          let [prof] = await data.find(profile.id, { code: pd.code }, { take: 1 });
          if (!prof) {
            let acc: string | null = null;
            if (pd.account) {
              const [exact] = pd.account.length === 6 ? await data.find("gl.account", { accountNum: pd.account }, { take: 1 }) : [];
              acc = exact ? String(exact.id) : await postingAccount(data, pd.account);
              if (!acc) continue; // účet v rozvrhu chybí — profil nezakládat
            }
            prof = await data.create(profile.id, { code: pd.code, name: pd.name });
            if (acc) await data.create(profileLine.id, { profileId: prof.id, accountCode: "all", summaryAccountId: acc });
          }
          profileIds.set(pd.code, String(prof.id));
        }
        // parametry: výchozí profil a profil darů (jen nevyplněné)
        const want: RecordData = {};
        if (sp.defaultProfile && profileIds.has(sp.defaultProfile)) want.postingProfileId = profileIds.get(sp.defaultProfile);
        if (sp.donationProfile && profileIds.has(sp.donationProfile)) want.donationProfileId = profileIds.get(sp.donationProfile);
        if (Object.keys(want).length) {
          const [p] = await data.find(params.id, {}, { take: 1 });
          if (!p) await data.create(params.id, { invoiceNumCheck: "reject", ...want });
          else {
            const fill = Object.fromEntries(Object.entries(want).filter(([k]) => !p[k]));
            if (Object.keys(fill).length) await data.update(params.id, String(p.id), fill);
          }
        }
        // dodavatel Finanční úřad (Daňové parametry) dostane profil FÚ, když žádný nemá
        if (sp.taxOfficeProfile && profileIds.has(sp.taxOfficeProfile)) {
          const [tp] = await data.find("tax.parameters", {}, { take: 1 }).catch(() => [] as RecordData[]);
          const fu = tp?.taxOfficeVendorId ? await data.get(partner.id, String(tp.taxOfficeVendorId)) : null;
          if (fu && !fu.postingProfileId) await data.update(partner.id, String(fu.id), { postingProfileId: profileIds.get(sp.taxOfficeProfile) });
        }
        if ((await data.find(group.id, {}, { take: 1 })).length) return;
        const acc = (num: string) => postingAccount(data, num);
        const summary = await acc(groupDefaults.summary);
        if (!summary) return;
        // neplátce DPH: prodej / nákup bez DPH
        const tcCode = (await vatPayer(data)) ? groupDefaults.taxCode : sp.side === 1 ? "BEZ" : "P0";
        const [tc] = await data.find("tax.taxCode", { code: tcCode }, { take: 1 });
        await data.create(group.id, {
          code: groupDefaults.code,
          name: groupDefaults.name,
          [sp.summaryField]: summary,
          [sp.lineAccountField]: await acc(groupDefaults.line),
          taxCodeId: tc?.id ?? null,
          taxGroupId: tuz?.id ?? null,
        });
      },
  };
}
