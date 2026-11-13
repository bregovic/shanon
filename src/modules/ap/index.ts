/**
 * Dodavatelé (AP): skupiny dodavatelů (účtovací profil), dodavatelé,
 * přijaté faktury, otevřené položky. Stavba společná s odběrateli —
 * src/modules/tax/partner-ledger.ts.
 */
import { defineModule } from "@/core/module";
import { partnerLedger } from "@/modules/tax/partner-ledger";

export const ap = partnerLedger({
  module: "ap",
  L: "AP",
  partner: "vendor",
  summaryField: "payableAccountId",
  lineAccountField: "expenseAccountId",
  side: -1,
  partnerSeq: "APVEND",
  invoiceSeq: "APINV",
  externalNum: true,
});

export default defineModule({
  id: "ap",
  label: "@AP:Module",
  description: "@AP:ModuleDesc",
  icon: "BuildingShop",
  dependsOn: ["gab", "gl", "tax"],
  enums: ap.enums,
  objects: ap.objects,
  menu: ap.menu,
  numberSeqs: [
    { code: "APVEND", name: "@AP:Partners", format: "DOD{#####}", usedFor: "ap.vendor" },
    { code: "APINV", name: "@AP:Invoices", format: "FP{YY}{#####}", usedFor: "ap.invoice" },
  ],
  setup: ap.setup({ code: "TUZ", name: "Tuzemští dodavatelé", summary: "321", line: "518", taxCode: "P21" }),
  labels: {
    cs: {
      Module: "Dodavatelé",
      ModuleDesc: "Dodavatelé, přijaté faktury s DPH, saldo a splatnosti.",
      Group: "Skupina dodavatelů",
      Groups: "Skupiny dodavatelů",
      Partner: "Dodavatel",
      Partners: "Dodavatelé",
      AccountNum: "Číslo dodavatele",
      SummaryAccount: "Účet závazků",
      LineAccount: "Účet nákladů",
      Terms: "Platební podmínky",
      Invoice: "Přijatá faktura",
      Invoices: "Přijaté faktury",
      ExternalNum: "Číslo faktury dodavatele",
      Trans: "Otevřená položka",
      TransPlural: "Saldo dodavatelů",
    },
    en: {
      Module: "Accounts payable",
      ModuleDesc: "Vendors, purchase invoices with VAT, balances and due dates.",
      Group: "Vendor group",
      Groups: "Vendor groups",
      Partner: "Vendor",
      Partners: "Vendors",
      AccountNum: "Vendor account",
      SummaryAccount: "Payables account",
      LineAccount: "Expense account",
      Terms: "Payment terms",
      Invoice: "Purchase invoice",
      Invoices: "Purchase invoices",
      ExternalNum: "Vendor invoice number",
      Trans: "Vendor transaction",
      TransPlural: "Vendor transactions",
    },
  },
});
