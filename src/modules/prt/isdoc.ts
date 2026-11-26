/**
 * ISDOC 6.0.2 — český standard elektronické faktury (ČSSF).
 *
 * Export: vydaná faktura → ISDOC XML (stažení i příloha v PDF faktury).
 * Import: .isdoc, .isdocx (ZIP) i PDF s vloženým ISDOC → údaje dokladu
 * ve tvaru vytěžení (OcrResult) — bez OCR, přesně podle dodavatele.
 */
import { randomUUID } from "node:crypto";
import { inflateRawSync, inflateSync } from "node:zlib";
import { fromCents, toCents } from "@/core/money";
import { UserError, type DataApi, type RecordData } from "@/core/module";
import { czIban } from "@/core/print";
import type { OcrResult } from "@/modules/int/ocr";

const NS = "http://isdoc.cz/namespace/2013";
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const amt = (c: bigint) => fromCents(c);
const el = (name: string, v: unknown, attrs = "") => `<${name}${attrs}>${esc(v)}</${name}>`;

function party(p: { regNo?: unknown; name?: unknown; street?: unknown; houseNo?: unknown; city?: unknown; zip?: unknown; country?: unknown; vatId?: unknown }) {
  const country = String(p.country || "CZ");
  return `<Party>
      <PartyIdentification>${el("ID", p.regNo ?? "")}</PartyIdentification>
      <PartyName>${el("Name", p.name)}</PartyName>
      <PostalAddress>${el("StreetName", p.street ?? "")}${el("BuildingNumber", p.houseNo ?? "")}${el("CityName", p.city ?? "")}${el("PostalZone", String(p.zip ?? "").replace(/\s/g, ""))}<Country>${el("IdentificationCode", country)}${el("Name", "")}</Country></PostalAddress>
      ${p.vatId ? `<PartyTaxScheme>${el("CompanyID", p.vatId)}${el("TaxScheme", "VAT")}</PartyTaxScheme>` : ""}
    </Party>`;
}

type Party = Parameters<typeof party>[0];
interface IsdocLine {
  qty: number;
  unit: string;
  net: bigint;
  tax: bigint;
  rate: string;
  description: string;
}

/** Dodavatel (organizace firmy) a jeho bankovní spojení pro ISDOC. */
async function supplierOf(data: DataApi, companyId: string | null) {
  const [org] = (await data.find("org.entity", {}, { take: 1 }).catch(() => [])) as RecordData[];
  const company = companyId ? await data.get("sys.company", companyId) : null;
  const street = [org?.street, [org?.houseNo, org?.orientNo].filter(Boolean).join("/")].filter(Boolean).join(" ");
  const account = (org?.bankAccount as string) ?? "";
  return {
    org,
    vatPayer: org ? org.vatPayer !== false : true,
    party: { regNo: org?.regNo ?? company?.regNo, name: org?.legalName ?? company?.name, street: org?.street ? street : "", houseNo: "", city: org?.city, zip: org?.zipCode, country: org?.country, vatId: org?.vatId ?? company?.vatId } as Party,
    account: /^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/.exec(account.replace(/\s/g, "")),
    iban: (org?.iban as string) || czIban(account) || "",
    bic: (org?.bic as string) ?? "",
  };
}

/** Kódy sazeb a měrné jednotky řádků jednou za doklad (ne dotaz za řádek). */
async function lineRefs(data: DataApi, lines: RecordData[]) {
  const ids = (f: string) => [...new Set(lines.map((l) => String(l[f] ?? "")).filter(Boolean))];
  const codes = new Map((ids("taxCodeId").length ? await data.find("tax.taxCode", { id: { in: ids("taxCodeId") } }, { take: 500 }) : []).map((x) => [String(x.id), x]));
  const units = new Map((ids("unitId").length ? await data.find("inv.unit", { id: { in: ids("unitId") } }, { take: 500 }) : []).map((x) => [String(x.id), x]));
  return { codes, units };
}

/**
 * Dokument ISDOC 6.0.2 (faktura / zjednodušený daňový doklad): řádky, rekapitulace DPH podle sazeb, úhrada.
 * `payment.code`: 42 = převodem na účet, 10 = hotově, 48 = kartou; `paid` = už uhrazeno (zálohy, účtenka).
 */
