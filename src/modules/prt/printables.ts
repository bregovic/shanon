/**
 * Tisknutelné doklady: faktura vydaná (s QR platbou) a účtenka. Data pro
 * šablonu a výchozí rozvržení. Společná pole firmy pro všechny doklady.
 */
import { fromCents, toCents } from "@/core/money";
import type { DataApi, RecordData } from "@/core/module";
import { czIban, spayd, type PrintField, type PrintLayout, type PrintableDef } from "@/core/print";
import { addressLine, orgOf } from "@/modules/org";
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
  { path: "company.email", label: "@PRT:Email" },
  { path: "company.phone", label: "@PRT:Phone" },
  { path: "company.web", label: "@PRT:Web" },
];

/** Bankovní účet firmy pro platbu: z Organizace, jinak první účet v Bance (v měně dokladu). */
async function paymentAccount(data: DataApi, org: RecordData | null, currencyId?: string | null) {
  if (org?.bankAccount || org?.iban) return { bankAccount: (org.bankAccount as string) ?? "", iban: (org.iban as string) || czIban(org.bankAccount as string) || "" };
  try {
    const accs = (await data.find("bank.account", { blocked: false }, { take: 20, orderBy: { code: "asc" } })) as RecordData[];
    const a = accs.find((x) => (x.accountNum || x.iban) && (!currencyId || !x.currencyId || x.currencyId === currencyId)) ?? null;
    if (a) return { bankAccount: (a.accountNum as string) ?? "", iban: (a.iban as string) || czIban(a.accountNum as string) || "" };
  } catch {
    // Banka není zapnutá
  }
  return { bankAccount: "", iban: "" };
}

async function companyData(data: DataApi, companyId: string | null, currencyId?: string | null) {
  const org = (await orgOf(data)) as RecordData | null;
  const company = companyId ? await data.get("sys.company", companyId) : null;
  const pay = await paymentAccount(data, org, currencyId);
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
    email: (org?.email ?? "") as string,
    phone: (org?.phone ?? "") as string,
    web: (org?.web ?? "") as string,
  };
}

// ---------------------------------------------------------------------------
// Faktura vydaná
// ---------------------------------------------------------------------------

async function invoiceDataset(data: DataApi, companyId: string | null, id: string) {
  const inv = await data.get("ar.invoice", id);
  if (!inv) throw new Error("not found");
  const company = await companyData(data, companyId, (inv.currencyId as string) ?? null);
  const cust = await data.get("ar.customer", String(inv.customerId));
  const subj = cust ? await data.get("gab.subject", String(cust.subjectId)) : null;
  const [addr] = subj ? await data.find("gab.address", { subjectId: subj.id }, { take: 1 }) : [];
  const cur = inv.currencyId ? await data.get("sys.currency", String(inv.currencyId)) : null;
  const currency = String(cur?.code ?? "CZK");
  const lines = await data.find("ar.invoiceLine", { invoiceId: id }, { take: 1000 });
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
    out.push({ description: l.description ?? "", qty: l.qty, unit: unit?.code ?? "", unitPrice: l.unitPrice, rate, net: fromCents(net), tax: fromCents(tax), gross: fromCents(net + tax) });
  }
  const due = toCents(inv.amountGross ?? 0) - toCents(inv.paidAmount ?? 0);
  const vs = String(inv.vs ?? String(inv.invoiceNum).replace(/\D/g, ""));
  return {
    company,
    doc: {
      number: inv.invoiceNum,
      date: inv.invoiceDate,
      taxDate: inv.taxDate ?? inv.invoiceDate,
      dueDate: inv.dueDate,
      vs,
      description: inv.description ?? "",
      currency,
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
    qr: company.iban && due > zero ? spayd({ iban: company.iban, amount: fromCents(due), currency, vs, date: (inv.dueDate as string) ?? null, message: `Faktura ${inv.invoiceNum}` }) : "",
  };
}

const T = (id: string, x: number, y: number, w: number, h: number, text: string, style?: Record<string, unknown>) => ({ id, type: "text" as const, x, y, w, h, text, style });

/** Původní výchozí rozvržení (do 11/2026) — neupravené šablony se nahradí novým. */
const INK = "#1f2a37";
const ACCENT = "#1f4e79";
const MUTED = "#6b7280";
const PANEL = "#f3f5f8";

/** Výchozí faktura: logo, karty dodavatele a odběratele, klíčové údaje, tabulka, souhrn s QR platbou. */
function invoiceLayout(): PrintLayout {
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
  defaultLayout: invoiceLayout,
  legacyLayouts: [legacyInvoiceLayout(), invoiceLayoutV1()],
};

// ---------------------------------------------------------------------------
// Účtenka (zjednodušený daňový doklad)
// ---------------------------------------------------------------------------

function receiptLayout(): PrintLayout {
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
};
