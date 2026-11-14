/**
 * Doklady ke zpracování (int.document) — mezitabulka vytěžených dokladů.
 *
 * Nový → (vytěžit, mimo transakci: src/server/doc-import.ts) → K kontrole / Připraveno
 * → Zalistovat (koncept faktury, zálohy nebo objednávky v agendě) → Zalistováno.
 *
 * Tady je logika nad daty (v transakci, DataApi): převzetí výsledku, kontrola
 * (partner, součty, duplicita), založení partnera a vytvoření dokladu v agendě.
 */
import { fromCents, toCents } from "@/core/money";
import { UserError, type DataApi, type RecordData } from "@/core/module";
import type { OcrParty, OcrResult } from "./ocr";

/** Cíl dokladu → objekt agendy a strana partnera. */
export const TARGETS: Record<string, { object: string; partner: "ap.vendor" | "ar.customer"; field: "vendorId" | "customerId" }> = {
  apInvoice: { object: "ap.invoice", partner: "ap.vendor", field: "vendorId" },
  apAdvance: { object: "ap.advance", partner: "ap.vendor", field: "vendorId" },
  apOrder: { object: "ap.order", partner: "ap.vendor", field: "vendorId" },
  arInvoice: { object: "ar.invoice", partner: "ar.customer", field: "customerId" },
  arAdvance: { object: "ar.advance", partner: "ar.customer", field: "customerId" },
  arOrder: { object: "ar.order", partner: "ar.customer", field: "customerId" },
};

type T = (ref: string, p?: Record<string, string>) => string;

const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const normVat = (s: unknown) => String(s ?? "").replace(/\s/g, "").toUpperCase();
const amount = (n: number | null | undefined) => (n === null || n === undefined || Number.isNaN(n) ? null : n.toFixed(2));
const isoDate = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

/** Jsme to my? (podle IČO, DIČ nebo názvu firmy) */
function isUs(p: OcrParty, company: RecordData | null): boolean {
  if (!company) return false;
  if (p.regNo && company.regNo && digits(p.regNo) === digits(company.regNo)) return true;
  if (p.vatId && company.vatId && normVat(p.vatId) === normVat(company.vatId)) return true;
  return !!p.name && !!company.name && p.name.trim().toLowerCase() === String(company.name).trim().toLowerCase();
}

/** Cíl podle druhu dokladu a směru (vystavili jsme ho my, nebo nám). */
export function inferTarget(r: OcrResult, outgoing: boolean): string {
  if (r.docType === "advance") return outgoing ? "arAdvance" : "apAdvance";
  if (r.docType === "order") return outgoing ? "apOrder" : "arOrder"; // naše objednávka u dodavatele / objednávka od odběratele
  return outgoing ? "arInvoice" : "apInvoice";
}

/** Převzít výsledek vytěžení do mezitabulky (hlavička + řádky) a zkontrolovat. */
export async function applyExtraction(data: DataApi, doc: RecordData, r: OcrResult, company: RecordData | null, t: T): Promise<RecordData> {
  const issuerIsUs = isUs(r.issuer, company);
  // u objednávky, kterou jsme vystavili my, je partnerem příjemce
  const other = issuerIsUs ? r.recipient : r.issuer;
  const target = doc.target && doc.target !== "auto" ? String(doc.target) : inferTarget(r, issuerIsUs);
  await data.update("int.document", String(doc.id), {
    target,
    docType: r.docType,
    partnerName: other.name?.slice(0, 120) ?? null,
    regNo: other.regNo ? digits(other.regNo).slice(0, 12) || null : null,
    vatId: other.vatId ? normVat(other.vatId).slice(0, 16) : null,
    bankAccount: (other.bankAccount ?? other.iban)?.slice(0, 60) ?? null,
    docNumber: r.docNumber?.slice(0, 40) ?? null,
    orderNumber: r.orderNumber?.slice(0, 40) ?? null,
    issueDate: isoDate(r.issueDate),
    taxDate: isoDate(r.taxDate),
    dueDate: isoDate(r.dueDate),
    vs: r.vs ? digits(r.vs).slice(-10) || null : null,
    currencyCode: r.currency?.toUpperCase().slice(0, 3) ?? null,
    amountNet: amount(r.amountNet),
    taxAmount: amount(r.taxAmount),
    amountGross: amount(r.amountGross),
    raw: JSON.stringify(r, null, 1),
  });
  for (const l of await data.find("int.documentLine", { documentId: doc.id }, { take: 1000 })) await data.remove("int.documentLine", String(l.id));
  let n = 0;
  for (const l of r.lines ?? []) {
    if (!l.description && l.amountNet === null && l.unitPrice === null) continue;
    await data.create("int.documentLine", {
      documentId: doc.id,
      lineNum: ++n,
      description: (l.description ?? "").slice(0, 255) || "—",
      qty: l.qty ?? 1,
      unit: l.unit?.slice(0, 10) ?? null,
      unitPrice: l.unitPrice ?? (l.amountNet !== null ? l.amountNet / (l.qty || 1) : null),
      taxRate: l.taxRate ?? null,
      amountNet: amount(l.amountNet ?? (l.unitPrice !== null ? l.unitPrice * (l.qty ?? 1) : null)),
    });
  }
  return checkDocument(data, (await data.get("int.document", String(doc.id)))!, t);
}

