/**
 * Továrna na pomocnou knihu partnerů (odběratelé AR, dodavatelé AP).
 * Obě knihy mají stejnou stavbu — skupina (účtovací profil), partner,
 * faktura s řádky a otevřené položky; liší se jen názvy, účty a stranou
 * účtování. Modul dodá parametry a labely, objekty a logika jsou společné.
 */
import { Edts, defineEdt, defineEnum, enumEdt, refEdt } from "@/core/edt";
import type { DataApi, EventContext, ObjectHandlers, RecordData } from "@/core/module";
import { defineObject, type ObjectDef } from "@/core/object";
import { DIM_NAMES, JournalStatus, dimFields } from "@/modules/gl";
import { invoiceHandlers, type InvoiceConfig } from "./document";
import { postingAccount } from "@/modules/gl/setup";
import { fillFromAres } from "@/modules/gab/ares";

/** Variabilní symbol — jen číslice, do 10 znaků (jako v příkazu k úhradě). */
export const Vs = defineEdt({ id: "Vs", kind: "string", label: "@TAX:Vs", maxLength: 10, pattern: /^\d{1,10}$/, patternMessage: "@TAX:VsHelp" });

/** Druh otevřené položky. */
export const TransKind = defineEnum({
  id: "PartnerTransKind",
  label: "@TAX:TransKind",
  values: [
    { value: "invoice", label: "@TAX:KindInvoice" },
    { value: "payment", label: "@TAX:KindPayment" },
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
  /** u přijatých faktur číslo dokladu dodavatele */
  externalNum?: boolean;
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
    fields: {
      code: { edt: Edts.Code, mandatory: true },
      name: { edt: Edts.Name, mandatory: true },
      [sp.summaryField]: { edt: AccountRef(L("SummaryAccount")), mandatory: true },
      [sp.lineAccountField]: { edt: AccountRef(L("LineAccount")) },
      taxCodeId: { edt: refEdt("tax.taxCode", "@TAX:TaxCode") },
      paymentDays: { edt: Edts.Int, label: "@TAX:PaymentDays", default: 14 },
    },
    titleField: "code",
    list: ["code", "name", sp.summaryField, sp.lineAccountField, "taxCodeId", "paymentDays"],
    form: [
      { label: "@SYS:General", fields: ["code", "name", "paymentDays"] },
      { label: "@GL:Posting", fields: [sp.summaryField, sp.lineAccountField, "taxCodeId"] },
    ],
    unique: [["code"]],
    defaultSort: { field: "code", dir: "asc" },
  });

  const partner = defineObject({
    id: id(sp.partner),
    table: `${m}_${sp.partner}`,
    label: L("Partner"),
    labelPlural: L("Partners"),
    scope: "company",
    fields: {
      accountNum: { edt: Edts.Code, label: L("AccountNum"), mandatory: true, readOnly: true },
      subjectId: { edt: refEdt("gab.subject", "@GAB:Subject"), mandatory: true },
      // výchozí dimenze dokladů partnera (z adresáře se doplní samy)
      ...dimFields(),
      groupId: { edt: refEdt(id("group"), L("Group")), mandatory: true },
      currencyId: { edt: refEdt("sys.currency", "@SYS:Currency") },
      paymentDays: { edt: Edts.Int, label: "@TAX:PaymentDays" },
      blocked: { edt: Edts.NoYes, label: "@GL:Blocked" },
    },
    titleField: "accountNum",
    list: ["accountNum", "subjectId", "groupId", "currencyId", "paymentDays", "blocked"],
    form: [
      { label: "@SYS:General", fields: ["accountNum", "subjectId", "groupId", "blocked"] },
      { label: L("Terms"), fields: ["currencyId", "paymentDays"] },
      { label: "@GL:DefaultDims", fields: ["dim1", "dim2", "dim3", "dim4", "dim5", "dim6"] },
    ],
    unique: [["accountNum"], ["subjectId"]],
    numberSeq: { field: "accountNum", seq: sp.partnerSeq },
    defaultSort: { field: "accountNum", dir: "asc" },
    actions: [{ id: "ares", label: "@GAB:FromAres" }],
    lines: [
      { object: id("trans"), field: partnerId, label: L("TransPlural"), owned: false },
      { object: id("invoice"), field: partnerId, label: L("Invoices"), owned: false },
    ],
  });

  const invoiceFields: ObjectDef["fields"] = {
    invoiceNum: { edt: Edts.Code, label: "@TAX:InvoiceNum", mandatory: true, readOnly: true },
    ...(sp.externalNum ? { externalNum: { edt: Edts.Code, label: L("ExternalNum"), mandatory: true } } : {}),
    [partnerId]: { edt: refEdt(id(sp.partner), L("Partner")), mandatory: true },
    invoiceDate: { edt: Edts.TransDate, label: "@TAX:InvoiceDate", mandatory: true, default: "$today" },
    taxDate: { edt: Edts.TransDate, label: "@TAX:TaxDate" },
    dueDate: { edt: Edts.TransDate, label: "@TAX:DueDate" },
    currencyId: { edt: refEdt("sys.currency", "@SYS:Currency") },
    /** prázdné = číslice z čísla faktury (u přijaté z čísla dodavatele) */
    vs: { edt: Vs },
    description: { edt: Edts.Description },
    amountNet: { edt: Edts.Amount, label: "@TAX:AmountNet", readOnly: true },
    taxAmount: { edt: Edts.Amount, label: "@TAX:TaxAmount", readOnly: true },
    amountGross: { edt: Edts.Amount, label: "@TAX:AmountGross", readOnly: true },
    paidAmount: { edt: Edts.Amount, label: "@TAX:PaidAmount", readOnly: true },
    status: { edt: enumEdt(JournalStatus), mandatory: true, default: "draft", readOnly: true },
    voucherId: { edt: refEdt("gl.voucher", "@GL:Voucher"), readOnly: true },
  };
  const headerFields = ["invoiceNum", ...(sp.externalNum ? ["externalNum"] : []), partnerId, "description"];
  const invoice = defineObject({
    id: id("invoice"),
    table: `${m}_invoice`,
    label: L("Invoice"),
    labelPlural: L("Invoices"),
    scope: "company",
    fields: invoiceFields,
    titleField: "invoiceNum",
    list: ["invoiceNum", ...(sp.externalNum ? ["externalNum"] : []), partnerId, "invoiceDate", "dueDate", "vs", "currencyId", "amountNet", "taxAmount", "amountGross", "paidAmount", "status"],
    form: [
      { label: "@TAX:Header", fields: headerFields },
      { label: "@TAX:Dates", fields: ["invoiceDate", "taxDate", "dueDate", "currencyId", "vs"] },
      { label: "@TAX:Amounts", fields: ["amountNet", "taxAmount", "amountGross", "paidAmount", "status", "voucherId"] },
    ],
    numberSeq: { field: "invoiceNum", seq: sp.invoiceSeq },
    defaultSort: { field: "invoiceDate", dir: "desc" },
    lines: [{ object: id("invoiceLine"), field: "invoiceId", label: "@TAX:Lines" }],
    actions: [{ id: "post", label: "@GL:Post", when: { field: "status", equals: "draft" } }],
    lockedWhen: { field: "status", equals: "posted" },
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
      taxCodeId: { edt: refEdt("tax.taxCode", "@TAX:TaxCode") },
      ...dimFields(),
      amountNet: { edt: Edts.Amount, label: "@TAX:AmountNet", readOnly: true },
      taxAmount: { edt: Edts.Amount, label: "@TAX:TaxAmount", readOnly: true },
    },
    titleField: "description",
    list: ["itemId", "description", "qty", "unitId", "unitPrice", sp.lineAccountField, "taxCodeId", ...DIM_NAMES, "amountNet", "taxAmount"],
    form: [
      { label: "@SYS:General", fields: ["invoiceId", "itemId", "description", "qty", "unitId", "unitPrice"] },
      { label: "@GL:Posting", fields: [sp.lineAccountField, "taxCodeId", "amountNet", "taxAmount"] },
      { label: "@GL:Dimensions", fields: DIM_NAMES },
    ],
  });

  const trans = defineObject({
    id: id("trans"),
    table: `${m}_trans`,
    label: L("Trans"),
    labelPlural: L("TransPlural"),
    scope: "company",
    systemOnly: true,
    fields: {
      [partnerId]: { edt: refEdt(id(sp.partner), L("Partner")), mandatory: true },
      invoiceId: { edt: refEdt(id("invoice"), L("Invoice")) },
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
    },
    titleField: "documentNum",
    list: [partnerId, "kind", "documentNum", "vs", "date", "dueDate", "currencyId", "amountCur", "amount", "paidAmount", "closed", "voucherId"],
    form: [
      { label: "@SYS:General", fields: [partnerId, "kind", "invoiceId", "documentNum", "vs", "date", "dueDate"] },
      { label: "@TAX:Amounts", fields: ["currencyId", "amountCur", "amount", "paidAmount", "closed", "voucherId"] },
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
    docNumField: sp.externalNum ? "externalNum" : "invoiceNum",
    side: sp.side,
  };

  return {
    enums: [TransKind],
    objects: [group, partner, invoice, invoiceLine, trans],
    handlers: {
      ...invoiceHandlers(cfg),
      // údaje partnera = údaje jeho subjektu v adresáři
      [partner.id]: { actions: { ares: async (ctx: EventContext, p: RecordData) => void (await fillFromAres(ctx.data, String(p.subjectId))) } } as ObjectHandlers,
    },
    menu: [
      { label: L("Module"), items: [{ object: partner.id }, { object: invoice.id }, { object: trans.id }] },
      { label: "@SYS:Setup", items: [{ object: group.id }] },
    ],
    /** výchozí skupina partnerů (účtovací profil) podle čísel účtů */
    setup: (groupDefaults: { code: string; name: string; summary: string; line: string; taxCode: string }) =>
      async (data: DataApi) => {
        if ((await data.find(group.id, {}, { take: 1 })).length) return;
        const acc = (num: string) => postingAccount(data, num);
        const summary = await acc(groupDefaults.summary);
        if (!summary) return;
        const [tc] = await data.find("tax.taxCode", { code: groupDefaults.taxCode }, { take: 1 });
        await data.create(group.id, {
          code: groupDefaults.code,
          name: groupDefaults.name,
          [sp.summaryField]: summary,
          [sp.lineAccountField]: await acc(groupDefaults.line),
          taxCodeId: tc?.id ?? null,
          paymentDays: 14,
        });
      },
  };
}
