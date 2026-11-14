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
import { documentLineHandlers, invoiceHandlers, type InvoiceConfig } from "./document";
import { orderHandlers, releaseOrder } from "./orders";
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
  /** účet záloh (přijaté 324 / poskytnuté 314) — výchozí syntetika */
  advanceAccount: string;
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
    shareable: true,
    fields: {
      code: { edt: Edts.Code, mandatory: true },
      name: { edt: Edts.Name, mandatory: true },
      [sp.summaryField]: { edt: AccountRef(L("SummaryAccount")), mandatory: true },
      [sp.lineAccountField]: { edt: AccountRef(L("LineAccount")) },
      taxCodeId: { edt: refEdt("tax.taxCode", "@TAX:TaxCode") },
      /** prázdné = první účet syntetiky záloh (324 / 314) */
      advanceAccountId: { edt: AccountRef(L("AdvanceAccount")) },
      paymentDays: { edt: Edts.Int, label: "@TAX:PaymentDays", default: 14 },
    },
    titleField: "code",
    list: ["code", "name", sp.summaryField, sp.lineAccountField, "taxCodeId", "paymentDays"],
    form: [
      { label: "@SYS:General", fields: ["code", "name", "paymentDays"] },
      { label: "@GL:Posting", fields: [sp.summaryField, sp.lineAccountField, "taxCodeId", "advanceAccountId"] },
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
    shareable: true,
    fields: {
      accountNum: { edt: Edts.Code, label: L("AccountNum"), mandatory: true, readOnly: true },
      subjectId: { edt: refEdt("gab.subject", "@GAB:Subject"), mandatory: true },
      // výchozí dimenze dokladů partnera (z adresáře se doplní samy)
      ...dimFields(),
      groupId: { edt: refEdt(id("group"), L("Group")), mandatory: true },
      currencyId: { edt: refEdt("sys.currency", "@SYS:Currency") },
      paymentDays: { edt: Edts.Int, label: "@TAX:PaymentDays" },
      /** výchozí účet pro platby (z bankovních účtů subjektu) */
      bankAccountId: { edt: refEdt("gab.bankAccount", "@GAB:BankAccount") },
      blocked: { edt: Edts.NoYes, label: "@GL:Blocked" },
    },
    titleField: "accountNum",
    list: ["accountNum", "subjectId", "groupId", "currencyId", "paymentDays", "blocked"],
    form: [
      { label: "@SYS:General", fields: ["accountNum", "subjectId", "groupId", "blocked"] },
      { label: L("Terms"), fields: ["currencyId", "paymentDays", "bankAccountId"] },
      { label: "@GL:DefaultDims", fields: ["dim1", "dim2", "dim3", "dim4", "dim5", "dim6"] },
    ],
    unique: [["accountNum"], ["subjectId"]],
    numberSeq: { field: "accountNum", seq: sp.partnerSeq },
    // v odkazech a výběru „číslo · název subjektu“, hledání i podle názvu
    titleRef: "subjectId",
    defaultSort: { field: "accountNum", dir: "asc" },
    actions: [{ id: "ares", label: "@GAB:FromAres" }],
    lines: [
      { object: id("trans"), field: partnerId, label: L("TransPlural"), owned: false },
      { object: id("order"), field: partnerId, label: L("Orders"), owned: false },
      { object: id("invoice"), field: partnerId, label: L("Invoices"), owned: false },
      { object: id("advance"), field: partnerId, label: L("Advances"), owned: false },
    ],
  });

  const invoiceFields: ObjectDef["fields"] = {
    invoiceNum: { edt: Edts.Code, label: "@TAX:InvoiceNum", mandatory: true, readOnly: true },
    // povinné až při zaúčtování (faktura z objednávky ho ještě nezná)
    ...(sp.externalNum ? { externalNum: { edt: Edts.Code, label: L("ExternalNum") } } : {}),
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
    orderId: { edt: refEdt(id("order"), L("Order")), readOnly: true },
    /** uhrazená záloha partnera — odečte se při zaúčtování */
    advanceId: { edt: refEdt(id("advance"), L("Advance")) },
    advanceAmount: { edt: Edts.Amount, label: "@TAX:AdvanceDeducted", readOnly: true },
  };
  const headerFields = ["invoiceNum", ...(sp.externalNum ? ["externalNum"] : []), partnerId, "description", "orderId", "advanceId"];
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
      { label: "@TAX:Amounts", fields: ["amountNet", "taxAmount", "amountGross", "advanceAmount", "paidAmount", "status", "voucherId"] },
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
      description: { edt: Edts.Description },
      amountNet: { edt: Edts.Amount, label: "@TAX:AmountNet", readOnly: true },
      taxAmount: { edt: Edts.Amount, label: "@TAX:TaxAmount", readOnly: true },
      amountGross: { edt: Edts.Amount, label: "@TAX:AmountGross", readOnly: true },
      status: { edt: enumEdt(OrderStatus), mandatory: true, default: "open", readOnly: true },
      invoiceId: { edt: refEdt(id("invoice"), L("Invoice")), readOnly: true },
    },
    titleField: "orderNum",
    titleRef: partnerId,
    list: ["orderNum", "externalRef", partnerId, "orderDate", "deliveryDate", "currencyId", "amountNet", "taxAmount", "amountGross", "status", "invoiceId"],
    form: [
      { label: "@TAX:Header", fields: ["orderNum", "externalRef", partnerId, "description"] },
      { label: "@TAX:Dates", fields: ["orderDate", "deliveryDate", "warehouseId", "currencyId"] },
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
      { id: "createInvoice", label: "@TAX:CreateInvoice" },
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
      taxCodeId: { edt: refEdt("tax.taxCode", "@TAX:TaxCode") },
      ...dimFields(),
      amountNet: { edt: Edts.Amount, label: "@TAX:AmountNet", readOnly: true },
      taxAmount: { edt: Edts.Amount, label: "@TAX:TaxAmount", readOnly: true },
      /** přijato (nákup) / dodáno (prodej) — sklad */
      deliveredQty: { edt: Edts.Qty, label: "@TAX:DeliveredQty", readOnly: true },
    },
    titleField: "description",
    list: ["itemId", "description", "qty", "deliveredQty", "unitId", "unitPrice", sp.lineAccountField, "taxCodeId", ...DIM_NAMES, "amountNet", "taxAmount"],
    form: [
      { label: "@SYS:General", fields: ["orderId", "itemId", "description", "qty", "unitId", "unitPrice"] },
      { label: "@GL:Posting", fields: [sp.lineAccountField, "taxCodeId", "amountNet", "taxAmount"] },
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
      paidAmount: { edt: Edts.Amount, label: "@TAX:PaidAmount", readOnly: true },
      settledAmount: { edt: Edts.Amount, label: "@TAX:SettledAmount", readOnly: true },
      status: { edt: enumEdt(AdvanceStatus), mandatory: true, default: "open", readOnly: true },
    },
    titleField: "advanceNum",
    titleRef: partnerId,
    list: ["advanceNum", ...(sp.externalNum ? ["externalNum"] : []), partnerId, "issueDate", "dueDate", "vs", "currencyId", "amount", "paidAmount", "settledAmount", "status"],
    form: [
      { label: "@TAX:Header", fields: ["advanceNum", ...(sp.externalNum ? ["externalNum"] : []), partnerId, "orderId", "description"] },
      { label: "@TAX:Dates", fields: ["issueDate", "dueDate", "currencyId", "vs"] },
      { label: "@TAX:Amounts", fields: ["amount", "paidAmount", "settledAmount", "status"] },
    ],
    numberSeq: { field: "advanceNum", seq: sp.advanceSeq },
    defaultSort: { field: "issueDate", dir: "desc" },
    actions: [{ id: "cancel", label: "@TAX:CancelDoc", when: { field: "status", equals: "open" } }],
    lockedWhen: { field: "status", equals: "settled" },
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
      advanceId: { edt: refEdt(id("advance"), L("Advance")) },
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
    advance: { object: advance.id, groupAccountField: "advanceAccountId", defaultAccount: sp.advanceAccount },
  };
  const orderCfg: InvoiceConfig = { ...cfg, header: order.id, line: orderLine.id, lineHeaderField: "orderId", lockedStatuses: ["invoiced", "cancelled"] };
  const docs = { cfg, order: order.id, orderLine: orderLine.id, invoiceLine: invoiceLine.id, advance: advance.id, vsSource: sp.externalNum ? "externalNum" : "advanceNum" };
  const inv = invoiceHandlers(cfg);

  return {
    enums: [TransKind, OrderStatus, AdvanceStatus],
    objects: [group, partner, order, orderLine, invoice, invoiceLine, advance, trans],
    handlers: {
      ...inv,
      ...documentLineHandlers(orderCfg),
      ...orderHandlers(docs),
      // faktura z objednávky: smazáním konceptu se objednávka vrátí k fakturaci
      [invoice.id]: { ...inv[invoice.id], beforeDelete: (ctx: EventContext, d: RecordData) => releaseOrder(ctx.data, docs, d) },
      // údaje partnera = údaje jeho subjektu v adresáři
      [partner.id]: {
        // výchozí účet musí patřit subjektu partnera; bez zadání první zveřejněný / výchozí
        async beforeSave(ctx: EventContext, d: RecordData) {
          if (d.bankAccountId) {
            const acc = await ctx.data.get("gab.bankAccount", String(d.bankAccountId));
            if (!acc || acc.subjectId !== d.subjectId) return { bankAccountId: "@GAB:AccountOtherSubject" };
          } else if (d.subjectId) {
            const accs = (await ctx.data.find("gab.bankAccount", { subjectId: d.subjectId, blocked: false }, { take: 50 })) as RecordData[];
            const pick = accs.find((a) => a.isDefault) ?? accs.find((a) => a.published) ?? null;
            if (pick) d.bankAccountId = pick.id;
          }
        },
        actions: { ares: async (ctx: EventContext, p: RecordData) => void (await fillFromAres(ctx.data, String(p.subjectId))) },
      } as ObjectHandlers,
    },
    menu: [
      { label: L("Module"), items: [{ object: partner.id }, { object: order.id }, { object: invoice.id }, { object: advance.id }, { object: trans.id }] },
      // nahrání dokladů k vytěžení (Integrace), cíl předvolený podle agendy
      { label: L("Module"), kind: "functions" as const, items: [{ href: `/int/doc-import?target=${m}Invoice`, label: "@INT:DocImport", module: "int" }] },
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