/** Subjekt adresáře podle IČO, jinak DIČ. */
async function findSubject(data: DataApi, doc: RecordData): Promise<RecordData | null> {
  if (doc.regNo) {
    const [s] = await data.find("gab.subject", { regNo: String(doc.regNo) }, { take: 1 });
    if (s) return s;
  }
  if (doc.vatId) {
    const [s] = await data.find("gab.subject", { vatId: String(doc.vatId) }, { take: 1 });
    if (s) return s;
  }
  return null;
}

/**
 * Kontrola před zalistováním: partner v agendě, povinné údaje, součty,
 * duplicita. Bez výhrad → Připraveno, jinak K kontrole se seznamem výhrad.
 */
export async function checkDocument(data: DataApi, doc: RecordData, t: T): Promise<RecordData> {
  const issues: string[] = [];
  const tg = TARGETS[String(doc.target)];
  let partnerId: string | null = null;
  let subjectId: string | null = null;
  if (!tg) issues.push(t("@INT:DocNoTarget"));
  else {
    try {
      const subj = await findSubject(data, doc);
      subjectId = subj ? String(subj.id) : null;
      const [p] = subj ? await data.find(tg.partner, { subjectId: subj.id }, { take: 1 }) : [];
      partnerId = p ? String(p.id) : null;
      if (!partnerId) issues.push(t("@INT:DocNoPartner", { name: String(doc.partnerName ?? doc.regNo ?? "?") }));
      else if (p.blocked) issues.push(t("@SYS:PartnerBlocked"));
    } catch {
      issues.push(t("@INT:DocModuleOff"));
    }
  }
  if (!doc.issueDate) issues.push(t("@INT:DocNoDate"));
  if (!doc.docNumber && (doc.target === "apInvoice" || doc.target === "apAdvance")) issues.push(t("@INT:DocNoNumber"));
  const lines = await data.find("int.documentLine", { documentId: doc.id }, { take: 1000 });
  const gross = doc.amountGross !== null && doc.amountGross !== undefined ? toCents(doc.amountGross) : null;
  const net = doc.amountNet !== null && doc.amountNet !== undefined ? toCents(doc.amountNet) : null;
  const tax = doc.taxAmount !== null && doc.taxAmount !== undefined ? toCents(doc.taxAmount) : null;
  const tol = BigInt(100); // 1 Kč (zaokrouhlení na dokladu)
  const abs = (x: bigint) => (x < BigInt(0) ? -x : x);
  if (gross === null) issues.push(t("@INT:DocNoAmount"));
  if (net !== null && tax !== null && gross !== null && abs(net + tax - gross) > tol) issues.push(t("@INT:DocSumMismatch", { net: fromCents(net), tax: fromCents(tax), gross: fromCents(gross) }));
  if (lines.length && net !== null) {
    const sum = lines.reduce((a, l) => a + toCents(l.amountNet ?? 0), BigInt(0));
    if (abs(sum - net) > tol) issues.push(t("@INT:DocLinesMismatch", { lines: fromCents(sum), net: fromCents(net) }));
  }
  // duplicita: stejné číslo dokladu u téhož partnera
  if (tg && partnerId && doc.docNumber && tg.object === "ap.invoice") {
    const dup = await data.find("ap.invoice", { vendorId: partnerId, externalNum: String(doc.docNumber) }, { take: 1 });
    if (dup.length) issues.push(t("@INT:DocDuplicate", { num: String(doc.docNumber) }));
  }
  return data.update("int.document", String(doc.id), {
    subjectId,
    [tg?.field === "customerId" ? "customerId" : "vendorId"]: partnerId,
    status: issues.length ? "attention" : "ready",
    message: issues.join(" · ").slice(0, 255) || null,
  });
}

/** Založit partnera z registru (IČO / DIČ), jinak z vytěžených údajů. */
export async function createDocPartner(data: DataApi, doc: RecordData, t: T): Promise<RecordData> {
  const tg = TARGETS[String(doc.target)];
  if (!tg) throw new UserError("@INT:DocNoTarget");
  let subj = await findSubject(data, doc);
  if (!subj) {
    const { createFromRegistry } = await import("@/modules/gab/registry-lookup");
    const query = String(doc.regNo || doc.vatId || "");
    let id: string | null = null;
    if (query) id = await createFromRegistry(data, query, {}).catch(() => null);
    subj = id
      ? await data.get("gab.subject", id)
      : await data.create("gab.subject", { name: String(doc.partnerName || doc.regNo || doc.vatId || "?").slice(0, 120), regNo: doc.regNo ?? null, vatId: doc.vatId ?? null });
  }
  const [has] = await data.find(tg.partner, { subjectId: subj!.id }, { take: 1 });
  if (!has) {
    const { createPartner } = await import("@/modules/gab/registry-lookup");
    await createPartner(data, String(subj!.id), tg.partner);
  }
  return checkDocument(data, (await data.get("int.document", String(doc.id)))!, t);
}

