/**
 * Tisknutelné doklady: faktura vydaná (s QR platbou) a účtenka. Data pro
 * šablonu a výchozí rozvržení. Společná pole firmy pro všechny doklady.
 */
import { fromCents, percentOf, toCents, toScaled } from "@/core/money";
import { vatPayer } from "@/modules/tax/orders";
import type { DataApi, RecordData } from "@/core/module";
import { czIban, spayd, type PrintField, type PrintLayout, type PrintableDef } from "@/core/print";
import { paymentQrText } from "@/core/transform";
import { invoiceIsdoc } from "./isdoc";
import { addressLine, orgOf } from "@/modules/org";
import { accountingCurrencyId, ledgerRate } from "@/modules/gl/posting";
import { convertCents } from "@/modules/sys/currency";
import { receiptPrint } from "@/modules/pos/sale";
import { receiptData } from "@/lib/receipt-data";

const zero = BigInt(0);

export const COMPANY_FIELDS: PrintField[] = [
  { path: "company.name", label: "@PRT:CompanyName" },
  { path: "company.tradeName", label: "@PRT:TradeName" },
  { path: "company.address", label: "@PRT:CompanyAddress" },
  { path: "company.regNo", label: "@PRT:CompanyRegNo" },
  { path: "company.vatId", label: "@PRT:CompanyVatId" },
  { path: "company.registration", label: "@PRT:Registration" },
  { path: "company.bankAccount", label: "@PRT:BankAccount" },
  { path: "company.iban", label: "@PRT:Iban" },
  { path: "company.swift", label: "@PRT:Swift" },
  { path: "company.email", label: "@PRT:Email" },
  { path: "company.phone", label: "@PRT:Phone" },
  { path: "company.web", label: "@PRT:Web" },
];

/** SWIFT/BIC hlavních českých bank podle kódu banky (pro platby ze zahraničí). */
const BIC: Record<string, string> = {
  "0100": "KOMBCZPPXXX",
  "0300": "CEKOCZPPXXX",
  "0600": "AGBACZPPXXX",
  "0800": "GIBACZPXXXX",
  "2010": "FIOBCZPPXXX",
  "2250": "CTASCZ22XXX",
  "2700": "BACXCZPPXXX",
  "3030": "AIRACZPPXXX",
  "5500": "RZBCCZPPXXX",
  "6210": "BREXCZPPXXX",
};
const bicOf = (iban: string, accountNum: string) => {
  const code = /^CZ\d{2}(\d{4})/.exec(iban.replace(/\s/g, ""))?.[1] ?? /\/(\d{4})$/.exec(accountNum)?.[1] ?? "";
  return BIC[code] ?? "";
};

/**
 * Bankovní účet firmy pro platbu: účet v měně dokladu z Banky (faktura v EUR → eurový účet), jinak účet
 * z Organizace, jinak první účet v Bance bez měny.
 */
async function paymentAccount(data: DataApi, org: RecordData | null, currencyId?: string | null) {
  const out = (accountNum: string, iban: string) => ({ bankAccount: accountNum, iban, swift: bicOf(iban, accountNum) });
  let accs: RecordData[] = [];
  try {
    accs = (await data.find("bank.account", { blocked: false }, { take: 20, orderBy: { code: "asc" } })) as RecordData[];
  } catch {
    accs = []; // Banka není zapnutá
  }
  const base = await accountingCurrencyId(data, data.companyId ?? null);
  const foreign = !!currencyId && currencyId !== base;
  const cur = currencyId || base;
  const inCur = accs.filter((x) => (x.accountNum || x.iban) && ((x.currencyId as string) || base) === cur);
  // výchozí účet měny dokladu (Banka → Bankovní účty → Výchozí) má přednost
  const def = inCur.find((x) => x.isDefault);
  if (def) return out((def.accountNum as string) ?? "", (def.iban as string) || czIban(def.accountNum as string) || "");
  const same = inCur.find((x) => x.currencyId === currencyId);
  if (same && foreign) return out((same.accountNum as string) ?? "", (same.iban as string) || czIban(same.accountNum as string) || "");
  if (org?.bankAccount || org?.iban) return out((org.bankAccount as string) ?? "", (org.iban as string) || czIban(org.bankAccount as string) || "");
  const a = same ?? accs.find((x) => (x.accountNum || x.iban) && (!x.currencyId || x.currencyId === base)) ?? null;
  if (a) return out((a.accountNum as string) ?? "", (a.iban as string) || czIban(a.accountNum as string) || "");
  return { bankAccount: "", iban: "", swift: "" };
}

async function companyData(data: DataApi, companyId: string | null, currencyId?: string | null, bankAccountId?: string | null) {
  const org = (await orgOf(data)) as RecordData | null;
  const company = companyId ? await data.get("sys.company", companyId) : null;
  // účet zvolený na dokladu má přednost
  const chosen = bankAccountId ? await data.get("bank.account", bankAccountId).catch(() => null) : null;
  const pay = chosen
    ? { bankAccount: (chosen.accountNum as string) ?? "", iban: (chosen.iban as string) || czIban(chosen.accountNum as string) || "", swift: bicOf((chosen.iban as string) || czIban(chosen.accountNum as string) || "", (chosen.accountNum as string) ?? "") }
    : await paymentAccount(data, org, currencyId);
  const iban = pay.iban || null;
  return {
    name: String(org?.legalName ?? company?.name ?? ""),
    tradeName: org?.tradeName && org.tradeName !== org.legalName ? String(org.tradeName) : "",
    address: addressLine(org) ?? "",
    regNo: (org?.regNo ?? company?.regNo ?? "") as string,
    vatId: (org?.vatId ?? company?.vatId ?? "") as string,
    registration: (org?.registration ?? "") as string,
    bankAccount: pay.bankAccount,
    /** id přílohy loga (na data: URL ho převede printJob) */
    logoId: (org?.logo ?? "") as string,
    logo: "",
    iban: iban ?? "",
    swift: pay.swift,
    email: (org?.email ?? "") as string,
    phone: (org?.phone ?? "") as string,
    web: (org?.web ?? "") as string,
  };
}

/**
 * QR platba přes transformaci (Správa systému → Transformace, použití QR platba):
 * zapnutá transformace určí formát (SPAYD); vypnutá = žádný QR. Bez evidence
 * transformací (starší tenant) platí SPAYD.
 */
async function paymentQr(data: DataApi, p: Parameters<typeof spayd>[0]): Promise<string> {
  let list: RecordData[] = [];
  try {
    list = await data.find("sys.transformation", { purpose: "paymentQr" }, { take: 10 });
  } catch {
    list = [];
  }
  if (!list.length) return spayd(p);
  const t = list.find((x) => x.active !== false);
  return t ? paymentQrText(String(t.code), p) : "";
}

// ---------------------------------------------------------------------------
// Faktura vydaná
// ---------------------------------------------------------------------------

async function invoiceDataset(data: DataApi, companyId: string | null, id: string) {
  const inv = await data.get("ar.invoice", id);
  if (!inv) throw new Error("not found");
  const company = await companyData(data, companyId, (inv.currencyId as string) ?? null, (inv.bankAccountId as string) ?? null);
  const cust = await data.get("ar.customer", String(inv.customerId));
  // způsob úhrady: platební metoda faktury (převodem / hotově / kartou), jinak převodem
  const method = inv.paymentMethodId ? await data.get("bank.paymentMethod", String(inv.paymentMethodId)).catch(() => null) : null;
  const paymentMethod = method?.kind === "cash" ? "hotově" : method?.kind === "card" ? "kartou" : method?.code === "QR" ? "převodem (QR)" : "převodem";
  const subj = cust ? await data.get("gab.subject", String(cust.subjectId)) : null;
  const [addr] = subj ? await data.find("gab.address", { subjectId: subj.id }, { take: 1 }) : [];
  const cur = inv.currencyId ? await data.get("sys.currency", String(inv.currencyId)) : null;
  const currency = String(cur?.code ?? "CZK");
  // pořadí jako při zadání
  const lines = await data.find("ar.invoiceLine", { invoiceId: id }, { take: 1000, orderBy: { createdAt: "asc" } });
  const vat = new Map<string, { base: bigint; tax: bigint }>();
  const out: RecordData[] = [];
  for (const l of lines) {
    const code = l.taxCodeId ? await data.get("tax.taxCode", String(l.taxCodeId)) : null;
    const unit = l.unitId ? await data.get("inv.unit", String(l.unitId)) : null;
    const rate = String(Number(code?.rate ?? 0));
    const net = toCents(l.amountNet ?? 0);
    const tax = toCents(l.taxAmount ?? 0);
    const v = vat.get(rate) ?? { base: zero, tax: zero };
    v.base += net;
    v.tax += tax;
    vat.set(rate, v);
    // ceny včetně DPH: na daňovém dokladu jednotková cena bez daně (§ 29) = základ řádku / množství
    const q = toScaled(l.qty ?? 1, 4);
    const unitPrice = inv.pricesInclTax && q > zero ? fromCents((net * BigInt(10000) + q / BigInt(2)) / q) : l.unitPrice;
    out.push({ description: l.description ?? "", qty: l.qty, unit: unit?.code ?? "", unitPrice, rate, net: fromCents(net), tax: fromCents(tax), gross: fromCents(net + tax) });
  }
  const due = toCents(inv.amountGross ?? 0) - toCents(inv.paidAmount ?? 0);
  // faktura v cizí měně: DPH a celkem v Kč kurzem ČNB k DUZP (§ 29 ZDPH), jako při zaúčtování
  const baseCur = await accountingCurrencyId(data, companyId);
  let fx: { rate: string; tax: string; gross: string; vat: string } | null = null;
  if (inv.currencyId && inv.currencyId !== baseCur) {
    try {
      const r = await ledgerRate(data, companyId, String(inv.currencyId), String(inv.taxDate ?? inv.invoiceDate));
      const conv = (c: bigint) => convertCents(fromCents(c), r.rate, r.amount);
      const nf = (c: bigint) => new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(fromCents(c)));
      const rateTxt = new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(Number(r.rate));
      // daň v Kč ze základu přepočteného kurzem (§ 37 ZDPH) — stejně jako zaúčtování
      const rows = [...vat].map(([rate, v]) => {
        const baseAcc = conv(v.base);
        return { rate, baseAcc, taxAcc: v.tax === zero ? zero : percentOf(baseAcc, rate) };
      });
      const taxAcc = rows.reduce((a, x) => a + x.taxAcc, zero);
      const grossAcc = rows.reduce((a, x) => a + x.baseAcc, zero) + taxAcc + conv(toCents(inv.roundingAmount ?? 0));
      fx = {
        rate: `${rateTxt} CZK / ${r.amount} ${currency}`,
        tax: nf(taxAcc),
        gross: nf(grossAcc),
        vat: rows.filter((x) => x.taxAcc !== zero).map((x) => `DPH ${x.rate} % v CZK: ${nf(x.taxAcc)} (základ ${nf(x.baseAcc)})`).join("\n"),
      };
    } catch {
      fx = null; // kurz chybí — přepočet se nevytiskne
    }
  }
  const vs = String(inv.vs ?? String(inv.invoiceNum).replace(/\D/g, ""));
  return {
    company,
    doc: {
      // neplátce DPH nevystavuje daňový doklad
      title: (await vatPayer(data)) ? "FAKTURA – DAŇOVÝ DOKLAD" : "FAKTURA",
      number: inv.invoiceNum,
      date: inv.invoiceDate,
      taxDate: inv.taxDate ?? inv.invoiceDate,
      dueDate: inv.dueDate,
      vs,
      description: inv.description ?? "",
      currency,
      /** označení měny pro tisk (CZK → Kč) */
      currencySymbol: currency === "CZK" ? "Kč" : currency,
      paymentMethod,
      rounding: inv.roundingAmount ?? "0.00",
      /** cizí měna: kurz ČNB k DUZP, DPH a celkem v Kč */
      fx: fx ? "1" : "",
      fxRate: fx?.rate ?? "",
      fxTax: fx?.tax ?? "",
      fxVat: fx?.vat ?? "",
      fxGross: fx?.gross ?? "",
      net: inv.amountNet,
      tax: inv.taxAmount,
      gross: inv.amountGross,
      paid: inv.paidAmount,
      due: fromCents(due),
    },
    partner: {
      number: cust?.accountNum ?? "",
      name: subj?.name ?? "",
      regNo: subj?.regNo ?? "",
      vatId: subj?.vatId ?? "",
      address: addr ? [addr.street, [addr.zipCode, addr.city].filter(Boolean).join(" "), addr.country !== "CZ" ? addr.country : null].filter(Boolean).join(", ") : "",
    },
    lines: out,
    vat: [...vat].map(([rate, v]) => ({ rate, base: fromCents(v.base), tax: fromCents(v.tax), gross: fromCents(v.base + v.tax) })),
    // QR platba jen s IBAN a nezaplacenou částkou
    qr: company.iban && due > zero ? await paymentQr(data, { iban: company.iban, amount: fromCents(due), currency, vs, date: (inv.dueDate as string) ?? null, message: `Faktura ${inv.invoiceNum}` }) : "",
  };
}

