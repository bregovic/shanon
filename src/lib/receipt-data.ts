/** Data účtenky pro tiskovou šablonu (server i kasa v prohlížeči). */
import type { ReceiptPrint } from "@/modules/pos/sale";

/** Data účtenky z podkladů pro tisk (stejné na serveru i v kase). */
export function receiptData(r: ReceiptPrint, extra: { email?: string; phone?: string; web?: string } = {}, paymentLabels: Record<string, string> = {}) {
  // odběratel zadaný jen na účtenku (adhoc) z ní fakturu nedělá
  const known = !!r.customer && !r.customer.adhoc;
  return {
    company: {
      name: r.company.name,
      tradeName: r.company.tradeName ?? "",
      address: r.company.address ?? "",
      regNo: r.company.regNo ?? "",
      vatId: r.company.vatId ?? "",
      registration: r.company.registration ?? "",
      // logo: v kase odkaz na přílohu, tisk na serveru ho nahradí data: URL (printJob)
      logoId: r.company.logoId ?? "",
      logo: r.company.logoId ? `/api/files/${r.company.logoId}` : "",
      ...extra,
    },
    // známý odběratel: účtenka je faktura – daňový doklad (úplné údaje odběratele)
    customer: {
      name: r.customer?.name ?? "",
      address: r.customer?.address ?? "",
      ids: [r.customer?.regNo ? `IČO ${r.customer.regNo}` : "", r.customer?.vatId ? `DIČ ${r.customer.vatId}` : ""].filter(Boolean).join("   "),
    },
    doc: {
      // neplátce DPH nevystavuje daňový doklad
      title: r.vatPayer === false ? (known ? "Faktura" : "Účtenka") : known ? "Faktura – daňový doklad" : "Zjednodušený daňový doklad",
      vatPayer: r.vatPayer === false ? "" : "1",
      nonPayerNote: r.vatPayer === false ? "Nejsme plátci DPH." : "",
      number: r.receiptNum,
      date: r.issuedAt,
      dateTime: new Date(r.issuedAt).toLocaleString("cs-CZ"),
      register: r.register,
      gross: r.gross,
      rounding: Number(r.rounding) ? r.rounding : "",
      paid: r.paid,
      payment: paymentLabels[r.payment] ?? r.payment,
      cashGiven: r.cashGiven ?? "",
      change: r.change ?? "",
      footer: r.footer ?? "",
      fik: r.eet?.pok ?? "",
      // QR platba čekající na úhradu: QR kód, VS a výzva k platbě
      qr: r.qr ?? "",
      vs: r.vs ?? "",
      qrNote: r.qr ? "Čeká na platbu – naskenujte QR kód v bankovní aplikaci." : "",
    },
    lines: r.lines.map((l) => ({ description: l.description, qty: l.qty, unit: l.unit, unitPrice: l.unitPrice, gross: l.amount, rate: l.rate })),
    vat: r.vat.map((v) => ({ rate: v.rate, base: v.base, tax: v.tax, gross: (Number(v.base) + Number(v.tax)).toFixed(2) })),
  };
}

