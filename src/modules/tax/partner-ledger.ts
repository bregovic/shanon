/**
 * Továrna na pomocnou knihu partnerů (odběratelé AR, dodavatelé AP).
 * Obě knihy mají stejnou stavbu — skupina (účtovací profil), partner,
 * faktura s řádky a otevřené položky; liší se jen názvy, účty a stranou
 * účtování. Modul dodá parametry a labely, objekty a logika jsou společné.
 */
import { Edts, enumEdt, refEdt } from "@/core/edt";
import type { DataApi } from "@/core/module";
import { defineObject, type ObjectDef } from "@/core/object";
import { JournalStatus } from "@/modules/gl";
import { invoiceHandlers, type InvoiceConfig } from "./document";

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
    ],
    unique: [["accountNum"], ["subjectId"]],
    numberSeq: { field: "accountNum", seq: sp.partnerSeq },
    defaultSort: { field: "accountNum", dir: "asc" },
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
    description: { edt: Edts.Description },
    amountNet: { edt: Edts.Amount, label: "@TAX:AmountNet", readOnly: true },
    taxAmount: { edt: Edts.Amount, label: "@TAX:TaxAmount", readOnly: true },
    amountGross: { edt: Edts.Amount, label: "@TAX:AmountGross", readOnly: true },
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
    list: ["invoiceNum", ...(sp.externalNum ? ["externalNum"] : []), partnerId, "invoiceDate", "dueDate", "currencyId", "amountNet", "taxAmount", "amountGross", "status"],
    form: [
      { label: "@TAX:Header", fields: headerFields },
      { label: "@TAX:Dates", fields: ["invoiceDate", "taxDate", "dueDate", "currencyId"] },
      { label: "@TAX:Amounts", fields: ["amountNet", "taxAmount", "amountGross", "status", "voucherId"] },
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
      description: { edt: Edts.Description, mandatory: true },
      qty: { edt: Edts.Qty, mandatory: true, default: 1 },
      unitPrice: { edt: Edts.Price, label: "@TAX:UnitPrice", mandatory: true },
      [sp.lineAccountField]: { edt: AccountRef(L("LineAccount")) },
      taxCodeId: { edt: refEdt("tax.taxCode", "@TAX:TaxCode") },
      costCenterId: { edt: refEdt("gl.costCenter", "@GL:CostCenter") },
      amountNet: { edt: Edts.Amount, label: "@TAX:AmountNet", readOnly: true },
      taxAmount: { edt: Edts.Amount, label: "@TAX:TaxAmount", readOnly: true },
    },
    titleField: "description",
    list: ["description", "qty", "unitPrice", sp.lineAccountField, "taxCodeId", "costCenterId", "amountNet", "taxAmount"],
    form: [
      { label: "@SYS:General", fields: ["invoiceId", "description", "qty", "unitPrice"] },
      { label: "@GL:Posting", fields: [sp.lineAccountField, "taxCodeId", "costCenterId", "amountNet", "taxAmount"] },
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
      documentNum: { edt: Edts.Description, label: "@TAX:DocumentNum" },
      date: { edt: Edts.TransDate, mandatory: true },
      dueDate: { edt: Edts.TransDate, label: "@TAX:DueDate" },
      currencyId: { edt: refEdt("sys.currency", "@SYS:Currency") },
      amount: { edt: Edts.Amount, label: "@TAX:OpenAmount", mandatory: true },
      amountCur: { edt: Edts.AmountCur, label: "@GL:AmountCur" },
    },
    titleField: "documentNum",
    list: [partnerId, "documentNum", "date", "dueDate", "currencyId", "amountCur", "amount", "voucherId"],
    form: [{ label: "@SYS:General", fields: [partnerId, "invoiceId", "documentNum", "date", "dueDate", "currencyId", "amountCur", "amount", "voucherId"] }],
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
    lineAccountField: sp.lineAccountField,
    partnerTrans: trans.id,
    docNumField: sp.externalNum ? "externalNum" : "invoiceNum",
    side: sp.side,
  };

  return {
    objects: [group, partner, invoice, invoiceLine, trans],
    handlers: invoiceHandlers(cfg),
    menu: [
      { label: L("Module"), items: [{ object: partner.id }, { object: invoice.id }, { object: trans.id }] },
      { label: "@SYS:Setup", items: [{ object: group.id }] },
    ],
    /** výchozí skupina partnerů (účtovací profil) podle čísel účtů */
    setup: (groupDefaults: { code: string; name: string; summary: string; line: string; taxCode: string }) =>
      async (data: DataApi) => {
        if ((await data.find(group.id, {}, { take: 1 })).length) return;
        const acc = async (num: string) => (await data.find("gl.account", { accountNum: num }, { take: 1 }))[0]?.id ?? null;
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
