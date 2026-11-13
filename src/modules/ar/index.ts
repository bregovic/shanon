/**
 * Odběratelé (AR): skupiny odběratelů (účtovací profil), odběratelé,
 * vydané faktury, otevřené položky. Stavba společná s dodavateli —
 * src/modules/tax/partner-ledger.ts.
 */
import { defineModule } from "@/core/module";
import { partnerLedger } from "@/modules/tax/partner-ledger";

export const ar = partnerLedger({
  module: "ar",
  L: "AR",
  partner: "customer",
  summaryField: "receivableAccountId",
  lineAccountField: "revenueAccountId",
  side: 1,
  partnerSeq: "ARCUST",
  invoiceSeq: "ARINV",
});

export default defineModule({
  id: "ar",
  label: "@AR:Module",
  description: "@AR:ModuleDesc",
  icon: "PeopleMoney",
  dependsOn: ["gab", "gl", "tax"],
  enums: ar.enums,
  objects: ar.objects,
  menu: ar.menu,
  numberSeqs: [
    { code: "ARCUST", name: "@AR:Partners", format: "ODB{#####}", usedFor: "ar.customer" },
    { code: "ARINV", name: "@AR:Invoices", format: "FV{YY}{#####}", usedFor: "ar.invoice" },
  ],
  setup: ar.setup({ code: "TUZ", name: "Tuzemští odběratelé", summary: "311", line: "604", taxCode: "V21" }),
  labels: {
    cs: {
      Module: "Odběratelé",
      ModuleDesc: "Odběratelé, vydané faktury s DPH, saldo a splatnosti.",
      Group: "Skupina odběratelů",
      Groups: "Skupiny odběratelů",
      Partner: "Odběratel",
      Partners: "Odběratelé",
      AccountNum: "Číslo odběratele",
      SummaryAccount: "Účet pohledávek",
      LineAccount: "Účet výnosů",
      Terms: "Platební podmínky",
      Invoice: "Vydaná faktura",
      Invoices: "Vydané faktury",
      Trans: "Otevřená položka",
      TransPlural: "Saldo odběratelů",
    },
    en: {
      Module: "Accounts receivable",
      ModuleDesc: "Customers, sales invoices with VAT, balances and due dates.",
      Group: "Customer group",
      Groups: "Customer groups",
      Partner: "Customer",
      Partners: "Customers",
      AccountNum: "Customer account",
      SummaryAccount: "Receivables account",
      LineAccount: "Revenue account",
      Terms: "Payment terms",
      Invoice: "Sales invoice",
      Invoices: "Sales invoices",
      Trans: "Customer transaction",
      TransPlural: "Customer transactions",
    },
  },
});