function isdocXml(o: {
  num: string;
  issueDate: string;
  taxDate: string;
  note: string;
  currency: string;
  vatPayer: boolean;
  supplier: Party;
  customer: Party;
  lines: IsdocLine[];
  paid: bigint;
  /** zaplaceno už při vystavení (účtenka): PaidAmount = celá částka, k úhradě 0 */
  paidOnIssue?: boolean;
  rounding?: bigint;
  payment: { code: number; dueDate: string; vs: string; account: RegExpExecArray | null; iban: string; bic: string };
}): string {
  const rates = new Map<string, { base: bigint; tax: bigint }>();
  const lineXml = o.lines.map((l, k) => {
    const r = rates.get(l.rate) ?? { base: BigInt(0), tax: BigInt(0) };
    r.base += l.net;
    r.tax += l.tax;
    rates.set(l.rate, r);
    const unitNet = l.qty ? Number(fromCents(l.net)) / l.qty : 0;
    const unitGross = l.qty ? Number(fromCents(l.net + l.tax)) / l.qty : 0;
    return `<InvoiceLine>
      ${el("ID", k + 1)}
      ${el("InvoicedQuantity", l.qty, ` unitCode="${esc(l.unit || "ks")}"`)}
      ${el("LineExtensionAmount", amt(l.net))}
      ${el("LineExtensionAmountTaxInclusive", amt(l.net + l.tax))}
      ${el("LineExtensionTaxAmount", amt(l.tax))}
      ${el("UnitPrice", unitNet.toFixed(2))}
      ${el("UnitPriceTaxInclusive", unitGross.toFixed(2))}
      <ClassifiedTaxCategory>${el("Percent", l.rate)}${el("VATCalculationMethod", 0)}${el("VATApplicable", o.vatPayer)}</ClassifiedTaxCategory>
      <Item>${el("Description", l.description)}</Item>
    </InvoiceLine>`;
  });
  const net = [...rates.values()].reduce((s, r) => s + r.base, BigInt(0));
  const tax = [...rates.values()].reduce((s, r) => s + r.tax, BigInt(0));
  const rounding = o.rounding ?? BigInt(0);
  const total = net + tax + rounding;
  const payable = o.paidOnIssue ? BigInt(0) : total - o.paid;
  const subtotals = [...rates]
    .map(
      ([rate, r]) => `<TaxSubTotal>
      ${el("TaxableAmount", amt(r.base))}${el("TaxAmount", amt(r.tax))}${el("TaxInclusiveAmount", amt(r.base + r.tax))}
      ${el("AlreadyClaimedTaxableAmount", "0.00")}${el("AlreadyClaimedTaxAmount", "0.00")}${el("AlreadyClaimedTaxInclusiveAmount", "0.00")}
      ${el("DifferenceTaxableAmount", amt(r.base))}${el("DifferenceTaxAmount", amt(r.tax))}${el("DifferenceTaxInclusiveAmount", amt(r.base + r.tax))}
      <TaxCategory>${el("Percent", rate)}${el("VATApplicable", o.vatPayer)}</TaxCategory>
    </TaxSubTotal>`,
    )
    .join("\n    ");
  const m = o.payment.account;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="${NS}" version="6.0.2">
  ${el("DocumentType", 1)}
  ${el("ID", o.num)}
  ${el("UUID", randomUUID().toUpperCase())}
  ${el("IssuingSystem", "Shanon")}
  ${el("IssueDate", o.issueDate)}
  ${el("TaxPointDate", o.taxDate)}
  ${el("VATApplicable", o.vatPayer)}
  ${el("ElectronicPossibilityAgreementReference", "")}
  ${el("Note", o.note)}
  ${el("LocalCurrencyCode", o.currency)}
  ${el("CurrRate", 1)}
  ${el("RefCurrRate", 1)}
  <AccountingSupplierParty>
    ${party(o.supplier)}
  </AccountingSupplierParty>
  <AccountingCustomerParty>
    ${party(o.customer)}
  </AccountingCustomerParty>
  <InvoiceLines>
    ${lineXml.join("\n    ")}
  </InvoiceLines>
  <TaxTotal>
    ${subtotals}
    ${el("TaxAmount", amt(tax))}
  </TaxTotal>
  <LegalMonetaryTotal>
    ${el("TaxExclusiveAmount", amt(net))}${el("TaxInclusiveAmount", amt(net + tax))}
    ${el("AlreadyClaimedTaxExclusiveAmount", "0.00")}${el("AlreadyClaimedTaxInclusiveAmount", "0.00")}
    ${el("DifferenceTaxExclusiveAmount", amt(net))}${el("DifferenceTaxInclusiveAmount", amt(net + tax))}
    ${el("PayableRoundingAmount", amt(rounding))}${el("PaidDepositsAmount", amt(o.paidOnIssue ? BigInt(0) : o.paid))}${el("PayableAmount", amt(payable))}
  </LegalMonetaryTotal>
  <PaymentMeans>
    <Payment>
      ${el("PaidAmount", amt(o.paidOnIssue ? total : payable))}
      ${el("PaymentMeansCode", o.payment.code)}
      <Details>${el("PaymentDueDate", o.payment.dueDate)}${el("ID", m ? `${m[1] ? `${m[1]}-` : ""}${m[2]}` : "")}${el("BankCode", m?.[3] ?? "")}${el("Name", "")}${el("IBAN", o.payment.iban)}${el("BIC", o.payment.bic)}${el("VariableSymbol", o.payment.vs)}</Details>
    </Payment>
  </PaymentMeans>
</Invoice>
`;
}

const fileName = (num: unknown) => `${String(num).replace(/[^\w.-]+/g, "_")}.isdoc`;

/** ISDOC vydané faktury (dataset z účetnictví; částky v měně faktury). */
export async function invoiceIsdoc(data: DataApi, companyId: string | null, invoiceId: string): Promise<{ name: string; xml: string }> {
  const inv = await data.get("ar.invoice", invoiceId);
  if (!inv) throw new UserError("@SYS:NotFound");
  const sup = await supplierOf(data, companyId);
  const cust = await data.get("ar.customer", String(inv.customerId));
  const subj = cust ? await data.get("gab.subject", String(cust.subjectId)) : null;
  const [addr] = subj ? ((await data.find("gab.address", { subjectId: subj.id }, { take: 1 })) as RecordData[]) : [];
  const cur = inv.currencyId ? await data.get("sys.currency", String(inv.currencyId)) : null;
  const lines = await data.find("ar.invoiceLine", { invoiceId }, { take: 5000 });
  const { codes, units } = await lineRefs(data, lines);
  const xml = isdocXml({
    num: String(inv.invoiceNum),
    issueDate: String(inv.invoiceDate),
    taxDate: String(inv.taxDate ?? inv.invoiceDate),
    note: String(inv.description ?? ""),
    currency: String(cur?.code ?? "CZK"),
    vatPayer: sup.vatPayer,
    supplier: sup.party,
    customer: { regNo: subj?.regNo, name: subj?.name, street: addr?.street, city: addr?.city, zip: addr?.zipCode, country: addr?.country ?? subj?.country, vatId: subj?.vatId },
    lines: lines.map((l) => ({
      qty: Number(l.qty ?? 1),
      unit: String(units.get(String(l.unitId ?? ""))?.code ?? "ks"),
      net: toCents(l.amountNet ?? 0),
      tax: toCents(l.taxAmount ?? 0),
      rate: String(Number(codes.get(String(l.taxCodeId ?? ""))?.rate ?? 0)),
      description: String(l.description ?? ""),
    })),
    paid: toCents(inv.paidAmount ?? 0),
    payment: { code: 42, dueDate: String(inv.dueDate ?? inv.invoiceDate), vs: String(inv.vs ?? ""), account: sup.account, iban: sup.iban, bic: sup.bic },
  });
  return { name: fileName(inv.invoiceNum), xml };
}

/**
 * ISDOC účtenky z pokladny (zjednodušený daňový doklad / s odběratelem faktura) pro import do účetnictví.
 * Odběratel: z účtenky (odběratel, jinak jméno a adresa kupujícího), bez něj „Konečný spotřebitel“.
 * Účtenka je zaplacená při vystavení (hotově / kartou), QR platba převodem až výpisem.
 */
export async function receiptIsdoc(data: DataApi, companyId: string | null, receiptId: string, t: (l: string) => string): Promise<{ name: string; xml: string }> {
  const r = await data.get("pos.receipt", receiptId);
  if (!r) throw new UserError("@SYS:NotFound");
  const sup = await supplierOf(data, companyId);
  const cust = r.customerId ? await data.get("ar.customer", String(r.customerId)).catch(() => null) : null;
  const subj = cust ? await data.get("gab.subject", String(cust.subjectId)) : null;
  const [addr] = subj ? ((await data.find("gab.address", { subjectId: subj.id }, { take: 1 })) as RecordData[]) : [];
  const lines = await data.find("pos.receiptLine", { receiptId }, { take: 5000 });
  const { codes, units } = await lineRefs(data, lines);
  const customer: Party = subj
    ? { regNo: subj.regNo, name: subj.name, street: addr?.street, city: addr?.city, zip: addr?.zipCode, country: addr?.country ?? subj.country, vatId: subj.vatId }
    : r.buyerName
      ? { name: r.buyerName, street: r.buyerStreet, city: r.buyerCity, zip: r.buyerZip, country: "CZ" }
      : { name: t("@POS:EndConsumer"), country: "CZ" };
  const date = String(r.date instanceof Date ? r.date.toISOString() : r.date).slice(0, 10);
  const qr = r.paymentMethod === "qr";
  const xml = isdocXml({
    num: String(r.receiptNum),
    issueDate: date,
    taxDate: date,
    note: t("@POS:Receipt"),
    currency: "CZK",
    vatPayer: sup.vatPayer,
    supplier: sup.party,
    customer,
    lines: lines.map((l) => ({
      qty: Number(l.qty ?? 1),
      unit: String(units.get(String(l.unitId ?? ""))?.code ?? "ks"),
      net: toCents(l.amountNet ?? 0),
      tax: toCents(l.taxAmount ?? 0),
      rate: String(Number(codes.get(String(l.taxCodeId ?? ""))?.rate ?? 0)),
      description: String(l.description ?? ""),
    })),
    paid: BigInt(0),
    paidOnIssue: !qr || r.payStatus === "paid",
    rounding: toCents(r.rounding ?? 0),
    payment: { code: qr ? 42 : r.paymentMethod === "card" ? 48 : 10, dueDate: date, vs: String(r.vs ?? ""), account: qr ? sup.account : null, iban: qr ? sup.iban : "", bic: qr ? sup.bic : "" },
  });
  return { name: fileName(r.receiptNum), xml };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

type Node = { name: string; attrs: Record<string, string>; children: Node[]; text: string };

/** Minimální XML parser (prvky, atributy, text; prefixy jmenných prostorů se zahodí). */
function parseXml(xml: string): Node {
  const root: Node = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: Node[] = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&amp;/g, "&");
  const local = (n: string) => n.slice(n.indexOf(":") + 1);
  for (const m of xml.matchAll(re)) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) {
      if (stack.length > 1) stack.pop();
    }
    else if (m[3]) {
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? "").matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[local(a[1])] = unesc(a[2] ?? a[3] ?? "");
      const node: Node = { name: local(m[3]), attrs, children: [], text: "" };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined) top.text += unesc(m[6]);
  }
  return root;
}
const child = (n: Node | undefined, ...path: string[]): Node | undefined => path.reduce<Node | undefined>((cur, p) => cur?.children.find((c) => c.name === p), n);
const txt = (n: Node | undefined, ...path: string[]) => {
  const v = child(n, ...path)?.text.trim();
  return v ? v : null;
};
const num = (n: Node | undefined, ...path: string[]) => {
  const v = txt(n, ...path);
  return v === null || Number.isNaN(Number(v)) ? null : Number(v);
};

function partyOf(p: Node | undefined): OcrResult["issuer"] {
  const party = child(p, "Party");
  const addr = child(party, "PostalAddress");
  const street = [txt(addr, "StreetName"), txt(addr, "BuildingNumber")].filter(Boolean).join(" ") || null;
  return {
    name: txt(party, "PartyName", "Name"),
    regNo: txt(party, "PartyIdentification", "ID"),
    vatId: txt(party, "PartyTaxScheme", "CompanyID"),
    street,
    city: txt(addr, "CityName"),
    zip: txt(addr, "PostalZone"),
    country: txt(addr, "Country", "IdentificationCode"),
    bankAccount: null,
    iban: null,
  };
}

/** ISDOC XML → údaje dokladu (tvar vytěžení). */
export function parseIsdoc(xml: string): OcrResult {
  const inv = parseXml(xml).children.find((c) => c.name === "Invoice");
  if (!inv) throw new UserError("@INT:IsdocInvalid");
  const docType = Number(txt(inv, "DocumentType") ?? 1);
  const pay = child(inv, "PaymentMeans", "Payment", "Details");
  const issuer = partyOf(child(inv, "AccountingSupplierParty"));
  const acc = txt(pay, "ID");
  const bank = txt(pay, "BankCode");
  issuer.bankAccount = acc && bank ? `${acc}/${bank}` : null;
  issuer.iban = txt(pay, "IBAN");
  const total = child(inv, "LegalMonetaryTotal");
  const lines = (child(inv, "InvoiceLines")?.children ?? [])
    .filter((l) => l.name === "InvoiceLine")
    .map((l) => ({
      description: txt(l, "Item", "Description"),
      qty: num(l, "InvoicedQuantity"),
      unit: child(l, "InvoicedQuantity")?.attrs.unitCode ?? null,
      unitPrice: num(l, "UnitPrice"),
      taxRate: num(l, "ClassifiedTaxCategory", "Percent"),
      amountNet: num(l, "LineExtensionAmount"),
    }));
  return {
    // 1 faktura, 2 dobropis, 3 vrubopis, 4 zálohová faktura (bez DPH), 5 daňový doklad k záloze
    docType: docType === 4 ? "advance" : docType === 2 ? "creditNote" : "invoice",
    issuer,
    recipient: partyOf(child(inv, "AccountingCustomerParty")),
    docNumber: txt(inv, "ID"),
    orderNumber: txt(inv, "OrderReferences", "OrderReference", "SalesOrderID"),
    issueDate: txt(inv, "IssueDate"),
    taxDate: txt(inv, "TaxPointDate"),
    dueDate: txt(pay, "PaymentDueDate"),
    vs: txt(pay, "VariableSymbol"),
    currency: txt(inv, "ForeignCurrencyCode") ?? txt(inv, "LocalCurrencyCode"),
    amountNet: num(total, "TaxExclusiveAmount"),
    taxAmount: num(child(inv, "TaxTotal"), "TaxAmount"),
    amountGross: num(total, "TaxInclusiveAmount"),
    lines,
    note: txt(inv, "Note"),
  };
}

/** Soubor ZIP (ISDOCX): obsah prvního souboru .isdoc. */
function unzipIsdoc(buf: Buffer): string | null {
  let i = 0;
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8);
    const size = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extra = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString();
    const start = i + 30 + nameLen + extra;
    const body = buf.subarray(start, start + size);
    if (/\.isdoc$/i.test(name)) return (method === 8 ? inflateRawSync(body) : body).toString("utf8");
    i = start + size;
  }
  return null;
}

/** PDF s vloženým ISDOC: projde proudy (i komprimované) a najde ISDOC XML. */
function isdocFromPdf(buf: Buffer): string | null {
  const s = buf.toString("latin1");
  // klíčové slovo „stream“, ne konec předchozího proudu „endstream“ (jinak se přeskočí každý druhý proud — PDF z Pohody)
  const re = /(?<!end)stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf("endstream", start);
    if (end < 0) break;
    const raw = buf.subarray(start, end);
    for (const tryDecode of [() => inflateSync(raw), () => raw]) {
      try {
        const t = tryDecode().toString("utf8");
        if (t.includes(NS) && /<(\w+:)?Invoice[\s>]/.test(t)) return t.slice(t.indexOf("<"));
      } catch {
        /* není deflate */
      }
    }
    re.lastIndex = end + "endstream".length;
  }
  return null;
}

/** ISDOC ze souboru (.isdoc, .isdocx, PDF s přílohou); null = soubor ISDOC nemá. */
export function isdocFromFile(name: string, data: Buffer): string | null {
  const n = name.toLowerCase();
  if (n.endsWith(".isdoc") || (data.subarray(0, 200).toString("utf8").includes(NS) && !n.endsWith(".pdf"))) return data.toString("utf8");
  if (n.endsWith(".isdocx") || data.readUInt32LE(0) === 0x04034b50) return unzipIsdoc(data);
  if (n.endsWith(".pdf") || data.subarray(0, 5).toString() === "%PDF-") return isdocFromPdf(data);
  return null;
}

/** Stažení ISDOC vydané faktury (tlačítko ISDOC). */
export const isdocHandlers: Record<string, import("@/core/module").ObjectHandlers> = {
  "pos.receipt": {
    downloads: {
      async isdoc(ctx, r) {
        const x = await receiptIsdoc(ctx.data, ctx.companyId, String(r.id), ctx.t);
        return { name: x.name, mime: "application/xml; charset=utf-8", data: x.xml };
      },
    },
  },
  "ar.invoice": {
    downloads: {
      async isdoc(ctx, inv) {
        const x = await invoiceIsdoc(ctx.data, ctx.companyId, String(inv.id));
        return { name: x.name, mime: "application/xml; charset=utf-8", data: x.xml };
      },
    },
  },
};