const T = (id: string, x: number, y: number, w: number, h: number, text: string, style?: Record<string, unknown>) => ({ id, type: "text" as const, x, y, w, h, text, style });

/** Původní výchozí rozvržení (do 11/2026) — neupravené šablony se nahradí novým. */
const INK = "#1f2a37";
const ACCENT = "#1f4e79";
const MUTED = "#6b7280";
const PANEL = "#f3f5f8";

/**
 * Výchozí faktura (v6): číslo dokladu výrazně, nadpis střídmě; účet a VS seskupené a zvýrazněné; vzdušná tabulka
 * (Bez DPH / S DPH); rekapitulace a částka k úhradě hned pod tabulkou (delší tabulka je posune); větší QR.
 */
function invoiceLayout(): PrintLayout {
  const H = (id: string, x: number, y: number, w: number, text: string, color = MUTED) => T(id, x, y, w, 5, text, { size: 7, bold: true, color });
  return {
    paper: "a4",
    fontSize: 9,
    elements: [
      { id: "band", type: "rect", x: 0, y: 0, w: 210, h: 3, style: { fill: ACCENT, color: ACCENT } },
      { id: "logo", type: "image", x: 15, y: 11, w: 55, h: 20, field: "company.logo" },
      T("title", 105, 12, 90, 5, "{doc.title}", { size: 8, bold: true, align: "right", color: MUTED }),
      T("num", 105, 17, 90, 10, "{doc.number}", { size: 18, bold: true, align: "right", color: INK }),
      // dodavatel
      H("supH", 15, 37, 85, "DODAVATEL"),
      T("supN", 15, 42, 85, 5, "{company.name}", { size: 10, bold: true, color: INK }),
      T("supA", 15, 47, 85, 9, "{company.address}", { size: 9, color: INK }),
      T("supL", 15, 56, 12, 9, "IČO:\nDIČ:", { size: 9, color: MUTED }),
      T("supV", 27, 56, 73, 9, "{company.regNo}\n{company.vatId}", { size: 9, color: INK }),
      T("supR", 15, 65, 85, 5, "{company.registration}", { size: 7.5, color: MUTED }),
      // odběratel
      { id: "custBox", type: "rect", x: 106, y: 35, w: 89, h: 35, style: { fill: PANEL, color: PANEL } },
      H("custH", 110, 37, 82, "ODBĚRATEL"),
      T("custN", 110, 42, 82, 5, "{partner.name}", { size: 10, bold: true, color: INK }),
      T("custA", 110, 47, 82, 9, "{partner.address}", { size: 9, color: INK }),
      T("custL", 110, 56, 12, 9, "IČO:\nDIČ:", { size: 9, color: MUTED }),
      T("custV", 122, 56, 70, 9, "{partner.regNo}\n{partner.vatId}", { size: 9, color: INK }),
      // data dokladu
      H("k1h", 15, 76, 42, "DATUM VYSTAVENÍ"),
      T("k1", 15, 81, 42, 6, "{doc.date:date}", { size: 10, color: INK }),
      H("k2h", 60, 76, 42, "DATUM ZDAN. PLNĚNÍ"),
      T("k2", 60, 81, 42, 6, "{doc.taxDate:date}", { size: 10, color: INK }),
      H("k3h", 106, 76, 42, "DATUM SPLATNOSTI"),
      T("k3", 106, 81, 42, 6, "{doc.dueDate:date}", { size: 10, bold: true, color: ACCENT }),
      H("k4h", 152, 76, 43, "ZPŮSOB ÚHRADY"),
      T("k4", 152, 81, 43, 6, "{doc.paymentMethod}", { size: 10, color: INK }),
      // platební údaje pohromadě a výrazně (ruční platba)
      { id: "payBox", type: "rect", x: 15, y: 90, w: 180, h: 17, style: { fill: PANEL, color: PANEL } },
      H("payH", 19, 92, 80, "BANKOVNÍ ÚČET"),
      T("pay", 19, 97, 80, 6, "{company.bankAccount}", { size: 12, bold: true, color: INK }),
      T("iban", 19, 103, 85, 4, "IBAN {company.iban}   SWIFT {company.swift}", { size: 7, color: MUTED }),
      H("vsH", 106, 92, 45, "VARIABILNÍ SYMBOL"),
      T("vs", 106, 97, 45, 6, "{doc.vs}", { size: 12, bold: true, color: INK }),
      T("desc", 15, 111, 180, 6, "{doc.description}", { italic: true, color: INK }),
      {
        id: "lines",
        type: "table",
        x: 15,
        y: 118,
        w: 180,
        // tabulka do 44 mm; delší posune rekapitulaci a souhrn níž (případně na další stranu)
        h: 44,
        style: { fill: ACCENT, color: "#ffffff", size: 9, rowPad: 1.8 },
        columns: [
          { field: "description", label: "Položka", width: 62 },
          { field: "qty", label: "Množství", width: 22, align: "right", format: "qty" },
          { field: "unit", label: "MJ", width: 12 },
          { field: "unitPrice", label: "Cena za MJ", width: 22, align: "right", format: "money" },
          { field: "rate", label: "DPH", width: 12, align: "right", format: "percent" },
          { field: "net", label: "Bez DPH", width: 25, align: "right", format: "money" },
          { field: "gross", label: "S DPH", width: 25, align: "right", format: "money" },
        ],
      },
      // souhrn hned pod tabulkou
      H("vatH", 15, 168, 90, "REKAPITULACE DPH"),
      {
        id: "vat",
        type: "vat",
        x: 15,
        y: 173,
        w: 90,
        h: 20,
        style: { fill: PANEL, size: 8, rowPad: 1 },
        columns: [
          { field: "rate", label: "Sazba", width: 18, align: "right", format: "percent" },
          { field: "base", label: "Bez DPH", width: 24, align: "right", format: "money" },
          { field: "tax", label: "DPH", width: 22, align: "right", format: "money" },
          { field: "gross", label: "S DPH", width: 26, align: "right", format: "money" },
        ],
      },
      { id: "totBox", type: "rect", x: 118, y: 168, w: 77, h: 21, style: { fill: ACCENT, color: ACCENT } },
      T("totH", 121, 170, 71, 5, "K ÚHRADĚ", { size: 7.5, bold: true, color: "#dbe7f3", align: "right" }),
      T("tot", 121, 175, 71, 9, "{doc.due:money} {doc.currencySymbol}", { size: 17, bold: true, color: "#ffffff", align: "right" }),
      T("totS", 121, 183, 71, 5, "včetně DPH", { size: 7.5, color: "#dbe7f3", align: "right" }),
      // zaokrouhlení (Kč na celé koruny) a u cizí měny přepočet do Kč kurzem ČNB k DUZP (§ 29 ZDPH)
      { ...T("rnd", 15, 196, 90, 5, "Zaokrouhlení: {doc.rounding:money} {doc.currencySymbol}", { size: 8, color: MUTED }), showIf: "doc.rounding" },
      { ...T("fxH", 15, 202, 90, 5, "PŘEPOČET DO CZK", { size: 7, bold: true, color: MUTED }), showIf: "doc.fx" },
      { ...T("fx", 15, 207, 90, 14, "Kurz ČNB k DUZP: {doc.fxRate}\n{doc.fxVat}\nCelkem s DPH: {doc.fxGross} CZK", { size: 8, color: INK }), showIf: "doc.fx" },
      { id: "qr", type: "qr", x: 159, y: 194, w: 36, h: 36, field: "qr" },
      // popisek jen s QR kódem (transformace QR platba zapnutá, účet, nezaplaceno)
      { ...T("qrT", 118, 208, 38, 8, "QR platba", { size: 8, bold: true, align: "right", color: MUTED }), showIf: "qr" },
      { id: "footLine", type: "line", x: 15, y: 284, w: 180, h: 1, style: { color: "#d1d5db" } },
      T("foot", 15, 286, 180, 5, "{company.email}   {company.phone}   {company.web}", { size: 7.5, color: MUTED, align: "center" }),
    ],
  };
}

/** Rozvržení v5 (15. 11. 2026, způsob úhrady napevno „převodem“). */
/** Faktura v6 (do 17. 11. 2026, nadpis vždy daňový doklad) — neupravené šablony se převedou. */
export function invoiceLayoutV6(): PrintLayout {
  const H = (id: string, x: number, y: number, w: number, text: string, color = MUTED) => T(id, x, y, w, 5, text, { size: 7, bold: true, color });
  return {
    paper: "a4",
    fontSize: 9,
    elements: [
      { id: "band", type: "rect", x: 0, y: 0, w: 210, h: 3, style: { fill: ACCENT, color: ACCENT } },
      { id: "logo", type: "image", x: 15, y: 11, w: 55, h: 20, field: "company.logo" },
      T("title", 105, 12, 90, 5, "FAKTURA – DAŇOVÝ DOKLAD", { size: 8, bold: true, align: "right", color: MUTED }),
      T("num", 105, 17, 90, 10, "{doc.number}", { size: 18, bold: true, align: "right", color: INK }),
      // dodavatel
      H("supH", 15, 37, 85, "DODAVATEL"),
      T("supN", 15, 42, 85, 5, "{company.name}", { size: 10, bold: true, color: INK }),
      T("supA", 15, 47, 85, 9, "{company.address}", { size: 9, color: INK }),
      T("supL", 15, 56, 12, 9, "IČO:\nDIČ:", { size: 9, color: MUTED }),
      T("supV", 27, 56, 73, 9, "{company.regNo}\n{company.vatId}", { size: 9, color: INK }),
      T("supR", 15, 65, 85, 5, "{company.registration}", { size: 7.5, color: MUTED }),
      // odběratel
      { id: "custBox", type: "rect", x: 106, y: 35, w: 89, h: 35, style: { fill: PANEL, color: PANEL } },
      H("custH", 110, 37, 82, "ODBĚRATEL"),
      T("custN", 110, 42, 82, 5, "{partner.name}", { size: 10, bold: true, color: INK }),
      T("custA", 110, 47, 82, 9, "{partner.address}", { size: 9, color: INK }),
      T("custL", 110, 56, 12, 9, "IČO:\nDIČ:", { size: 9, color: MUTED }),
      T("custV", 122, 56, 70, 9, "{partner.regNo}\n{partner.vatId}", { size: 9, color: INK }),
      // data dokladu
      H("k1h", 15, 76, 42, "DATUM VYSTAVENÍ"),
      T("k1", 15, 81, 42, 6, "{doc.date:date}", { size: 10, color: INK }),
      H("k2h", 60, 76, 42, "DATUM ZDAN. PLNĚNÍ"),
      T("k2", 60, 81, 42, 6, "{doc.taxDate:date}", { size: 10, color: INK }),
      H("k3h", 106, 76, 42, "DATUM SPLATNOSTI"),
      T("k3", 106, 81, 42, 6, "{doc.dueDate:date}", { size: 10, bold: true, color: ACCENT }),
      H("k4h", 152, 76, 43, "ZPŮSOB ÚHRADY"),
      T("k4", 152, 81, 43, 6, "{doc.paymentMethod}", { size: 10, color: INK }),
      // platební údaje pohromadě a výrazně (ruční platba)
      { id: "payBox", type: "rect", x: 15, y: 90, w: 180, h: 17, style: { fill: PANEL, color: PANEL } },
      H("payH", 19, 92, 80, "BANKOVNÍ ÚČET"),
      T("pay", 19, 97, 80, 6, "{company.bankAccount}", { size: 12, bold: true, color: INK }),
      T("iban", 19, 103, 85, 4, "IBAN {company.iban}   SWIFT {company.swift}", { size: 7, color: MUTED }),
      H("vsH", 106, 92, 45, "VARIABILNÍ SYMBOL"),
      T("vs", 106, 97, 45, 6, "{doc.vs}", { size: 12, bold: true, color: INK }),
      T("desc", 15, 111, 180, 6, "{doc.description}", { italic: true, color: INK }),
      {
        id: "lines",
        type: "table",
        x: 15,
        y: 118,
        w: 180,
        // tabulka do 44 mm; delší posune rekapitulaci a souhrn níž (případně na další stranu)
        h: 44,
        style: { fill: ACCENT, color: "#ffffff", size: 9, rowPad: 1.8 },
        columns: [
          { field: "description", label: "Položka", width: 62 },
          { field: "qty", label: "Množství", width: 22, align: "right", format: "qty" },
          { field: "unit", label: "MJ", width: 12 },
          { field: "unitPrice", label: "Cena za MJ", width: 22, align: "right", format: "money" },
          { field: "rate", label: "DPH", width: 12, align: "right", format: "percent" },
          { field: "net", label: "Bez DPH", width: 25, align: "right", format: "money" },
          { field: "gross", label: "S DPH", width: 25, align: "right", format: "money" },
        ],
      },
      // souhrn hned pod tabulkou
      H("vatH", 15, 168, 90, "REKAPITULACE DPH"),
      {
        id: "vat",
        type: "vat",
        x: 15,
        y: 173,
        w: 90,
        h: 20,
        style: { fill: PANEL, size: 8, rowPad: 1 },
        columns: [
          { field: "rate", label: "Sazba", width: 18, align: "right", format: "percent" },
          { field: "base", label: "Bez DPH", width: 24, align: "right", format: "money" },
          { field: "tax", label: "DPH", width: 22, align: "right", format: "money" },
          { field: "gross", label: "S DPH", width: 26, align: "right", format: "money" },
        ],
      },
      { id: "totBox", type: "rect", x: 118, y: 168, w: 77, h: 21, style: { fill: ACCENT, color: ACCENT } },
      T("totH", 121, 170, 71, 5, "K ÚHRADĚ", { size: 7.5, bold: true, color: "#dbe7f3", align: "right" }),
      T("tot", 121, 175, 71, 9, "{doc.due:money} {doc.currencySymbol}", { size: 17, bold: true, color: "#ffffff", align: "right" }),
      T("totS", 121, 183, 71, 5, "včetně DPH", { size: 7.5, color: "#dbe7f3", align: "right" }),
      // zaokrouhlení (Kč na celé koruny) a u cizí měny přepočet do Kč kurzem ČNB k DUZP (§ 29 ZDPH)
      { ...T("rnd", 15, 196, 90, 5, "Zaokrouhlení: {doc.rounding:money} {doc.currencySymbol}", { size: 8, color: MUTED }), showIf: "doc.rounding" },
      { ...T("fxH", 15, 202, 90, 5, "PŘEPOČET DO CZK", { size: 7, bold: true, color: MUTED }), showIf: "doc.fx" },
      { ...T("fx", 15, 207, 90, 14, "Kurz ČNB k DUZP: {doc.fxRate}\n{doc.fxVat}\nCelkem s DPH: {doc.fxGross} CZK", { size: 8, color: INK }), showIf: "doc.fx" },
      { id: "qr", type: "qr", x: 159, y: 194, w: 36, h: 36, field: "qr" },
      // popisek jen s QR kódem (transformace QR platba zapnutá, účet, nezaplaceno)
      { ...T("qrT", 118, 208, 38, 8, "QR platba", { size: 8, bold: true, align: "right", color: MUTED }), showIf: "qr" },
      { id: "footLine", type: "line", x: 15, y: 284, w: 180, h: 1, style: { color: "#d1d5db" } },
      T("foot", 15, 286, 180, 5, "{company.email}   {company.phone}   {company.web}", { size: 7.5, color: MUTED, align: "center" }),
    ],
  };
}

