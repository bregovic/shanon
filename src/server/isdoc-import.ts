/**
 * Import vydaných faktur z ISDOC (.isdoc, .isdocx, PDF s ISDOC) — tlačítko Import nad vydanými fakturami.
 *
 * Založí koncept faktury s číslem z ISDOC (převod z jiného systému), odběratele najde podle IČO / DIČ,
 * jinak ho založí (IČO → ARES), řádky s daňovým kódem podle sazby a soubor přiloží. Zaúčtování zůstává
 * na uživateli. Faktura se stejným číslem = chyba (nic se nezaloží). Zkontrolovat = jen kontrola bez zápisu.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { fillLabel, resolveLabel, type Lang } from "@/core/labels";
import { UserError, type DataApi, type RecordData } from "@/core/module";
import { labelTable } from "@/registry";
import { createFromRegistry, createPartner } from "@/modules/gab/registry-lookup";
import { taxCodeFor } from "@/modules/int/documents";
import type { OcrParty, OcrResult } from "@/modules/int/ocr";
import { isdocFromFile, parseIsdoc } from "@/modules/prt/isdoc";
import { inTenant, type Ctx } from "./data";
import { addFile } from "./docuref";
import type { ImportReport } from "./import";

const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const normVat = (s: unknown) => String(s ?? "").replace(/\s/g, "").toUpperCase();

/** Je soubor ISDOC? (vrátí XML, jinak null) */
export const isdocXml = (name: string, data: Buffer) => {
  try {
    return isdocFromFile(name, data);
  } catch {
    return null;
  }
};

async function findCustomer(data: DataApi, p: OcrParty): Promise<RecordData | null> {
  const reg = digits(p.regNo);
  if (reg) {
    const [c] = await data.find("ar.customer", { regNo: reg }, { take: 1 });
    if (c) return c;
  }
  let subj: RecordData | undefined;
  if (reg) [subj] = await data.find("gab.subject", { regNo: reg }, { take: 1 });
  if (!subj && p.vatId) [subj] = await data.find("gab.subject", { vatId: normVat(p.vatId) }, { take: 1 });
  if (!subj) return null;
  const [c] = await data.find("ar.customer", { subjectId: subj.id }, { take: 1 });
  return c ?? (await createPartner(data, String(subj.id), "ar.customer"));
}

async function createCustomer(data: DataApi, p: OcrParty): Promise<RecordData> {
  const query = digits(p.regNo) || normVat(p.vatId);
  const id = query ? await createFromRegistry(data, query, {}).catch(() => null) : null;
  const subj = id
    ? await data.get("gab.subject", id)
    : await data.create("gab.subject", { name: String(p.name || p.regNo || p.vatId || "?").slice(0, 120), regNo: digits(p.regNo) || null, vatId: p.vatId ? normVat(p.vatId) : null });
  const [c] = await data.find("ar.customer", { subjectId: subj!.id }, { take: 1 });
  return c ?? (await createPartner(data, String(subj!.id), "ar.customer"));
}

/** Kontrola a založení jedné faktury (v transakci). */
async function importOne(data: DataApi, r: OcrResult, write: boolean, report: ImportReport): Promise<string | null> {
  const err = (message: string) => {
    report.errors.push({ row: 1, column: null, message });
    return null;
  };
  if (r.docType === "advance") return err("@TAX:IsdocNotInvoice");
  if (!r.docNumber) return err("@TAX:IsdocNoNumber");
  if ((await data.find("ar.invoice", { invoiceNum: r.docNumber }, { take: 1 })).length) return err("@TAX:IsdocDuplicate");
  // odběratel = příjemce faktury
  const p = r.recipient;
  if (!p.name && !p.regNo && !p.vatId) return err("@TAX:IsdocNoCustomer");
  let cust = await findCustomer(data, p);
  if (!cust && !write) {
    report.warnings.push({ row: 1, column: null, message: "@TAX:IsdocNewCustomer" });
    report.created++;
    return null;
  }
  cust ??= await createCustomer(data, p);
  if (!write) {
    report.created++;
    return null;
  }
  const [cur] = r.currency ? await data.find("sys.currency", { code: r.currency }, { take: 1 }) : [];
  const header = await data.create("ar.invoice", {
    customerId: cust.id,
    invoiceNum: r.docNumber,
    invoiceDate: r.issueDate,
    taxDate: r.taxDate ?? r.issueDate,
    dueDate: r.dueDate ?? null,
    vs: r.vs ?? null,
    currencyId: cur?.id ?? null,
    description: r.note?.slice(0, 255) ?? null,
  });
  const lines = r.lines.length ? r.lines : [{ description: r.docNumber, qty: 1, unit: null, unitPrice: r.amountNet ?? r.amountGross ?? 0, taxRate: null, amountNet: null }];
  for (const l of lines) {
    const rate = l.taxRate ?? (r.amountNet ? Math.round(((r.taxAmount ?? 0) / r.amountNet) * 100) : null);
    await data.create("ar.invoiceLine", {
      invoiceId: header.id,
      description: String(l.description ?? "—").slice(0, 255),
      qty: l.qty ?? 1,
      unitPrice: l.unitPrice ?? l.amountNet ?? 0,
      taxCodeId: await taxCodeFor(data, rate, "output"),
    });
  }
  // součet podle ISDOC — rozdíl jen upozorní (zaokrouhlení, sleva na dokladu)
  const fresh = (await data.get("ar.invoice", String(header.id)))!;
  if (r.amountGross !== null && Math.abs(Number(fresh.amountGross) - r.amountGross) >= 0.01)
    report.warnings.push({ row: 1, column: null, message: "@TAX:IsdocTotalDiffers" });
  report.created++;
  return String(header.id);
}

/** Import ISDOC do vydaných faktur (tvar výsledku jako obecný import). */
export async function importIssuedIsdoc(ctx: Ctx, file: { name: string; data: Buffer }, dryRun: boolean, lang: Lang = "cs", client?: PrismaClient): Promise<ImportReport> {
  const xml = isdocXml(file.name, file.data);
  if (!xml) throw new UserError("@INT:IsdocInvalid");
  const r = parseIsdoc(xml);
  const report: ImportReport = { total: 1, created: 0, updated: 0, skipped: 0, columns: [], missing: [], errors: [], warnings: [], applied: false };
  const id = await inTenant(ctx, (s) => importOne(s.api(), r, !dryRun, report), client);
  if (id && !report.errors.length) {
    // soubor k faktuře (vlastní transakce)
    const type = /\.pdf$/i.test(file.name) ? "application/pdf" : /\.isdocx$/i.test(file.name) ? "application/zip" : "application/xml";
    await addFile(ctx, "ar.invoice", id, { name: file.name, type, data: file.data }, client);
    report.applied = true;
  }
  // hlášky v jazyce uživatele (jako obecný import)
  const t = (ref: string) => fillLabel(resolveLabel(labelTable, ref, lang), { num: String(r.docNumber ?? "") });
  for (const x of [...report.errors, ...report.warnings]) x.message = t(x.message);
  return report;
}