/** Daňový kód podle sazby a směru (nákup = vstup, prodej = výstup), bez přenesení. */
async function taxCodeFor(data: DataApi, rate: number | null, direction: "input" | "output"): Promise<string | null> {
  if (rate === null || rate === undefined) return null;
  const codes = (await data.find("tax.taxCode", { direction }, { take: 200 })).filter((c) => !c.reverseCharge);
  const hit = codes.find((c) => Math.abs(Number(c.rate) - rate) < 0.01);
  return hit ? String(hit.id) : null;
}

/** Sazba z částek (DPH / základ), zaokrouhlená na známou sazbu. */
const rateOf = (doc: RecordData) => {
  const n = Number(doc.amountNet ?? 0);
  const x = Number(doc.taxAmount ?? 0);
  if (!n) return null;
  const r = (x / n) * 100;
  return [0, 10, 12, 15, 21].reduce((a, b) => (Math.abs(b - r) < Math.abs(a - r) ? b : a), 0);
};

/** Zalistovat: koncept dokladu v agendě (faktura, záloha, objednávka) s řádky. */
export async function listDocument(data: DataApi, doc: RecordData, t: T): Promise<{ object: string; id: string; title: string }> {
  if (doc.status !== "ready" && doc.status !== "attention") throw new UserError("@SYS:Locked");
  const checked = await checkDocument(data, doc, t);
  const tg = TARGETS[String(checked.target)];
  if (!tg) throw new UserError("@INT:DocNoTarget");
  const partnerId = checked[tg.field];
  if (!partnerId) throw new UserError("@INT:DocNoPartner", { name: String(doc.partnerName ?? "?") });
  const [cur] = checked.currencyCode ? await data.find("sys.currency", { code: String(checked.currencyCode) }, { take: 1 }) : [];
  const direction = tg.partner === "ap.vendor" ? "input" : "output";
  const description = String(checked.partnerName ?? checked.docNumber ?? "").slice(0, 255) || null;
  const common: RecordData = { [tg.field]: partnerId, currencyId: cur?.id ?? null, description };
  let header: RecordData;
  const kind = tg.object.split(".")[1];
  if (kind === "invoice") {
    header = await data.create(tg.object, {
      ...common,
      ...(tg.partner === "ap.vendor" ? { externalNum: checked.docNumber ?? null } : {}),
      invoiceDate: checked.issueDate,
      taxDate: checked.taxDate ?? checked.issueDate,
      dueDate: checked.dueDate ?? null,
      vs: checked.vs ?? null,
    });
  } else if (kind === "advance") {
    header = await data.create(tg.object, {
      ...common,
      ...(tg.partner === "ap.vendor" ? { externalNum: checked.docNumber ?? null } : {}),
      issueDate: checked.issueDate,
      dueDate: checked.dueDate ?? null,
      vs: checked.vs ?? null,
      amount: checked.amountGross,
    });
  } else {
    header = await data.create(tg.object, { ...common, externalRef: (checked.docNumber ?? checked.orderNumber ?? null) && String(checked.docNumber ?? checked.orderNumber).slice(0, 20), orderDate: checked.issueDate });
  }
  if (kind !== "advance") {
    const lineObj = `${tg.object}Line`;
    const headerField = kind === "invoice" ? "invoiceId" : "orderId";
    const lines = await data.find("int.documentLine", { documentId: doc.id }, { orderBy: { lineNum: "asc" }, take: 1000 });
    if (lines.length) {
      for (const l of lines) {
        await data.create(lineObj, {
          [headerField]: header.id,
          description: String(l.description ?? "—").slice(0, 255),
          qty: l.qty ?? 1,
          unitPrice: l.unitPrice ?? l.amountNet ?? 0,
          taxCodeId: await taxCodeFor(data, l.taxRate === null || l.taxRate === undefined ? rateOf(checked) : Number(l.taxRate), direction),
        });
      }
    } else {
      // bez řádků: jeden řádek za celý základ
      await data.create(lineObj, {
        [headerField]: header.id,
        description: String(checked.docNumber ? `${t("@INT:DocLineText")} ${checked.docNumber}` : t("@INT:DocLineText")).slice(0, 255),
        qty: 1,
        unitPrice: checked.amountNet ?? checked.amountGross ?? 0,
        taxCodeId: await taxCodeFor(data, rateOf(checked), direction),
      });
    }
  }
  const numField = kind === "invoice" ? "invoiceNum" : kind === "advance" ? "advanceNum" : "orderNum";
  const fresh = (await data.get(tg.object, String(header.id)))!;
  const title = String(fresh[numField] ?? "");
  await data.update("int.document", String(doc.id), { status: "listed", resultObject: tg.object, resultId: String(header.id), resultTitle: title });
  return { object: tg.object, id: String(header.id), title };
}