/** Rozvržení v5 (15. 11. 2026, způsob úhrady napevno „převodem“). */

export function invoiceLayoutV5(): PrintLayout {
  const H = (id: string, x: number, y: number, w: number, text: string, color = MUTED) => T(id, x, y, w, 5, text, { size: 7, bold: true, color });
  return {
    paper: "a4",
    fontSize: 9,
    elements: [
      { id: "band", type: "rect", x: 0, y: 0, w: 210, h: 3, style: { fill: ACCENT, color: ACCENT } },
      { id: "logo", type: "image", x: 15, y: 11, w: 55, h: 20, field: "company.logo" },
      T("title", 105, 12, 90, 5, "FAKTURA – DAŇOVÝ DOKLAD", { size: 8, bold: true, align: "right", color: MUTED }),
      T("num", 105, 17, 90, 10, "{doc.number}", { size: 18, bold: true, align: "right", color: INK }),
      // dodavatel
      H("supH", 15, 37, 85, "DODAVATEL"),
      T("supN", 15, 42, 85, 5, "{company.name}", { size: 10, bold: true, color: INK }),
      T("supA", 15, 47, 85, 9, "{company.address}", { size: 9, color: INK }),
      T("supL", 15, 56, 12, 9, "IČO:\nDIČ:", { size: 9, color: MUTED }),
      T("supV", 27, 56, 73, 9, "{company.regNo}\n{company.vatId}", { size: 9, color: INK }),
      T("supR", 15, 65, 85, 5, "{company.registration}", { size: 7.5, color: MUTED }),
      // odběratel
      { id: "custBox", type: "rect", x: 106, y: 35, w: 89, h: 35, style: { fill: PANEL, color: PANEL } },
      H("custH", 110, 37, 82, "ODBĚRATEL"),
      T("custN", 110, 42, 82, 5, "{partner.name}", { size: 10, bold: true, color: INK }),
      T("custA", 110, 47, 82, 9, "{partner.address}", { size: 9, color: INK }),
      T("custL", 110, 56, 12, 9, "IČO:\nDIČ:", { size: 9, color: MUTED }),
      T("custV", 122, 56, 70, 9, "{partner.regNo}\n{partner.vatId}", { size: 9, color: INK }),
      // data dokladu
      H("k1h", 15, 76, 42, "DATUM VYSTAVENÍ"),
      T("k1", 15, 81, 42, 6, "{doc.date:date}", { size: 10, color: INK }),
      H("k2h", 60, 76, 42, "DATUM ZDAN. PLNĚNÍ"),
      T("k2", 60, 81, 42, 6, "{doc.taxDate:date}", { size: 10, color: INK }),
      H("k3h", 106, 76, 42, "DATUM SPLATNOSTI"),
      T("k3", 106, 81, 42, 6, "{doc.dueDate:date}", { size: 10, bold: true, color: ACCENT }),
      H("k4h", 152, 76, 43, "ZPŮSOB ÚHRADY"),
      T("k4", 152, 81, 43, 6, "převodem", { size: 10, color: INK }),
      // platební údaje pohromadě a výrazně (ruční platba)
      { id: "payBox", type: "rect", x: 15, y: 90, w: 180, h: 17, style: { fill: PANEL, color: PANEL } },
      H("payH", 19, 92, 80, "BANKOVNÍ ÚČET"),
      T("pay", 19, 97, 80, 6, "{company.bankAccount}", { size: 12, bold: true, color: INK }),
      T("iban", 19, 103, 85, 4, "IBAN {company.iban}   SWIFT {company.swift}", { size: 7, color: MUTED }),
      H("vsH", 106, 92, 45, "VARIABILNÍ SYMBOL"),
      T("vs", 106, 97, 45, 6, "{doc.vs}", { size: 12, bold: true, color: INK }),
      T("desc", 15, 111, 180, 6, "{doc.description}", { italic: true, color: INK }),
      {
        id: "lines",
        type: "table",
        x: 15,
        y: 118,
        w: 180,
        // tabulka do 44 mm; delší posune rekapitulaci a souhrn níž (případně na další stranu)
        h: 44,
        style: { fill: ACCENT, color: "#ffffff", size: 9, rowPad: 1.8 },
        columns: [
          { field: "description", label: "Položka", width: 62 },
          { field: "qty", label: "Množství", width: 22, align: "right", format: "qty" },
          { field: "unit", label: "MJ", width: 12 },
          { field: "unitPrice", label: "Cena za MJ", width: 22, align: "right", format: "money" },
          { field: "rate", label: "DPH", width: 12, align: "right", format: "percent" },
          { field: "net", label: "Bez DPH", width: 25, align: "right", format: "money" },
          { field: "gross", label: "S DPH", width: 25, align: "right", format: "money" },
        ],
      },
      // souhrn hned pod tabulkou
      H("vatH", 15, 168, 90, "REKAPITULACE DPH"),
      {
        id: "vat",
        type: "vat",
        x: 15,
        y: 173,
        w: 90,
        h: 20,
        style: { fill: PANEL, size: 8, rowPad: 1 },
        columns: [
          { field: "rate", label: "Sazba", width: 18, align: "right", format: "percent" },
          { field: "base", label: "Bez DPH", width: 24, align: "right", format: "money" },
          { field: "tax", label: "DPH", width: 22, align: "right", format: "money" },
          { field: "gross", label: "S DPH", width: 26, align: "right", format: "money" },
        ],
      },
      { id: "totBox", type: "rect", x: 118, y: 168, w: 77, h: 21, style: { fill: ACCENT, color: ACCENT } },
      T("totH", 121, 170, 71, 5, "K ÚHRADĚ", { size: 7.5, bold: true, color: "#dbe7f3", align: "right" }),
      T("tot", 121, 175, 71, 9, "{doc.due:money} {doc.currencySymbol}", { size: 17, bold: true, color: "#ffffff", align: "right" }),
      T("totS", 121, 183, 71, 5, "včetně DPH", { size: 7.5, color: "#dbe7f3", align: "right" }),
      // zaokrouhlení (Kč na celé koruny) a u cizí měny přepočet do Kč kurzem ČNB k DUZP (§ 29 ZDPH)
      { ...T("rnd", 15, 196, 90, 5, "Zaokrouhlení: {doc.rounding:money} {doc.currencySymbol}", { size: 8, color: MUTED }), showIf: "doc.rounding" },
      { ...T("fxH", 15, 202, 90, 5, "PŘEPOČET DO CZK", { size: 7, bold: true, color: MUTED }), showIf: "doc.fx" },
      { ...T("fx", 15, 207, 90, 14, "Kurz ČNB k DUZP: {doc.fxRate}\n{doc.fxVat}\nCelkem s DPH: {doc.fxGross} CZK", { size: 8, color: INK }), showIf: "doc.fx" },
      { id: "qr", type: "qr", x: 159, y: 194, w: 36, h: 36, field: "qr" },
      // popisek jen s QR kódem (transformace QR platba zapnutá, účet, nezaplaceno)
      { ...T("qrT", 118, 208, 38, 8, "QR platba", { size: 8, bold: true, align: "right", color: MUTED }), showIf: "qr" },
      { id: "footLine", type: "line", x: 15, y: 284, w: 180, h: 1, style: { color: "#d1d5db" } },
      T("foot", 15, 286, 180, 5, "{company.email}   {company.phone}   {company.web}", { size: 7.5, color: MUTED, align: "center" }),
    ],
  };
}


