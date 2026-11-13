/** Data účtenky pro tiskovou šablonu (server i kasa v prohlížeči). */
import type { ReceiptPrint } from "@/modules/pos/sale";

/** Data účtenky z podkladů pro tisk (stejné na serveru i v kase). */
export function receiptData(r: ReceiptPrint, extra: { email?: string; phone?: string; web?: string } = {}, paymentLabels: Record<string, string> = {}) {
  return {
    company: { name: r.company.name, tradeName: r.company.tradeName ?? "", address: r.company.address ?? "", regNo: r.company.regNo ?? "", vatId: r.company.vatId ?? "", ...extra },
    doc: {
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
    },
    lines: r.lines.map((l) => ({ description: l.description, qty: l.qty, unit: l.unit, unitPrice: l.unitPrice, gross: l.amount, rate: l.rate })),
    vat: r.vat.map((v) => ({ rate: v.rate, base: v.base, tax: v.tax })),
  };
}