/** Rozvržení v4 (15. 11. 2026, podle zpětné vazby, bez přepočtu do Kč). */
export function invoiceLayoutV4(): PrintLayout {
  const H = (id: string, x: number, y: number, w: number, text: string, color = MUTED) => T(id, x, y, w, 5, text, { size: 7, bold: true, color });
  return {
    paper: "a4",
    fontSize: 9,
    elements: [
      { id: "band", type: "rect", x: 0, y: 0, w: 210, h: 3, style: { fill: ACCENT, color: ACCENT } },
      { id: "logo", type: "image", x: 15, y: 11, w: 55, h: 20, field: "company.logo" },
      T("title", 105, 12, 90, 5, "FAKTURA – DAŇOVÝ DOKLAD", { size: 8, bold: true, align: "right", color: MUTED }),
      T("num", 105, 17, 90, 10, "{doc.number}", { size: 18, bold: true, align: "right", color: INK }),
      // dodavatel
      H("supH", 15, 37, 85, "DODAVATEL"),
      T("supN", 15, 42, 85, 5, "{company.name}", { size: 10, bold: true, color: INK }),
      T("supA", 15, 47, 85, 9, "{company.address}", { size: 9, color: INK }),
      T("supL", 15, 56, 12, 9, "IČO:\nDIČ:", { size: 9, color: MUTED }),
      T("supV", 27, 56, 73, 9, "{company.regNo}\n{company.vatId}", { size: 9, color: INK }),
      T("supR", 15, 65, 85, 5, "{company.registration}", { size: 7.5, color: MUTED }),
      // odběratel
      { id: "custBox", type: "rect", x: 106, y: 35, w: 89, h: 35, style: { fill: PANEL, color: PANEL } },
      H("custH", 110, 37, 82, "ODBĚRATEL"),
      T("custN", 110, 42, 82, 5, "{partner.name}", { size: 10, bold: true, color: INK }),
      T("custA", 110, 47, 82, 9, "{partner.address}", { size: 9, color: INK }),
      T("custL", 110, 56, 12, 9, "IČO:\nDIČ:", { size: 9, color: MUTED }),
      T("custV", 122, 56, 70, 9, "{partner.regNo}\n{partner.vatId}", { size: 9, color: INK }),
      // data dokladu
      H("k1h", 15, 76, 42, "DATUM VYSTAVENÍ"),
      T("k1", 15, 81, 42, 6, "{doc.date:date}", { size: 10, color: INK }),
      H("k2h", 60, 76, 42, "DATUM ZDAN. PLNĚNÍ"),
      T("k2", 60, 81, 42, 6, "{doc.taxDate:date}", { size: 10, color: INK }),
      H("k3h", 106, 76, 42, "DATUM SPLATNOSTI"),
      T("k3", 106, 81, 42, 6, "{doc.dueDate:date}", { size: 10, bold: true, color: ACCENT }),
      H("k4h", 152, 76, 43, "ZPŮSOB ÚHRADY"),
      T("k4", 152, 81, 43, 6, "převodem", { size: 10, color: INK }),
      // platební údaje pohromadě a výrazně (ruční platba)
      { id: "payBox", type: "rect", x: 15, y: 90, w: 180, h: 17, style: { fill: PANEL, color: PANEL } },
      H("payH", 19, 92, 80, "BANKOVNÍ ÚČET"),
      T("pay", 19, 97, 80, 6, "{company.bankAccount}", { size: 12, bold: true, color: INK }),
      T("iban", 19, 103, 80, 4, "IBAN {company.iban}", { size: 7, color: MUTED }),
      H("vsH", 106, 92, 45, "VARIABILNÍ SYMBOL"),
      T("vs", 106, 97, 45, 6, "{doc.vs}", { size: 12, bold: true, color: INK }),
      T("desc", 15, 111, 180, 6, "{doc.description}", { italic: true, color: INK }),
      {
        id: "lines",
        type: "table",
        x: 15,
        y: 118,
        w: 180,
        // tabulka do 44 mm; delší posune rekapitulaci a souhrn níž (případně na další stranu)
        h: 44,
        style: { fill: ACCENT, color: "#ffffff", size: 9, rowPad: 1.8 },
        columns: [
          { field: "description", label: "Položka", width: 62 },
          { field: "qty", label: "Množství", width: 22, align: "right", format: "qty" },
          { field: "unit", label: "MJ", width: 12 },
          { field: "unitPrice", label: "Cena za MJ", width: 22, align: "right", format: "money" },
          { field: "rate", label: "DPH", width: 12, align: "right", format: "percent" },
          { field: "net", label: "Bez DPH", width: 25, align: "right", format: "money" },
          { field: "gross", label: "S DPH", width: 25, align: "right", format: "money" },
        ],
      },
      // souhrn hned pod tabulkou
      H("vatH", 15, 168, 90, "REKAPITULACE DPH"),
      {
        id: "vat",
        type: "vat",
        x: 15,
        y: 173,
        w: 90,
        h: 20,
        style: { fill: PANEL, size: 8, rowPad: 1 },
        columns: [
          { field: "rate", label: "Sazba", width: 18, align: "right", format: "percent" },
          { field: "base", label: "Bez DPH", width: 24, align: "right", format: "money" },
          { field: "tax", label: "DPH", width: 22, align: "right", format: "money" },
          { field: "gross", label: "S DPH", width: 26, align: "right", format: "money" },
        ],
      },
      { id: "totBox", type: "rect", x: 118, y: 168, w: 77, h: 21, style: { fill: ACCENT, color: ACCENT } },
      T("totH", 121, 170, 71, 5, "K ÚHRADĚ", { size: 7.5, bold: true, color: "#dbe7f3", align: "right" }),
      T("tot", 121, 175, 71, 9, "{doc.due:money} {doc.currencySymbol}", { size: 17, bold: true, color: "#ffffff", align: "right" }),
      T("totS", 121, 183, 71, 5, "včetně DPH", { size: 7.5, color: "#dbe7f3", align: "right" }),
      { id: "qr", type: "qr", x: 159, y: 194, w: 36, h: 36, field: "qr" },
      // popisek jen s QR kódem (transformace QR platba zapnutá, účet, nezaplaceno)
      { ...T("qrT", 118, 208, 38, 8, "QR platba", { size: 8, bold: true, align: "right", color: MUTED }), showIf: "qr" },
      { id: "footLine", type: "line", x: 15, y: 284, w: 180, h: 1, style: { color: "#d1d5db" } },
      T("foot", 15, 286, 180, 5, "{company.email}   {company.phone}   {company.web}", { size: 7.5, color: MUTED, align: "center" }),
    ],
  };
}


/** Rozvržení v3 (15. 11. 2026, před úpravou podle zpětné vazby). */
export function invoiceLayoutV3(): PrintLayout {
  const H = (id: string, x: number, y: number, w: number, text: string, color = INK) => T(id, x, y, w, 5, text, { size: 7.5, bold: true, color });
  return {
    paper: "a4",
    fontSize: 9,
    elements: [
      { id: "band", type: "rect", x: 0, y: 0, w: 210, h: 3, style: { fill: ACCENT, color: ACCENT } },
      { id: "logo", type: "image", x: 15, y: 11, w: 55, h: 20, field: "company.logo" },
      T("title", 105, 11, 90, 10, "FAKTURA", { size: 22, bold: true, align: "right", color: ACCENT }),
      T("sub", 105, 21, 90, 6, "daňový doklad č. {doc.number}", { size: 11, bold: true, align: "right", color: INK }),
      // dodavatel
      H("supH", 15, 37, 85, "DODAVATEL"),
      T("supN", 15, 42, 85, 5, "{company.name}", { size: 10, bold: true, color: INK }),
      T("supA", 15, 47, 85, 9, "{company.address}", { size: 9, color: INK }),
      T("supL", 15, 56, 12, 9, "IČO:\nDIČ:", { size: 9, bold: true, color: INK }),
      T("supV", 27, 56, 73, 9, "{company.regNo}\n{company.vatId}", { size: 9, color: INK }),
      T("supR", 15, 65, 85, 5, "{company.registration}", { size: 7.5, color: MUTED }),
      // odběratel
      { id: "custBox", type: "rect", x: 106, y: 35, w: 89, h: 35, style: { fill: PANEL, color: PANEL } },
      H("custH", 110, 37, 82, "ODBĚRATEL"),
      T("custN", 110, 42, 82, 5, "{partner.name}", { size: 10, bold: true, color: INK }),
      T("custA", 110, 47, 82, 9, "{partner.address}", { size: 9, color: INK }),
      T("custL", 110, 56, 12, 9, "IČO:\nDIČ:", { size: 9, bold: true, color: INK }),
      T("custV", 122, 56, 70, 9, "{partner.regNo}\n{partner.vatId}", { size: 9, color: INK }),
      // klíčové údaje v řadě
      H("k1h", 15, 75, 42, "DATUM VYSTAVENÍ", MUTED),
      T("k1", 15, 80, 42, 6, "{doc.date:date}", { size: 10, bold: true, color: INK }),
      H("k2h", 60, 75, 42, "DATUM ZDAN. PLNĚNÍ", MUTED),
      T("k2", 60, 80, 42, 6, "{doc.taxDate:date}", { size: 10, bold: true, color: INK }),
      H("k3h", 106, 75, 42, "SPLATNOST", MUTED),
      T("k3", 106, 80, 42, 6, "{doc.dueDate:date}", { size: 10, bold: true, color: ACCENT }),
      H("k4h", 152, 75, 43, "VARIABILNÍ SYMBOL", MUTED),
      T("k4", 152, 80, 43, 6, "{doc.vs}", { size: 10, bold: true, color: INK }),
      { id: "sep", type: "line", x: 15, y: 89, w: 180, h: 1, style: { color: "#d1d5db" } },
      T("payL", 15, 91, 28, 5, "Bankovní účet:", { size: 8, bold: true, color: INK }),
      T("pay", 43, 91, 152, 5, "{company.bankAccount}   ·   IBAN {company.iban}   ·   úhrada převodem", { size: 8, color: INK }),
      T("desc", 15, 97, 180, 6, "{doc.description}", { italic: true, color: INK }),
      {
        id: "lines",
        type: "table",
        x: 15,
        y: 104,
        w: 180,
        // tabulka smí sahat až k souhrnu; delší přeteče a souhrn se posune (případně na další stranu)
        h: 120,
        style: { fill: ACCENT, color: "#ffffff", size: 8.5 },
        columns: [
          { field: "description", label: "Položka", width: 70 },
          { field: "qty", label: "Množství", width: 18, align: "right", format: "qty" },
          { field: "unit", label: "MJ", width: 10 },
          { field: "unitPrice", label: "Cena/MJ", width: 22, align: "right", format: "money" },
          { field: "rate", label: "DPH %", width: 14, align: "right" },
          { field: "net", label: "Základ", width: 23, align: "right", format: "money" },
          { field: "gross", label: "Celkem", width: 23, align: "right", format: "money" },
        ],
      },
      // souhrn v dolní části A4
      H("vatH", 15, 229, 90, "REKAPITULACE DPH"),
      {
        id: "vat",
        type: "vat",
        x: 15,
        y: 234,
        w: 90,
        h: 20,
        style: { fill: PANEL, size: 8 },
        columns: [
          { field: "rate", label: "Sazba %", width: 18, align: "right" },
          { field: "base", label: "Základ", width: 24, align: "right", format: "money" },
          { field: "tax", label: "DPH", width: 22, align: "right", format: "money" },
          { field: "gross", label: "Celkem", width: 26, align: "right", format: "money" },
        ],
      },
      { id: "totBox", type: "rect", x: 118, y: 229, w: 77, h: 22, style: { fill: ACCENT, color: ACCENT } },
      T("totH", 121, 231, 71, 5, "K ÚHRADĚ", { size: 7.5, bold: true, color: "#dbe7f3", align: "right" }),
      T("tot", 121, 236, 71, 9, "{doc.due:money} {doc.currency}", { size: 17, bold: true, color: "#ffffff", align: "right" }),
      T("totS", 121, 245, 71, 5, "celkem s DPH {doc.gross:money} {doc.currency}", { size: 7.5, color: "#dbe7f3", align: "right" }),
      { id: "qr", type: "qr", x: 167, y: 254, w: 28, h: 28, field: "qr" },
      // popisek jen s QR kódem (transformace QR platba zapnutá, účet, nezaplaceno)
      { ...T("qrT", 118, 262, 47, 12, "QR platba\nnaskenujte v bankovní aplikaci", { size: 7.5, bold: true, align: "right", color: MUTED }), showIf: "qr" },
      { id: "footLine", type: "line", x: 15, y: 284, w: 180, h: 1, style: { color: "#d1d5db" } },
      T("foot", 15, 286, 180, 5, "{company.email}   {company.phone}   {company.web}", { size: 7.5, color: MUTED, align: "center" }),
    ],
  };
}

/** Moderní rozvržení v2 (14. 11. 2026). */
export function invoiceLayoutV2(): PrintLayout {
  const H = (id: string, x: number, y: number, w: number, text: string, color = INK) => T(id, x, y, w, 5, text, { size: 7.5, bold: true, color });
  return {
    paper: "a4",
    fontSize: 9,
    elements: [
      { id: "band", type: "rect", x: 0, y: 0, w: 210, h: 3, style: { fill: ACCENT, color: ACCENT } },
      { id: "logo", type: "image", x: 15, y: 11, w: 55, h: 20, field: "company.logo" },
      T("title", 105, 11, 90, 10, "FAKTURA", { size: 22, bold: true, align: "right", color: ACCENT }),
      T("sub", 105, 21, 90, 6, "daňový doklad č. {doc.number}", { size: 11, bold: true, align: "right", color: INK }),
      // dodavatel
      H("supH", 15, 37, 85, "DODAVATEL"),
      T("supN", 15, 42, 85, 5, "{company.name}", { size: 10, bold: true, color: INK }),
      T("supA", 15, 47, 85, 9, "{company.address}", { size: 9, color: INK }),
      T("supL", 15, 56, 12, 9, "IČO:\nDIČ:", { size: 9, bold: true, color: INK }),
      T("supV", 27, 56, 73, 9, "{company.regNo}\n{company.vatId}", { size: 9, color: INK }),
      T("supR", 15, 65, 85, 5, "{company.registration}", { size: 7.5, color: MUTED }),
      // odběratel
      { id: "custBox", type: "rect", x: 106, y: 35, w: 89, h: 35, style: { fill: PANEL, color: PANEL } },
      H("custH", 110, 37, 82, "ODBĚRATEL"),
      T("custN", 110, 42, 82, 5, "{partner.name}", { size: 10, bold: true, color: INK }),
      T("custA", 110, 47, 82, 9, "{partner.address}", { size: 9, color: INK }),
      T("custL", 110, 56, 12, 9, "IČO:\nDIČ:", { size: 9, bold: true, color: INK }),
      T("custV", 122, 56, 70, 9, "{partner.regNo}\n{partner.vatId}", { size: 9, color: INK }),
      // klíčové údaje v řadě
      H("k1h", 15, 75, 42, "DATUM VYSTAVENÍ", MUTED),
      T("k1", 15, 80, 42, 6, "{doc.date:date}", { size: 10, bold: true, color: INK }),
      H("k2h", 60, 75, 42, "DATUM ZDAN. PLNĚNÍ", MUTED),
      T("k2", 60, 80, 42, 6, "{doc.taxDate:date}", { size: 10, bold: true, color: INK }),
      H("k3h", 106, 75, 42, "SPLATNOST", MUTED),
      T("k3", 106, 80, 42, 6, "{doc.dueDate:date}", { size: 10, bold: true, color: ACCENT }),
      H("k4h", 152, 75, 43, "VARIABILNÍ SYMBOL", MUTED),
      T("k4", 152, 80, 43, 6, "{doc.vs}", { size: 10, bold: true, color: INK }),
      { id: "sep", type: "line", x: 15, y: 89, w: 180, h: 1, style: { color: "#d1d5db" } },
      T("payL", 15, 91, 28, 5, "Bankovní účet:", { size: 8, bold: true, color: INK }),
      T("pay", 43, 91, 152, 5, "{company.bankAccount}   ·   IBAN {company.iban}   ·   úhrada převodem", { size: 8, color: INK }),
      T("desc", 15, 97, 180, 6, "{doc.description}", { italic: true, color: INK }),
      {
        id: "lines",
        type: "table",
        x: 15,
        y: 104,
        w: 180,
        // tabulka smí sahat až k souhrnu; delší přeteče a souhrn se posune (případně na další stranu)
        h: 120,
        style: { fill: ACCENT, color: "#ffffff", size: 8.5 },
        columns: [
          { field: "description", label: "Položka", width: 70 },
          { field: "qty", label: "Množství", width: 18, align: "right", format: "qty" },
          { field: "unit", label: "MJ", width: 10 },
          { field: "unitPrice", label: "Cena/MJ", width: 22, align: "right", format: "money" },
          { field: "rate", label: "DPH %", width: 14, align: "right" },
          { field: "net", label: "Základ", width: 23, align: "right", format: "money" },
          { field: "gross", label: "Celkem", width: 23, align: "right", format: "money" },
        ],
      },
      // souhrn v dolní části A4
      H("vatH", 15, 229, 90, "REKAPITULACE DPH"),
      {
        id: "vat",
        type: "vat",
        x: 15,
        y: 234,
        w: 90,
        h: 20,
        style: { fill: PANEL, size: 8 },
        columns: [
          { field: "rate", label: "Sazba %", width: 18, align: "right" },
          { field: "base", label: "Základ", width: 24, align: "right", format: "money" },
          { field: "tax", label: "DPH", width: 22, align: "right", format: "money" },
          { field: "gross", label: "Celkem", width: 26, align: "right", format: "money" },
        ],
      },
      { id: "totBox", type: "rect", x: 118, y: 229, w: 77, h: 22, style: { fill: ACCENT, color: ACCENT } },
      T("totH", 121, 231, 71, 5, "K ÚHRADĚ", { size: 7.5, bold: true, color: "#dbe7f3", align: "right" }),
      T("tot", 121, 236, 71, 9, "{doc.due:money} {doc.currency}", { size: 17, bold: true, color: "#ffffff", align: "right" }),
      T("totS", 121, 245, 71, 5, "celkem s DPH {doc.gross:money} {doc.currency}", { size: 7.5, color: "#dbe7f3", align: "right" }),
      { id: "qr", type: "qr", x: 167, y: 254, w: 28, h: 28, field: "qr" },
      T("qrT", 118, 262, 47, 12, "QR platba\nnaskenujte v bankovní aplikaci", { size: 7.5, bold: true, align: "right", color: MUTED }),
      { id: "footLine", type: "line", x: 15, y: 284, w: 180, h: 1, style: { color: "#d1d5db" } },
      T("foot", 15, 286, 180, 5, "{company.email}   {company.phone}   {company.web}", { size: 7.5, color: MUTED, align: "center" }),
    ],
  };
}

/** Moderní rozvržení v1 (14. 11. 2026). */
export function invoiceLayoutV1(): PrintLayout {
  return {
    paper: "a4",
    fontSize: 9,
    elements: [
      { id: "band", type: "rect", x: 0, y: 0, w: 210, h: 3, style: { fill: ACCENT, color: ACCENT } },
      { id: "logo", type: "image", x: 15, y: 11, w: 55, h: 20, field: "company.logo" },
      T("title", 105, 11, 90, 10, "FAKTURA", { size: 22, bold: true, align: "right", color: ACCENT }),
      T("sub", 105, 21, 90, 6, "daňový doklad č. {doc.number}", { size: 11, align: "right", color: INK }),
      T("supH", 15, 38, 85, 5, "DODAVATEL", { size: 7, bold: true, color: MUTED }),
      T("sup", 15, 43, 85, 27, "{company.name}\n{company.address}\nIČO {company.regNo}   DIČ {company.vatId}\n{company.registration}", { size: 9, color: INK }),
      { id: "custBox", type: "rect", x: 106, y: 36, w: 89, h: 34, style: { fill: PANEL, color: PANEL } },
      T("custH", 110, 38, 82, 5, "ODBĚRATEL", { size: 7, bold: true, color: MUTED }),
      T("cust", 110, 43, 82, 26, "{partner.name}\n{partner.address}\nIČO {partner.regNo}   DIČ {partner.vatId}", { size: 10, bold: false, color: INK }),
      // klíčové údaje v řadě
      T("k1h", 15, 76, 42, 4, "DATUM VYSTAVENÍ", { size: 6.5, bold: true, color: MUTED }),
      T("k1", 15, 80, 42, 6, "{doc.date:date}", { size: 10, bold: true, color: INK }),
      T("k2h", 60, 76, 42, 4, "DATUM ZDAN. PLNĚNÍ", { size: 6.5, bold: true, color: MUTED }),
      T("k2", 60, 80, 42, 6, "{doc.taxDate:date}", { size: 10, bold: true, color: INK }),
      T("k3h", 106, 76, 42, 4, "SPLATNOST", { size: 6.5, bold: true, color: MUTED }),
      T("k3", 106, 80, 42, 6, "{doc.dueDate:date}", { size: 10, bold: true, color: ACCENT }),
      T("k4h", 152, 76, 43, 4, "VARIABILNÍ SYMBOL", { size: 6.5, bold: true, color: MUTED }),
      T("k4", 152, 80, 43, 6, "{doc.vs}", { size: 10, bold: true, color: INK }),
      { id: "sep", type: "line", x: 15, y: 89, w: 180, h: 1, style: { color: "#d1d5db" } },
      T("pay", 15, 91, 180, 5, "Bankovní účet {company.bankAccount}   ·   IBAN {company.iban}   ·   úhrada převodem", { size: 8, color: MUTED }),
      T("desc", 15, 97, 180, 6, "{doc.description}", { italic: true, color: INK }),
      {
        id: "lines",
        type: "table",
        x: 15,
        y: 104,
        w: 180,
        h: 60,
        style: { fill: ACCENT, color: "#ffffff", size: 8.5 },
        columns: [
          { field: "description", label: "Položka", width: 70 },
          { field: "qty", label: "Množství", width: 18, align: "right", format: "qty" },
          { field: "unit", label: "MJ", width: 10 },
          { field: "unitPrice", label: "Cena/MJ", width: 22, align: "right", format: "money" },
          { field: "rate", label: "DPH %", width: 14, align: "right" },
          { field: "net", label: "Základ", width: 23, align: "right", format: "money" },
          { field: "gross", label: "Celkem", width: 23, align: "right", format: "money" },
        ],
      },
      {
        id: "vat",
        type: "vat",
        x: 15,
        y: 170,
        w: 90,
        h: 20,
        style: { fill: PANEL, size: 8 },
        columns: [
          { field: "rate", label: "Sazba %", width: 18, align: "right" },
          { field: "base", label: "Základ", width: 24, align: "right", format: "money" },
          { field: "tax", label: "DPH", width: 22, align: "right", format: "money" },
          { field: "gross", label: "Celkem", width: 26, align: "right", format: "money" },
        ],
      },
      { id: "totBox", type: "rect", x: 118, y: 168, w: 77, h: 22, style: { fill: ACCENT, color: ACCENT } },
      T("totH", 121, 170, 71, 5, "K ÚHRADĚ", { size: 7, bold: true, color: "#dbe7f3", align: "right" }),
      T("tot", 121, 175, 71, 9, "{doc.due:money} {doc.currency}", { size: 17, bold: true, color: "#ffffff", align: "right" }),
      T("totS", 121, 184, 71, 5, "celkem s DPH {doc.gross:money} {doc.currency}", { size: 7.5, color: "#dbe7f3", align: "right" }),
      { id: "qr", type: "qr", x: 165, y: 194, w: 30, h: 30, field: "qr" },
      T("qrT", 118, 200, 45, 14, "QR platba\nnaskenujte v bankovní aplikaci", { size: 7.5, align: "right", color: MUTED }),
      { id: "footLine", type: "line", x: 15, y: 230, w: 180, h: 1, style: { color: "#d1d5db" } },
      T("foot", 15, 232, 180, 6, "{company.email}   {company.phone}   {company.web}", { size: 7.5, color: MUTED, align: "center" }),
    ],
  };
}

export function legacyInvoiceLayout(): PrintLayout {
  return {
    paper: "a4",
    fontSize: 9,
    elements: [
      { id: "logo", type: "image", x: 15, y: 12, w: 40, h: 18 },
      T("title", 110, 12, 85, 9, "Faktura – daňový doklad", { size: 16, bold: true, align: "right" }),
      T("num", 110, 21, 85, 6, "č. {doc.number}", { size: 12, align: "right" }),
      T("supH", 15, 36, 85, 5, "Dodavatel", { bold: true, color: "#555" }),
      T("sup", 15, 41, 85, 28, "{company.name}\n{company.address}\nIČO: {company.regNo}   DIČ: {company.vatId}\n{company.registration}", { size: 9 }),
      T("custH", 110, 36, 85, 5, "Odběratel", { bold: true, color: "#555" }),
      { id: "custBox", type: "rect", x: 108, y: 40, w: 87, h: 29 },
      T("cust", 111, 42, 82, 26, "{partner.name}\n{partner.address}\nIČO: {partner.regNo}   DIČ: {partner.vatId}", { size: 10 }),
      T("dates", 15, 73, 85, 22, "Datum vystavení: {doc.date:date}\nDatum zdan. plnění: {doc.taxDate:date}\nDatum splatnosti: {doc.dueDate:date}", {}),
      T("pay", 110, 73, 85, 22, "Bankovní účet: {company.bankAccount}\nIBAN: {company.iban}\nVariabilní symbol: {doc.vs}\nZpůsob úhrady: převodem", {}),
      T("desc", 15, 96, 180, 6, "{doc.description}", { italic: true }),
      {
        id: "lines",
        type: "table",
        x: 15,
        y: 104,
        w: 180,
        h: 60,
        columns: [
          { field: "description", label: "Položka", width: 74 },
          { field: "qty", label: "Množství", width: 18, align: "right", format: "qty" },
          { field: "unit", label: "MJ", width: 10 },
          { field: "unitPrice", label: "Cena/MJ", width: 22, align: "right", format: "money" },
          { field: "rate", label: "DPH %", width: 12, align: "right" },
          { field: "net", label: "Základ", width: 22, align: "right", format: "money" },
          { field: "gross", label: "Celkem", width: 22, align: "right", format: "money" },
        ],
      },
      {
        id: "vat",
        type: "vat",
        x: 15,
        y: 168,
        w: 90,
        h: 20,
        columns: [
          { field: "rate", label: "Sazba %", width: 18, align: "right" },
          { field: "base", label: "Základ", width: 24, align: "right", format: "money" },
          { field: "tax", label: "DPH", width: 22, align: "right", format: "money" },
          { field: "gross", label: "Celkem", width: 26, align: "right", format: "money" },
        ],
      },
      T("tot", 110, 168, 85, 9, "Celkem {doc.gross:money} {doc.currency}", { size: 14, bold: true, align: "right" }),
      T("due", 110, 177, 85, 6, "Zbývá uhradit {doc.due:money} {doc.currency}", { size: 10, align: "right" }),
      { id: "qr", type: "qr", x: 160, y: 188, w: 35, h: 35, field: "qr" },
      T("qrT", 120, 196, 38, 12, "QR platba", { size: 8, align: "right", color: "#555" }),
      T("foot", 15, 228, 180, 8, "{company.email}  {company.phone}  {company.web}", { size: 8, color: "#555", align: "center" }),
    ],
  };
}

export const invoicePrintable: PrintableDef = {
  id: "ar.invoice",
  label: "@PRT:DocInvoice",
  defaultPaper: "a4",
  numberField: "invoiceNum",
  fields: [
    ...COMPANY_FIELDS,
    { path: "doc.number", label: "@PRT:DocNumber" },
    { path: "doc.date", label: "@PRT:DocDate", format: "date" },
    { path: "doc.taxDate", label: "@PRT:TaxDate", format: "date" },
    { path: "doc.dueDate", label: "@PRT:DueDate", format: "date" },
    { path: "doc.vs", label: "@PRT:Vs" },
    { path: "doc.description", label: "@PRT:Description" },
    { path: "doc.currency", label: "@PRT:Currency" },
    { path: "doc.currencySymbol", label: "@PRT:CurrencySymbol" },
    { path: "doc.rounding", label: "@PRT:Rounding" },
    { path: "doc.paymentMethod", label: "@PRT:Payment" },
    { path: "doc.fxRate", label: "@PRT:FxRate" },
    { path: "doc.fxVat", label: "@PRT:FxVat" },
    { path: "doc.fxGross", label: "@PRT:FxGross" },
    { path: "doc.net", label: "@PRT:Net", format: "money" },
    { path: "doc.tax", label: "@PRT:Tax", format: "money" },
    { path: "doc.gross", label: "@PRT:Gross", format: "money" },
    { path: "doc.paid", label: "@PRT:Paid", format: "money" },
    { path: "doc.due", label: "@PRT:Due", format: "money" },
    { path: "partner.number", label: "@PRT:PartnerNumber" },
    { path: "partner.name", label: "@PRT:PartnerName" },
    { path: "partner.address", label: "@PRT:PartnerAddress" },
    { path: "partner.regNo", label: "@PRT:PartnerRegNo" },
    { path: "partner.vatId", label: "@PRT:PartnerVatId" },
  ],
  lineFields: [
    { path: "description", label: "@PRT:LineDescription" },
    { path: "qty", label: "@PRT:LineQty", format: "qty" },
    { path: "unit", label: "@PRT:LineUnit" },
    { path: "unitPrice", label: "@PRT:LineUnitPrice", format: "money" },
    { path: "rate", label: "@PRT:LineRate" },
    { path: "net", label: "@PRT:Net", format: "money" },
    { path: "tax", label: "@PRT:Tax", format: "money" },
    { path: "gross", label: "@PRT:Gross", format: "money" },
  ],
  dataset: invoiceDataset,
  // ISDOC v PDF faktury
  attachments: async (data, companyId, id) => {
    const x = await invoiceIsdoc(data, companyId, id);
    return [{ name: x.name, mime: "application/xml", data: x.xml }];
  },
  defaultLayout: invoiceLayout,
  legacyLayouts: [legacyInvoiceLayout(), invoiceLayoutV1(), invoiceLayoutV2(), invoiceLayoutV3(), invoiceLayoutV4(), invoiceLayoutV5(), invoiceLayoutV6()],
};

// ---------------------------------------------------------------------------
// Zálohová faktura (výzva k platbě) / daňový doklad k přijaté platbě
// ---------------------------------------------------------------------------

async function advanceDataset(data: DataApi, companyId: string | null, id: string) {
  const adv = await data.get("ar.advance", id);
  if (!adv) throw new Error("not found");
  const company = await companyData(data, companyId, (adv.currencyId as string) ?? null);
  const cust = await data.get("ar.customer", String(adv.customerId));
  const subj = cust ? await data.get("gab.subject", String(cust.subjectId)) : null;
  const [addr] = subj ? await data.find("gab.address", { subjectId: subj.id }, { take: 1 }) : [];
  const cur = adv.currencyId ? await data.get("sys.currency", String(adv.currencyId)) : null;
  const currency = String(cur?.code ?? "CZK");
  const code = adv.taxCodeId ? await data.get("tax.taxCode", String(adv.taxCodeId)) : null;
  const order = adv.orderId ? await data.get("ar.order", String(adv.orderId)) : null;
  // po přijetí platby s DPH je to daňový doklad k platbě, jinak výzva k platbě
  const taxDoc = !!adv.taxDocNum && toCents(adv.taxAmount) > zero;
  const due = toCents(adv.amount) - toCents(adv.paidAmount);
  const vs = String(adv.vs ?? String(adv.advanceNum).replace(/\D/g, ""));
  const rate = String(Number(code?.rate ?? 0));
  const gross = taxDoc ? toCents(adv.taxBase) + toCents(adv.taxAmount) : toCents(adv.amount);
  const text = `Záloha${order ? ` k objednávce ${order.orderNum}` : ""}${adv.description ? ` – ${adv.description}` : ""}`;
  return {
    company,
    doc: {
      title: taxDoc ? "DAŇOVÝ DOKLAD" : "ZÁLOHOVÁ FAKTURA",
      subtitle: taxDoc ? `k přijaté platbě č. ${adv.taxDocNum}` : `výzva k platbě č. ${adv.advanceNum}`,
      number: taxDoc ? adv.taxDocNum : adv.advanceNum,
      advanceNum: adv.advanceNum,
      date: adv.issueDate,
      taxDate: taxDoc ? adv.taxDate : "",
      dueDate: adv.dueDate,
      vs,
      description: taxDoc ? `Platba zálohy ${adv.advanceNum} přijatá ${String(adv.taxDate ?? "").split("-").reverse().join(". ")}` : "Nejde o daňový doklad.",
      currency,
      net: taxDoc ? adv.taxBase : "",
      tax: taxDoc ? adv.taxAmount : "",
      gross: fromCents(gross),
      paid: adv.paidAmount,
      due: fromCents(taxDoc ? zero : due),
    },
    partner: {
      number: cust?.accountNum ?? "",
      name: subj?.name ?? "",
      regNo: subj?.regNo ?? "",
      vatId: subj?.vatId ?? "",
      address: addr ? [addr.street, [addr.zipCode, addr.city].filter(Boolean).join(" "), addr.country !== "CZ" ? addr.country : null].filter(Boolean).join(", ") : "",
    },
    lines: [{ description: text, qty: "1", unit: "", unitPrice: fromCents(gross), rate: taxDoc ? rate : "", net: taxDoc ? adv.taxBase : fromCents(gross), tax: taxDoc ? adv.taxAmount : "0", gross: fromCents(gross) }],
    vat: taxDoc ? [{ rate, base: adv.taxBase, tax: adv.taxAmount, gross: fromCents(gross) }] : [],
    qr: !taxDoc && company.iban && due > zero ? await paymentQr(data, { iban: company.iban, amount: fromCents(due), currency, vs, date: (adv.dueDate as string) ?? null, message: `Záloha ${adv.advanceNum}` }) : "",
  };
}

/** Rozvržení zálohy = faktura s nadpisem podle stavu (výzva k platbě / daňový doklad). */
function advanceLayout(): PrintLayout {
  const l = invoiceLayout();
  const set = (id: string, text: string) => {
    const e = l.elements.find((x) => x.id === id);
    if (e) e.text = text;
  };
  set("title", "{doc.title}");
  set("sub", "{doc.subtitle}");
  set("k2h", "DATUM PŘIJETÍ PLATBY");
  set("k2", "{doc.taxDate:date}");
  set("totS", "celkem {doc.gross:money} {doc.currency}");
  const lines = l.elements.find((x) => x.id === "lines");
  if (lines)
    lines.columns = [
      { field: "description", label: "Předmět", width: 116 },
      { field: "rate", label: "DPH %", width: 14, align: "right" },
      { field: "gross", label: "Celkem", width: 50, align: "right", format: "money" },
    ];
  return l;
}

export const advancePrintable: PrintableDef = {
  id: "ar.advance",
  label: "@PRT:DocAdvance",
  defaultPaper: "a4",
  numberField: "advanceNum",
  fields: [...invoicePrintable.fields, { path: "doc.title", label: "@PRT:DocTitle" }, { path: "doc.advanceNum", label: "@PRT:AdvanceNum" }],
  lineFields: invoicePrintable.lineFields,
  dataset: advanceDataset,
  defaultLayout: advanceLayout,
};

// ---------------------------------------------------------------------------
// Účtenka (zjednodušený daňový doklad)
// ---------------------------------------------------------------------------

/**
 * Účtenka = zjednodušený daňový doklad (§ 30 ZDPH): obchodní firma, sídlo, IČO, DIČ,
 * evidenční číslo, datum, předmět plnění se sazbou, celkem, rekapitulace DPH po
 * sazbách; s EET kód POK. Malé logo nahoře, bez zkratky firmy.
 * QR platba čekající na úhradu: pod platbou výzva, QR kód a variabilní symbol (jinak se nezobrazí).
 */
function receiptLayout(): PrintLayout {
  const v5 = receiptLayoutV5();
  const at = 87; // pod řádkem platby — vše níž se posune o blok QR
  const dy = 44;
  return {
    ...v5,
    elements: [
      ...v5.elements.map((e) => (e.y >= at ? { ...e, y: e.y + dy } : e)),
      { ...T("qrNote", 2, at, 68, 5, "{doc.qrNote}", { bold: true, align: "center", size: 8 }), showIf: "doc.qr" },
      { id: "qr", type: "qr", x: 19, y: at + 6, w: 34, h: 34, field: "doc.qr", showIf: "doc.qr" },
      { ...T("qrVs", 2, at + 40, 68, 4, "VS {doc.vs}", { align: "center", size: 8 }), showIf: "doc.qr" },
    ],
  };
}

/** Účtenka v5 (18. 11. 2026, bez QR platby) — neupravené šablony se převedou. */
export function receiptLayoutV5(): PrintLayout {
  return {
    paper: "receipt80",
    fontSize: 8.5,
    elements: [
      { id: "logo", type: "image", x: 16, y: 0, w: 40, h: 12, field: "company.logo", showIf: "company.logo", style: { align: "center" } },
      T("name", 2, 13, 68, 5, "{company.name}", { bold: true, align: "center", size: 10 }),
      T("addr", 2, 18, 68, 10, "{company.address}\nIČO {company.regNo}   DIČ {company.vatId}", { align: "center", size: 7.5 }),
      // zápis ve veřejném rejstříku (spisová značka) — jen když ho organizace má
      { ...T("reg", 2, 28, 68, 1, "{company.registration}", { align: "center", size: 6.5 }), showIf: "company.registration" },
      { id: "sep1", type: "line", x: 2, y: 29, w: 68, h: 1 },
      T("title", 2, 30, 68, 5, "{doc.title}", { bold: true, align: "center", size: 8.5 }),
      T("num", 2, 35, 68, 9, "č. {doc.number}\n{doc.dateTime}   pokladna {doc.register}", { align: "center", size: 7.5 }),
      // známý odběratel (účtenka = faktura – daňový doklad); bez odběratele se nezobrazí ani nezabere místo
      { ...T("cust", 2, 44, 68, 1, "Odběratel: {customer.name}\n{customer.address}\n{customer.ids}", { size: 7.5 }), showIf: "customer.name" },
      {
        id: "lines",
        type: "table",
        x: 2,
        y: 45,
        w: 68,
        h: 20,
        style: { size: 7.5 },
        columns: [
          { field: "description", label: "Položka", width: 29 },
          { field: "qty", label: "Mn.", width: 10, align: "right", format: "qty" },
          { field: "unit", label: "MJ", width: 6 },
          { field: "rate", label: "%", width: 6, align: "right" },
          { field: "gross", label: "Kč", width: 17, align: "right", format: "money" },
        ],
      },
      T("total", 2, 67, 68, 7, "Celkem k úhradě {doc.paid:money} Kč", { bold: true, size: 12, align: "right" }),
      { ...T("round", 2, 74, 68, 4, "Zaokrouhlení {doc.rounding:money} Kč", { size: 7.5, align: "right" }), showIf: "doc.rounding" },
      T("pay", 2, 78, 68, 4, "Platba: {doc.payment}", { size: 7.5, align: "right" }),
      { ...T("cash", 2, 82, 68, 4, "Přijato {doc.cashGiven:money} Kč   Vráceno {doc.change:money} Kč", { size: 7.5, align: "right" }), showIf: "doc.cashGiven" },
      {
        id: "vat",
        type: "vat",
        // rekapitulace DPH jen u plátce
        showIf: "doc.vatPayer",
        x: 2,
        y: 87,
        w: 68,
        h: 12,
        style: { size: 7.5 },
        columns: [
          { field: "rate", label: "Sazba %", width: 17, align: "right" },
          { field: "base", label: "Základ", width: 17, align: "right", format: "money" },
          { field: "tax", label: "DPH", width: 15, align: "right", format: "money" },
          { field: "gross", label: "Celkem", width: 19, align: "right", format: "money" },
        ],
      },
      { ...T("np", 2, 99, 68, 2, "{doc.nonPayerNote}", { size: 7.5, align: "center" }), showIf: "doc.nonPayerNote" },
      { ...T("eet", 2, 101, 68, 8, "Evidence tržeb – běžný režim\nPOK: {doc.fik}", { size: 7, align: "center" }), showIf: "doc.fik" },
      T("foot", 2, 110, 68, 9, "{doc.footer}\nDěkujeme za nákup", { align: "center", size: 8 }),
    ],
  };
}

/** Účtenka v4 (17. 11. 2026, bez zápisu v rejstříku) — neupravené šablony se převedou. */
export function receiptLayoutV4(): PrintLayout {
  return {
    paper: "receipt80",
    fontSize: 8.5,
    elements: [
      { id: "logo", type: "image", x: 16, y: 0, w: 40, h: 12, field: "company.logo", showIf: "company.logo", style: { align: "center" } },
      T("name", 2, 13, 68, 5, "{company.name}", { bold: true, align: "center", size: 10 }),
      T("addr", 2, 18, 68, 10, "{company.address}\nIČO {company.regNo}   DIČ {company.vatId}", { align: "center", size: 7.5 }),
      { id: "sep1", type: "line", x: 2, y: 29, w: 68, h: 1 },
      T("title", 2, 30, 68, 5, "{doc.title}", { bold: true, align: "center", size: 8.5 }),
      T("num", 2, 35, 68, 9, "č. {doc.number}\n{doc.dateTime}   pokladna {doc.register}", { align: "center", size: 7.5 }),
      // známý odběratel (účtenka = faktura – daňový doklad); bez odběratele se nezobrazí ani nezabere místo
      { ...T("cust", 2, 44, 68, 1, "Odběratel: {customer.name}\n{customer.address}\n{customer.ids}", { size: 7.5 }), showIf: "customer.name" },
      {
        id: "lines",
        type: "table",
        x: 2,
        y: 45,
        w: 68,
        h: 20,
        style: { size: 7.5 },
        columns: [
          { field: "description", label: "Položka", width: 29 },
          { field: "qty", label: "Mn.", width: 10, align: "right", format: "qty" },
          { field: "unit", label: "MJ", width: 6 },
          { field: "rate", label: "%", width: 6, align: "right" },
          { field: "gross", label: "Kč", width: 17, align: "right", format: "money" },
        ],
      },
      T("total", 2, 67, 68, 7, "Celkem k úhradě {doc.paid:money} Kč", { bold: true, size: 12, align: "right" }),
      { ...T("round", 2, 74, 68, 4, "Zaokrouhlení {doc.rounding:money} Kč", { size: 7.5, align: "right" }), showIf: "doc.rounding" },
      T("pay", 2, 78, 68, 4, "Platba: {doc.payment}", { size: 7.5, align: "right" }),
      { ...T("cash", 2, 82, 68, 4, "Přijato {doc.cashGiven:money} Kč   Vráceno {doc.change:money} Kč", { size: 7.5, align: "right" }), showIf: "doc.cashGiven" },
      {
        id: "vat",
        type: "vat",
        // rekapitulace DPH jen u plátce
        showIf: "doc.vatPayer",
        x: 2,
        y: 87,
        w: 68,
        h: 12,
        style: { size: 7.5 },
        columns: [
          { field: "rate", label: "Sazba %", width: 17, align: "right" },
          { field: "base", label: "Základ", width: 17, align: "right", format: "money" },
          { field: "tax", label: "DPH", width: 15, align: "right", format: "money" },
          { field: "gross", label: "Celkem", width: 19, align: "right", format: "money" },
        ],
      },
      { ...T("np", 2, 99, 68, 2, "{doc.nonPayerNote}", { size: 7.5, align: "center" }), showIf: "doc.nonPayerNote" },
      { ...T("eet", 2, 101, 68, 8, "Evidence tržeb – běžný režim\nPOK: {doc.fik}", { size: 7, align: "center" }), showIf: "doc.fik" },
      T("foot", 2, 110, 68, 9, "{doc.footer}\nDěkujeme za nákup", { align: "center", size: 8 }),
    ],
  };
}


/** Účtenka v3 (17. 11. 2026, s odběratelem, rekapitulace DPH vždy) — neupravené šablony se převedou. */
export function receiptLayoutV3(): PrintLayout {
  return {
    paper: "receipt80",
    fontSize: 8.5,
    elements: [
      { id: "logo", type: "image", x: 16, y: 0, w: 40, h: 12, field: "company.logo", showIf: "company.logo", style: { align: "center" } },
      T("name", 2, 13, 68, 5, "{company.name}", { bold: true, align: "center", size: 10 }),
      T("addr", 2, 18, 68, 10, "{company.address}\nIČO {company.regNo}   DIČ {company.vatId}", { align: "center", size: 7.5 }),
      { id: "sep1", type: "line", x: 2, y: 29, w: 68, h: 1 },
      T("title", 2, 30, 68, 5, "{doc.title}", { bold: true, align: "center", size: 8.5 }),
      T("num", 2, 35, 68, 9, "č. {doc.number}\n{doc.dateTime}   pokladna {doc.register}", { align: "center", size: 7.5 }),
      // známý odběratel (účtenka = faktura – daňový doklad); bez odběratele se nezobrazí ani nezabere místo
      { ...T("cust", 2, 44, 68, 1, "Odběratel: {customer.name}\n{customer.address}\n{customer.ids}", { size: 7.5 }), showIf: "customer.name" },
      {
        id: "lines",
        type: "table",
        x: 2,
        y: 45,
        w: 68,
        h: 20,
        style: { size: 7.5 },
        columns: [
          { field: "description", label: "Položka", width: 29 },
          { field: "qty", label: "Mn.", width: 10, align: "right", format: "qty" },
          { field: "unit", label: "MJ", width: 6 },
          { field: "rate", label: "%", width: 6, align: "right" },
          { field: "gross", label: "Kč", width: 17, align: "right", format: "money" },
        ],
      },
      T("total", 2, 67, 68, 7, "Celkem k úhradě {doc.paid:money} Kč", { bold: true, size: 12, align: "right" }),
      { ...T("round", 2, 74, 68, 4, "Zaokrouhlení {doc.rounding:money} Kč", { size: 7.5, align: "right" }), showIf: "doc.rounding" },
      T("pay", 2, 78, 68, 4, "Platba: {doc.payment}", { size: 7.5, align: "right" }),
      { ...T("cash", 2, 82, 68, 4, "Přijato {doc.cashGiven:money} Kč   Vráceno {doc.change:money} Kč", { size: 7.5, align: "right" }), showIf: "doc.cashGiven" },
      {
        id: "vat",
        type: "vat",
        x: 2,
        y: 87,
        w: 68,
        h: 12,
        style: { size: 7.5 },
        columns: [
          { field: "rate", label: "Sazba %", width: 17, align: "right" },
          { field: "base", label: "Základ", width: 17, align: "right", format: "money" },
          { field: "tax", label: "DPH", width: 15, align: "right", format: "money" },
          { field: "gross", label: "Celkem", width: 19, align: "right", format: "money" },
        ],
      },
      { ...T("eet", 2, 101, 68, 8, "Evidence tržeb – běžný režim\nPOK: {doc.fik}", { size: 7, align: "center" }), showIf: "doc.fik" },
      T("foot", 2, 110, 68, 9, "{doc.footer}\nDěkujeme za nákup", { align: "center", size: 8 }),
    ],
  };
}


/** Účtenka v2 (do 17. 11. 2026, bez odběratele) — neupravené šablony se převedou. */
export function receiptLayoutV2(): PrintLayout {
  return {
    paper: "receipt80",
    fontSize: 8.5,
    elements: [
      { id: "logo", type: "image", x: 16, y: 0, w: 40, h: 12, field: "company.logo", showIf: "company.logo", style: { align: "center" } },
      T("name", 2, 13, 68, 5, "{company.name}", { bold: true, align: "center", size: 10 }),
      T("addr", 2, 18, 68, 10, "{company.address}\nIČO {company.regNo}   DIČ {company.vatId}", { align: "center", size: 7.5 }),
      { id: "sep1", type: "line", x: 2, y: 29, w: 68, h: 1 },
      T("title", 2, 30, 68, 5, "Zjednodušený daňový doklad", { bold: true, align: "center", size: 8.5 }),
      T("num", 2, 35, 68, 9, "č. {doc.number}\n{doc.dateTime}   pokladna {doc.register}", { align: "center", size: 7.5 }),
      {
        id: "lines",
        type: "table",
        x: 2,
        y: 45,
        w: 68,
        h: 20,
        style: { size: 7.5 },
        columns: [
          { field: "description", label: "Položka", width: 29 },
          { field: "qty", label: "Mn.", width: 10, align: "right", format: "qty" },
          { field: "unit", label: "MJ", width: 6 },
          { field: "rate", label: "%", width: 6, align: "right" },
          { field: "gross", label: "Kč", width: 17, align: "right", format: "money" },
        ],
      },
      T("total", 2, 67, 68, 7, "Celkem k úhradě {doc.paid:money} Kč", { bold: true, size: 12, align: "right" }),
      { ...T("round", 2, 74, 68, 4, "Zaokrouhlení {doc.rounding:money} Kč", { size: 7.5, align: "right" }), showIf: "doc.rounding" },
      T("pay", 2, 78, 68, 4, "Platba: {doc.payment}", { size: 7.5, align: "right" }),
      { ...T("cash", 2, 82, 68, 4, "Přijato {doc.cashGiven:money} Kč   Vráceno {doc.change:money} Kč", { size: 7.5, align: "right" }), showIf: "doc.cashGiven" },
      {
        id: "vat",
        type: "vat",
        x: 2,
        y: 87,
        w: 68,
        h: 12,
        style: { size: 7.5 },
        columns: [
          { field: "rate", label: "Sazba %", width: 17, align: "right" },
          { field: "base", label: "Základ", width: 17, align: "right", format: "money" },
          { field: "tax", label: "DPH", width: 15, align: "right", format: "money" },
          { field: "gross", label: "Celkem", width: 19, align: "right", format: "money" },
        ],
      },
      { ...T("eet", 2, 101, 68, 8, "Evidence tržeb – běžný režim\nPOK: {doc.fik}", { size: 7, align: "center" }), showIf: "doc.fik" },
      T("foot", 2, 110, 68, 9, "{doc.footer}\nDěkujeme za nákup", { align: "center", size: 8 }),
    ],
  };
}


/** Účtenka v1 (14. 11. 2026) — neupravené šablony se převedou. */
export function receiptLayoutV1(): PrintLayout {
  return {
    paper: "receipt80",
    fontSize: 8.5,
    elements: [
      { id: "logo", type: "image", x: 16, y: 0, w: 40, h: 12, field: "company.logo", showIf: "company.logo", style: { align: "center" } },
      T("name", 0, 13, 72, 5, "{company.name}", { bold: true, align: "center", size: 10 }),
      T("addr", 0, 18, 72, 10, "{company.address}\nIČO {company.regNo}   DIČ {company.vatId}", { align: "center", size: 7.5 }),
      { id: "sep1", type: "line", x: 0, y: 29, w: 72, h: 1 },
      T("title", 0, 30, 72, 5, "Zjednodušený daňový doklad", { bold: true, align: "center", size: 8.5 }),
      T("num", 0, 35, 72, 9, "č. {doc.number}\n{doc.dateTime}   pokladna {doc.register}", { align: "center", size: 7.5 }),
      {
        id: "lines",
        type: "table",
        x: 0,
        y: 45,
        w: 72,
        h: 20,
        style: { size: 7.5 },
        columns: [
          { field: "description", label: "Položka", width: 31 },
          { field: "qty", label: "Mn.", width: 11, align: "right", format: "qty" },
          { field: "unit", label: "MJ", width: 6 },
          { field: "rate", label: "%", width: 6, align: "right" },
          { field: "gross", label: "Kč", width: 18, align: "right", format: "money" },
        ],
      },
      T("total", 0, 67, 72, 7, "Celkem k úhradě {doc.paid:money} Kč", { bold: true, size: 12, align: "right" }),
      { ...T("round", 0, 74, 72, 4, "Zaokrouhlení {doc.rounding:money} Kč", { size: 7.5, align: "right" }), showIf: "doc.rounding" },
      T("pay", 0, 78, 72, 4, "Platba: {doc.payment}", { size: 7.5, align: "right" }),
      { ...T("cash", 0, 82, 72, 4, "Přijato {doc.cashGiven:money} Kč   Vráceno {doc.change:money} Kč", { size: 7.5, align: "right" }), showIf: "doc.cashGiven" },
      {
        id: "vat",
        type: "vat",
        x: 0,
        y: 87,
        w: 72,
        h: 12,
        style: { size: 7.5 },
        columns: [
          { field: "rate", label: "Sazba %", width: 18, align: "right" },
          { field: "base", label: "Základ", width: 18, align: "right", format: "money" },
          { field: "tax", label: "DPH", width: 16, align: "right", format: "money" },
          { field: "gross", label: "Celkem", width: 20, align: "right", format: "money" },
        ],
      },
      { ...T("eet", 0, 101, 72, 8, "Evidence tržeb – běžný režim\nPOK: {doc.fik}", { size: 7, align: "center" }), showIf: "doc.fik" },
      T("foot", 0, 110, 72, 9, "{doc.footer}\nDěkujeme za nákup", { align: "center", size: 8 }),
    ],
  };
}

/** Původní účtenka (do 11/2026) — neupravené šablony se nahradí novou. */
export function legacyReceiptLayout(): PrintLayout {
  return {
    paper: "receipt80",
    fontSize: 9,
    elements: [
      T("name", 0, 0, 72, 12, "{company.tradeName}\n{company.name}", { bold: true, align: "center", size: 11 }),
      T("addr", 0, 12, 72, 12, "{company.address}\nIČO {company.regNo}  DIČ {company.vatId}", { align: "center", size: 8 }),
      T("num", 0, 25, 72, 9, "Účtenka {doc.number}\n{doc.dateTime} · {doc.register}", { align: "center", size: 8 }),
      {
        id: "lines",
        type: "table",
        x: 0,
        y: 36,
        w: 72,
        h: 20,
        columns: [
          { field: "description", label: "Položka", width: 34 },
          { field: "qty", label: "Mn.", width: 12, align: "right", format: "qty" },
          { field: "gross", label: "Kč", width: 26, align: "right", format: "money" },
        ],
      },
      T("total", 0, 58, 72, 8, "Celkem {doc.paid:money} Kč", { bold: true, size: 13, align: "right" }),
      T("pay", 0, 67, 72, 10, "Zaokrouhlení {doc.rounding:money}\nZaplaceno: {doc.payment}  Přijato {doc.cashGiven:money}  Vráceno {doc.change:money}", { size: 8, align: "right" }),
      {
        id: "vat",
        type: "vat",
        x: 0,
        y: 79,
        w: 72,
        h: 12,
        columns: [
          { field: "rate", label: "DPH %", width: 16, align: "right" },
          { field: "base", label: "Základ", width: 30, align: "right", format: "money" },
          { field: "tax", label: "DPH", width: 26, align: "right", format: "money" },
        ],
      },
      T("eet", 0, 93, 72, 6, "FIK: {doc.fik}", { size: 7, align: "center" }),
      T("foot", 0, 100, 72, 10, "{doc.footer}\nDěkujeme za nákup", { align: "center", size: 8 }),
    ],
  };
}

export const receiptPrintable: PrintableDef = {
  id: "pos.receipt",
  label: "@PRT:DocReceipt",
  defaultPaper: "receipt80",
  numberField: "receiptNum",
  fields: [
    ...COMPANY_FIELDS.slice(0, 5),
    { path: "doc.number", label: "@PRT:DocNumber" },
    { path: "doc.dateTime", label: "@PRT:DateTime" },
    { path: "doc.register", label: "@PRT:Register" },
    { path: "doc.gross", label: "@PRT:Gross", format: "money" },
    { path: "doc.rounding", label: "@PRT:Rounding", format: "money" },
    { path: "doc.paid", label: "@PRT:Paid", format: "money" },
    { path: "doc.payment", label: "@PRT:Payment" },
    { path: "doc.cashGiven", label: "@PRT:CashGiven", format: "money" },
    { path: "doc.change", label: "@PRT:Change", format: "money" },
    { path: "doc.fik", label: "@PRT:Fik" },
    { path: "doc.footer", label: "@PRT:Footer" },
    { path: "doc.title", label: "@PRT:DocTitle" },
    { path: "doc.qr", label: "@PRT:QrPayment" },
    { path: "doc.qrNote", label: "@PRT:QrNote" },
    { path: "doc.vs", label: "@PRT:Vs" },
    { path: "customer.name", label: "@PRT:CustomerName" },
    { path: "customer.address", label: "@PRT:CustomerAddress" },
    { path: "customer.ids", label: "@PRT:CustomerIds" },
  ],
  lineFields: [
    { path: "description", label: "@PRT:LineDescription" },
    { path: "qty", label: "@PRT:LineQty", format: "qty" },
    { path: "unit", label: "@PRT:LineUnit" },
    { path: "unitPrice", label: "@PRT:LineUnitPrice", format: "money" },
    { path: "rate", label: "@PRT:LineRate" },
    { path: "gross", label: "@PRT:Gross", format: "money" },
  ],
  async dataset(data, companyId, id) {
    return receiptData(await receiptPrint(data, companyId, id));
  },
  defaultLayout: receiptLayout,
  legacyLayouts: [legacyReceiptLayout(), receiptLayoutV1(), receiptLayoutV2(), receiptLayoutV3(), receiptLayoutV4(), receiptLayoutV5()],
};

// ---------------------------------------------------------------------------
// Platba DPH (Přiznání a podání → Platba DPH): částka, účet finančního úřadu, VS = DIČ, QR platba
// ---------------------------------------------------------------------------

async function vatPaymentDataset(data: DataApi, companyId: string | null, id: string) {
  const ret = await data.get("tax.return", id);
  if (!ret) throw new Error("not found");
  const company = await companyData(data, companyId);
  const [params] = await data.find("tax.parameters", {}, { take: 1 });
  const vendor = params?.taxOfficeVendorId ? await data.get("ap.vendor", String(params.taxOfficeVendorId)).catch(() => null) : null;
  const subj = vendor ? await data.get("gab.subject", String(vendor.subjectId)) : null;
  const bank = vendor?.bankAccountId ? await data.get("gab.bankAccount", String(vendor.bankAccountId)) : null;
  const accountNum = String(bank?.accountNum ?? "");
  const iban = String(bank?.iban ?? "") || czIban(accountNum) || "";
  // částka: zaúčtovaný závazek, jinak spočítaný výsledek přiznání
  const amount = String(ret.paymentAmount ?? ret.result ?? "0");
  const vs = String(ret.paymentVs ?? String(company.vatId ?? "").replace(/\D/g, "").slice(-10));
  const period = String(ret.period ?? "");
  return {
    company,
    doc: { number: `DPH ${period}`, period, amount, dueDate: ret.dueDate ?? "", vs, currency: "CZK" },
    partner: { name: subj?.name ?? "", bankAccount: accountNum, iban },
    lines: [],
    vat: [],
    qr: iban && toCents(amount) > zero ? await paymentQr(data, { iban, amount, currency: "CZK", vs, date: ret.dueDate ? String(ret.dueDate instanceof Date ? ret.dueDate.toISOString() : ret.dueDate).slice(0, 10) : null, message: `DPH ${period}` }) : "",
    // proč QR chybí (bez účtu FÚ, bez částky k úhradě)
    qrMissing: !vendor ? "QR platba: v Daňových parametrech chybí dodavatel Finanční úřad." : !iban ? "QR platba: dodavatel Finanční úřad nemá bankovní účet." : toCents(amount) <= zero ? "QR platba: není co platit (nejdřív Spočítat; nadměrný odpočet se neplatí)." : "",
  };
}

function vatPaymentLayout(): PrintLayout {
  const H = (id: string, x: number, y: number, w: number, text: string) => T(id, x, y, w, 5, text, { size: 7, bold: true, color: MUTED });
  return {
    paper: "a4",
    fontSize: 10,
    elements: [
      { id: "band", type: "rect", x: 0, y: 0, w: 210, h: 3, style: { fill: ACCENT, color: ACCENT } },
      T("title", 15, 14, 180, 6, "PLATBA DPH", { size: 8, bold: true, color: MUTED }),
      T("num", 15, 20, 180, 10, "Období {doc.period}", { size: 18, bold: true, color: INK }),
      T("co", 15, 31, 180, 10, "{company.name}\nDIČ {company.vatId}", { size: 9, color: INK }),
      { id: "box", type: "rect", x: 15, y: 46, w: 180, h: 46, style: { fill: PANEL, color: PANEL } },
      H("rcvH", 20, 49, 100, "PŘÍJEMCE"),
      T("rcv", 20, 54, 100, 6, "{partner.name}", { size: 11, bold: true, color: INK }),
      H("accH", 20, 62, 100, "ČÍSLO ÚČTU"),
      T("acc", 20, 67, 100, 6, "{partner.bankAccount}", { size: 13, bold: true, color: INK }),
      T("iban", 20, 74, 100, 4, "IBAN {partner.iban}", { size: 7, color: MUTED }),
      H("vsH", 20, 80, 50, "VARIABILNÍ SYMBOL"),
      T("vs", 20, 85, 50, 6, "{doc.vs}", { size: 13, bold: true, color: INK }),
      H("dueH", 75, 80, 45, "SPLATNOST"),
      T("due", 75, 85, 45, 6, "{doc.dueDate:date}", { size: 13, bold: true, color: ACCENT }),
      { id: "totBox", type: "rect", x: 125, y: 49, w: 66, h: 22, style: { fill: ACCENT, color: ACCENT } },
      T("totH", 128, 51, 60, 5, "K ÚHRADĚ", { size: 7.5, bold: true, color: "#dbe7f3", align: "right" }),
      T("tot", 128, 57, 60, 9, "{doc.amount:money} Kč", { size: 16, bold: true, color: "#ffffff", align: "right" }),
      { id: "qr", type: "qr", x: 140, y: 100, w: 50, h: 50, field: "qr" },
      { ...T("qrT", 15, 120, 120, 12, "QR platba — naskenujte v bankovní aplikaci", { size: 9, bold: true, color: MUTED, align: "right" }), showIf: "qr" },
      { ...T("qrM", 15, 100, 180, 8, "{qrMissing}", { size: 9, color: MUTED }), showIf: "qrMissing" },
    ],
  };
}

export const vatPaymentPrintable: PrintableDef = {
  id: "tax.return",
  label: "@PRT:DocVatPayment",
  defaultPaper: "a4",
  numberField: "period",
  fields: [
    ...COMPANY_FIELDS,
    { path: "doc.period", label: "@PRT:Period" },
    { path: "doc.amount", label: "@PRT:Due", format: "money" },
    { path: "doc.dueDate", label: "@PRT:DueDate", format: "date" },
    { path: "doc.vs", label: "@PRT:Vs" },
    { path: "partner.name", label: "@PRT:Recipient" },
    { path: "partner.bankAccount", label: "@PRT:BankAccount" },
    { path: "partner.iban", label: "@PRT:Iban" },
  ],
  lineFields: [],
  dataset: vatPaymentDataset,
  defaultLayout: vatPaymentLayout,
};
