"use server";

import { markSettleSave, markSettleView, settleSave, settleView, type MarkView, type SettleView } from "@/server/journal-settle";
import type { SettleCriteria } from "@/modules/gl/settlement";
import { isEmail } from "@/core/edt";
import { headers } from "next/headers";
import { printJob, recentDocs } from "@/server/print";
import { queueStationPrint, stationClaim, stationConnect, stationDiagnostics, stationRefresh, stationSetup, type StationDiagnostics } from "@/server/station";
import { createCompanyFromRegistry } from "@/server/company-lookup";
import { createFromRegistry, lookupRegistry, type RegistryHit } from "@/modules/gab/registry-lookup";
import { disableTestEnv, enableTestEnv, testEnvState, type TestEnvState } from "@/modules/int/test-env";
import { basketForBox, boxByCode, closeBasket, openBaskets, saveBasket, type BasketView } from "@/modules/pos/basket";
import { duplicateRecord, type DuplicateResult } from "@/server/duplicate";
import bcrypt from "bcryptjs";
import { deleteCheck, usedInText } from "@/server/delete-check";
import { requestLoginHelp, sendPasswordLink, setPasswordByToken, unusablePasswordHash } from "@/server/user-invite";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dependents, UserError, type RecordData } from "@/core/module";
import { registry } from "@/registry";
import { clearLoginLock, isAnyAdmin, login, logout, requireSession, setCompany } from "@/server/auth";
import { countAllRecords, getObject, getRecord, inTenant, listRecords, previewRecord, refOptions, runAction, saveRecord } from "@/server/data";
import { prisma, withTenant } from "@/server/db";
import { addNote, countDocuRefs, deleteDocuRef, listDocuRefs, setImage, type DocuRefItem } from "@/server/docuref";
import { recordHistory, type HistoryEntry } from "@/server/history";
import { decodeText, importRecords, imagesFromUploads, readTable, type ImportReport } from "@/server/import";
import { runMigration, type MigrationReport } from "@/server/migration";
import { importIssuedIsdoc, isdocXml } from "@/server/isdoc-import";
import { runReport } from "@/server/report";
import { can } from "@/core/security";
import { fromCents, toCents } from "@/core/money";
import { openShiftOf, quote, receiptOfClient, receiptPrint, sell, sellOnInvoice, shiftTotals, type ReceiptPrint, type SaleInput, type ScaleLine } from "@/modules/pos/sale";
import { canDeleteReceipt, rewriteReceipt, stornoReceipt } from "@/modules/pos/receipt-fix";
import { sendDocumentNow } from "@/server/mail";
import { disableCompanyModules, enableCompanyModules } from "@/server/modules";
import { assertPaid, connectionsFor, eetRegisterReceipt, eetResendPending, paymentCancel, paymentStart, paymentStatus, type PaymentState } from "@/modules/int/drivers";
import { setupCompany } from "@/server/setup";
import { getT } from "@/server/i18n";
import posModule from "@/modules/pos";
import { receiptEscPos } from "@/lib/escpos";
import { objectHref } from "@/server/ui";
import { listNotices, markNoticesRead, type NoticeView } from "@/server/notices";
import { previewPosting, type PostingPreview } from "@/server/posting-preview";
import { actOnWorkItem, cancelWorkflowRun } from "@/server/workflow-bar";
import { enableModulesWithSetup } from "@/server/company-modules";

export interface FormState {
  message?: string;
  errors?: Record<string, string>;
  ok?: boolean;
  /** zadané hodnoty po neúspěšném uložení (React formulář po akci vyprázdní) */
  values?: Record<string, unknown>;
  titles?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Přihlášení
// ---------------------------------------------------------------------------

export async function loginAction(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "");
  const ok = await login(email, String(form.get("password") ?? ""));
  if (ok !== true) {
    const t = await getT("cs");
    return { message: ok ? t("@SYS:LoginLocked", { minutes: String(ok.locked) }) : t("@SYS:BadLogin"), values: { email } };
  }
  redirect("/");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}

export async function switchCompanyAction(form: FormData) {
  const s = await requireSession();
  const id = String(form.get("companyId"));
  if (s.companies.some((c) => c.id === id)) {
    await setCompany(id);
    // poslední použitá firma pro příští přihlášení (Výchozí firma = Poslední použitá)
    await prisma.sysUser.update({ where: { id: s.user.id }, data: { lastCompanyId: id } });
  }
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// Objekty — jedna sada akcí pro všechny objekty
// ---------------------------------------------------------------------------

async function userError(e: unknown, lang: Parameters<typeof getT>[0], tenantId: string): Promise<FormState> {
  if (!(e instanceof UserError)) throw e;
  const t = await getT(lang, tenantId);
  const errors: Record<string, string> = {};
  for (const [k, v] of Object.entries(e.fields ?? {})) errors[k] = t(v);
  // parametr může být label (název druhu, pole) — přeložit
  const params = Object.fromEntries(Object.entries(e.params ?? {}).map(([k, v]) => [k, v.startsWith("@") ? t(v) : v]));
  return { message: t(e.label, params), errors };
}

export async function searchRefs(objectId: string, q: string, where?: Record<string, string>) {
  const s = await requireSession();
  getObject(objectId);
  return refOptions(s.ctx, objectId, q, undefined, where);
}

// ---------------------------------------------------------------------------
// Moduly a rozšíření (jen správce tenanta)
// ---------------------------------------------------------------------------

/** superuživatel tenanta (moduly, rozšíření, nastavení všech firem) */
async function requireAdmin() {
  const s = await requireSession();
  if (!s.superUser) throw new Error("Forbidden");
  return s;
}

/** Zapnutí / vypnutí modulu v aktuální firmě (agenda firmy); ostatní firmy tenanta se nemění. */
export async function toggleModuleAction(form: FormData) {
  const s = await requireAdmin();
  const id = String(form.get("module"));
  const mod = registry.modules.get(id);
  if (!mod || mod.core || !s.ctx.companyId) return;
  const tenantId = s.ctx.tenantId;
  const companyId = s.ctx.companyId;
  if (form.get("enable") === "1") {
    // i se závislostmi a výchozím nastavením nově zapnutých modulů v této firmě
    await enableModulesWithSetup(s.ctx, companyId, [id], s.lang);
  } else {
    // vypnout i zapnuté moduly, které na něm stojí (uživatel je potvrdil v náhledu);
    // data zůstávají a po opětovném zapnutí se vrátí
    const off = [id, ...dependents(registry, id).filter((d) => s.ctx.modules.has(d))].filter((m) => !registry.modules.get(m)?.core);
    await enableCompanyModules(tenantId, companyId, s.ctx.modules); // starší data bez vlastního nastavení
    await disableCompanyModules(tenantId, companyId, off);
  }
  revalidatePath("/", "layout");
}

/** Náhled vypnutí modulu: co se vypne s ním a kolik má záznamů. */
export async function moduleDisablePreviewAction(id: string): Promise<{ id: string; label: string; records: number }[]> {
  const s = await requireAdmin();
  const t = await getT(s.lang, s.ctx.tenantId);
  const ids = [String(id), ...dependents(registry, String(id)).filter((d) => s.ctx.modules.has(d))];
  const out = [];
  for (const m of ids) {
    const mod = registry.modules.get(m);
    if (!mod || mod.core) continue;
    let records = 0;
    for (const o of mod.objects) records += await countAllRecords(s.ctx.tenantId, o.id, undefined, s.ctx.companyId);
    out.push({ id: m, label: t(mod.label), records });
  }
  return out;
}

export async function toggleExtensionAction(form: FormData) {
  const s = await requireAdmin();
  const id = String(form.get("extension"));
  const x = registry.extensions.get(id);
  if (!x || (x.visibility !== "public" && x.owner !== s.ctx.tenantId)) return;
  const tenantId = s.ctx.tenantId;
  if (form.get("enable") === "1") {
    if (!x.dependsOn.every((d) => s.ctx.modules.has(d))) return;
    await prisma.sysTenantExtension.createMany({ data: [{ tenantId, extensionId: id }], skipDuplicates: true });
  } else {
    await prisma.sysTenantExtension.deleteMany({ where: { tenantId, extensionId: id } });
  }
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// Grid a šuplík (volá klient, vrací data místo přesměrování)
// ---------------------------------------------------------------------------

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; message: string; errors?: Record<string, string> };

async function fail(e: unknown, lang: Parameters<typeof getT>[0], tenantId: string): Promise<{ ok: false; message: string; errors?: Record<string, string> }> {
  const s = await userError(e, lang, tenantId);
  return { ok: false, message: s.message ?? "", errors: s.errors };
}

export async function listAction(
  objectId: string,
  params: {
    filters?: Record<string, string>;
    sort?: string;
    dir?: "asc" | "desc";
    page?: number;
    pageSize?: number;
    filter?: Record<string, string>;
    totals?: boolean;
  },
): Promise<ActionResult<{ rows: RecordData[]; total: number; totals?: Record<string, string> }>> {
  const s = await requireSession();
  try {
    // jen povolené parametry z prohlížeče (žádné interní volby datové služby)
    const r = await listRecords(s.ctx, objectId, {
      filters: params.filters,
      sort: params.sort,
      dir: params.dir,
      page: params.page,
      pageSize: params.pageSize,
      // řádky dokladu (filtr na rodiče) celé — deník může mít stovky řádků
      maxPageSize: params.filter && Object.keys(params.filter).length ? 2000 : undefined,
      filter: params.filter,
      totals: !!params.totals,
      lang: s.lang,
    });
    return { ok: true, data: { rows: r.rows, total: r.total, totals: r.totals } };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

export async function getRecordAction(objectId: string, id: string): Promise<ActionResult<RecordData | null>> {
  const s = await requireSession();
  try {
    return { ok: true, data: await getRecord(s.ctx, objectId, id) };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

export async function saveRecordAction(
  objectId: string,
  id: string | null,
  values: RecordData,
  version?: number,
): Promise<ActionResult<RecordData>> {
  const s = await requireSession();
  try {
    const ctx = { ...s.ctx, warnings: [] as string[] };
    const saved = await saveRecord(ctx, objectId, id, values, version);
    revalidatePath(objectHref(objectId));
    return { ok: true, data: ctx.warnings.length ? { ...saved, _warnings: ctx.warnings } : saved };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

export async function deleteRecordsAction(objectId: string, ids: string[]): Promise<ActionResult> {
  const s = await requireSession();
  try {
    // jedna transakce: buď se smažou všechny, nebo žádný
    await inTenant(s.ctx, async (sess) => {
      for (const id of ids) await sess.remove(objectId, id);
    });
    revalidatePath(objectHref(objectId));
    return { ok: true, data: undefined };
  } catch (e) {
    // záznam je použitý jinde: říct kde (mazání bez dialogu — řádky v mřížce, API)
    if (e instanceof UserError && e.label === "@SYS:InUse") {
      try {
        const t = await getT(s.lang, s.ctx.tenantId);
        const where = usedInText(await deleteCheck(s.ctx, objectId, ids), t);
        if (where) return { ok: false, message: t("@SYS:InUseWhere", { where }) };
      } catch {
        // kontrola vazeb je jen doplněk hlášky
      }
    }
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Před smazáním: které vybrané záznamy smazat půjde, které ne a kde jsou použité. */
export async function deleteCheckAction(
  objectId: string,
  ids: string[],
): Promise<ActionResult<{ id: string; title: string; ok: boolean; reason?: string; refs: { label: string; count: number; titles: string[]; href?: string }[] }[]>> {
  const s = await requireSession();
  try {
    const t = await getT(s.lang, s.ctx.tenantId);
    const rows = await deleteCheck(s.ctx, objectId, ids);
    return {
      ok: true,
      data: rows.map((r) => ({
        id: r.id,
        title: r.title,
        ok: r.ok,
        reason: r.reason ? t(r.reason.label, Object.fromEntries(Object.entries(r.reason.params).map(([k, v]) => [k, v.startsWith("@") ? t(v) : v]))) : undefined,
        refs: r.refs.map((x) => ({ label: t(x.label), count: x.count, titles: x.titles, href: x.href })),
      })),
    };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Vychystávání: přehled dne. */
export async function pickBoardAction(date: string | null): Promise<ActionResult<import("@/modules/shop/picking").PickBoard>> {
  const s = await requireSession();
  try {
    const { pickBoard } = await import("@/modules/shop/picking");
    if (!can(s.ctx.perms, "shop.order", "read")) throw new UserError("@SYS:NoAccess");
    return { ok: true, data: await inTenant(s.ctx, (sess) => pickBoard(sess.sys().api(), date)) };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Vychystávání: skutečné množství řádku / Chybí / vrátit (prázdné). Vrací varování (víc než rezerva). */
export async function pickSetAction(pickId: string, qty: string | null, missing: boolean): Promise<ActionResult<{ warnings: string[] }>> {
  const s = await requireSession();
  try {
    if (!can(s.ctx.perms, "shop.order", "write")) throw new UserError("@SYS:NoAccess");
    const { setPick } = await import("@/modules/shop/picking");
    const wctx = { ...s.ctx, warnings: [] as string[] };
    await inTenant(wctx, (sess) => setPick(sess.sys().api(), pickId, qty, missing));
    return { ok: true, data: { warnings: wctx.warnings } };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Vychystávání: dokončit objednávku (faktura podle skutečnosti) a poslat fakturu zákazníkovi e-mailem. */
export async function pickCompleteAction(shopOrderId: string): Promise<ActionResult<{ message: string; warnings: string[] }>> {
  const s = await requireSession();
  try {
    if (!can(s.ctx.perms, "shop.order", "write") || !can(s.ctx.perms, "ar.invoice", "write")) throw new UserError("@SYS:NoAccess");
    const { completePick } = await import("@/modules/shop/picking");
    const invoiceId = await inTenant(s.ctx, (sess) => completePick(sess.sys().api(), shopOrderId));
    const t = await getT(s.lang, s.ctx.tenantId);
    const so = await getRecord(s.ctx, "shop.order", shopOrderId);
    const inv = await getRecord(s.ctx, "ar.invoice", invoiceId);
    const warnings: string[] = [];
    // e-mail mimo transakci; nevyjde-li (bez napojení pošty), faktura zůstane a pošle se ručně
    try {
      const { sendDocumentNow } = await import("@/server/mail");
      if (so?.email) await sendDocumentNow(s.ctx, "ar.invoice", invoiceId, String(so.email));
    } catch {
      warnings.push(t("@SHOP:PickMailFailed"));
    }
    revalidatePath("/shop/vychystani");
    return { ok: true, data: { message: t("@SHOP:PickCompleted", { num: String(so?.orderNum ?? ""), invoice: String(inv?.invoiceNum ?? "") }), warnings } };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Sloučit vybrané záznamy (`ObjectDef.mergeable`) — jedna transakce. */
export async function mergeRecordsAction(objectId: string, ids: string[]): Promise<ActionResult<{ id: string; title: string }>> {
  const s = await requireSession();
  try {
    const { mergeRecords } = await import("@/server/merge");
    const def = registry.objects.get(objectId);
    const kept = await inTenant(s.ctx, (sess) => mergeRecords(sess, objectId, ids));
    revalidatePath(objectHref(objectId));
    return { ok: true, data: { id: String(kept.id), title: String(kept[def?.titleField ?? "id"] ?? "") } };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Proužek workflow: vyřídit úkol (Schválit / Zamítnout / Hotovo s komentářem), záznam se pak načte znovu. */
export async function workflowItemAction(itemId: string, action: "approve" | "reject" | "done", comment: string | null, objectId: string, recordId: string): Promise<ActionResult<undefined>> {
  const s = await requireSession();
  try {
    await actOnWorkItem(s.ctx, itemId, action, comment);
    revalidatePath(objectHref(objectId, recordId));
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Proužek workflow: zrušit běh. */
export async function cancelWorkflowAction(instanceId: string, objectId: string, recordId: string): Promise<ActionResult<undefined>> {
  const s = await requireSession();
  try {
    await cancelWorkflowRun(s.ctx, instanceId);
    revalidatePath(objectHref(objectId, recordId));
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

export async function runRecordAction(objectId: string, id: string, actionId: string): Promise<ActionResult<{ open?: string; warnings?: string[]; message?: string; warn?: boolean } | undefined>> {
  const s = await requireSession();
  try {
    const wctx = { ...s.ctx, warnings: [] as string[] };
    const out = await runAction(wctx, objectId, id, actionId);
    const warnings = wctx.warnings.length ? wctx.warnings : undefined;
    revalidatePath(objectHref(objectId, id));
    // fronta (doklady ke zpracování): další záznam, který čeká; žádný = seznam
    const def = registry.objects.get(objectId);
    const next = def?.actions?.find((a) => a.id === actionId)?.next;
    if (next) {
      const sortField = def!.numberSeq?.field ?? def!.defaultSort?.field ?? "createdAt";
      const n = (await inTenant(s.ctx, (x) => x.api().find(objectId, { [next.field]: { in: next.in } }, { take: 2, orderBy: { [sortField]: "asc" } }))).find((r) => r.id !== id);
      return { ok: true, data: { open: n ? objectHref(objectId, String(n.id)) : objectHref(objectId), warnings } };
    }
    // akce může otevřít vzniklý záznam (koncept e-mailu…)
    if (out?.href && out.href.startsWith("/")) return { ok: true, data: { open: out.href, warnings } };
    const msg = out?.message ? { message: out.message, warn: !!out.warn } : {};
    return { ok: true, data: out?.open ? { open: objectHref(out.open.object, out.open.id), warnings, ...msg } : warnings || out?.message ? { warnings, ...msg } : undefined };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Akce se souborem (import výpisu…). Soubor do 1 MB — víc server action nepřijme. */
export async function runUploadAction(form: FormData): Promise<ActionResult> {
  const s = await requireSession();
  const objectId = String(form.get("objectId"));
  const id = String(form.get("id"));
  const file = form.get("file");
  try {
    if (!(file instanceof File)) throw new UserError("@SYS:Required");
    await runAction(s.ctx, objectId, id, String(form.get("actionId")), undefined, {
      name: file.name,
      data: Buffer.from(await file.arrayBuffer()),
    });
    revalidatePath(objectHref(objectId, id));
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Import CSV/XML/Excel do číselníku; `dryRun` = jen kontrola, nic se neuloží. */
export async function importAction(form: FormData): Promise<ActionResult<ImportReport>> {
  const s = await requireSession();
  const objectId = String(form.get("objectId"));
  const file = form.get("file");
  try {
    if (!(file instanceof File) || !file.size) throw new UserError("@SYS:Required");
    const buf = Buffer.from(await file.arrayBuffer());
    // vydané faktury: soubor ISDOC (.isdoc, .isdocx, PDF s ISDOC) založí koncept faktury
    if (objectId === "ar.invoice") {
      if (isdocXml(file.name, buf)) {
        const report = await importIssuedIsdoc(s.ctx, { name: file.name, data: buf }, form.get("dryRun") === "1", s.lang);
        if (report.applied) revalidatePath(objectHref(objectId));
        return { ok: true, data: report };
      }
    }
    const table = await readTable(file.name, buf);
    // obrázky ke sloupci Obrázek: soubory ze zvolené složky (název = relativní cesta)
    const uploads: { path: string; data: Buffer }[] = [];
    for (const f of form.getAll("images")) if (f instanceof File && f.size) uploads.push({ path: f.name, data: Buffer.from(await f.arrayBuffer()) });
    // řádky dokladu: pevný odkaz na rodiče (jen pole typu odkaz daného objektu)
    let fixed: Record<string, string> | undefined;
    if (form.get("fixed")) {
      const def = registry.objects.get(objectId);
      const raw = JSON.parse(String(form.get("fixed"))) as Record<string, unknown>;
      fixed = Object.fromEntries(Object.entries(raw).filter(([k, v]) => def?.fields[k]?.edt.kind === "ref" && /^[0-9a-f-]{36}$/i.test(String(v))).map(([k, v]) => [k, String(v)]));
    }
    const report = await importRecords(s.ctx, objectId, table, { dryRun: form.get("dryRun") === "1", lang: s.lang, images: imagesFromUploads(uploads), fixed });
    if (report.applied) revalidatePath(objectHref(objectId));
    return { ok: true, data: report };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Migrace firmy ze souboru JSON (Organizace → Migrace firmy); `dryRun` = jen kontrola. Jen superuživatel. */
export async function migrationAction(form: FormData): Promise<ActionResult<MigrationReport>> {
  const s = await requireSession();
  try {
    if (!s.superUser) throw new UserError("@SYS:NoAccess");
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new UserError("@SYS:Required");
    let raw: unknown;
    try {
      raw = JSON.parse(decodeText(Buffer.from(await file.arrayBuffer())));
    } catch {
      throw new UserError("@ORG:MigFormat");
    }
    const uploads: { path: string; data: Buffer }[] = [];
    for (const f of form.getAll("images")) if (f instanceof File && f.size) uploads.push({ path: f.name, data: Buffer.from(await f.arrayBuffer()) });
    const report = await runMigration(s.ctx, raw, {
      dryRun: form.get("dryRun") === "1",
      lang: s.lang,
      images: imagesFromUploads(uploads),
      invite: (userId) => sendPasswordLink(s.ctx.tenantId, userId, "invite", { name: s.user.name, email: s.user.email }, s.tenant.name),
    });
    if (report.applied) revalidatePath("/", "layout");
    return { ok: true, data: report };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

// ---------------------------------------------------------------------------
// Pokladna (terminál /kasa) — ceny i DPH počítá server z položek
// ---------------------------------------------------------------------------

function assertCan(perms: Parameters<typeof can>[0], objectId: string, level: "read" | "write") {
  if (!can(perms, objectId, level)) throw new UserError("@SYS:NoAccess");
}

export async function posOpenShiftAction(registerId: string, openingCash: string): Promise<ActionResult> {
  const s = await requireSession();
  try {
    await saveRecord(s.ctx, "pos.shift", null, { registerId, openingCash: openingCash || "0" });
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

export async function posSellAction(input: SaleInput): Promise<ActionResult<ReceiptPrint>> {
  const s = await requireSession();
  try {
    assertCan(s.ctx.perms, "pos.receipt", "write");
    const sale = saleInput(input);
    const withInt = s.ctx.modules.has("int");
    const done = await inTenant(s.ctx, async (sess) => {
      const api = sess.sys().api();
      if (withInt) sale.verifiedScale = await verifiedScaleOf(api, sale.registerId);
      // platba kartou přes terminál: schválená transakce na stejnou částku
      const conns = withInt ? await connectionsFor(api, sale.registerId) : {};
      if (sale.payment === "card" && conns.payment && conns.payment.driver !== "manual") {
        const q = await quote(api, sale);
        await assertPaid(api, conns.payment, String(sale.paymentRef ?? ""), q.paid);
      } else sale.paymentRef = null;
      // oprava účtenky: původní se stornuje ve stejné transakci (opakované odeslání téhož prodeje už ne)
      let stornoId: string | null = null;
      if (sale.replacesId && !(await receiptOfClient(api, sale.clientId))) {
        const orig = await api.get("pos.receipt", sale.replacesId);
        if (!orig || orig.registerId !== sale.registerId) throw new UserError("@SYS:NotFound");
        stornoId = String((await stornoReceipt(api, orig)).id);
      }
      return { id: String((await sell(api, sale)).id), stornoId };
    });
    const receiptId = done.id;
    // EET až po uložení účtenky (síť nesmí držet transakci); pak dodatečné odeslání čekajících
    const data = await inTenant(s.ctx, async (sess) => {
      const api = sess.sys().api();
      let eetQueue: number | undefined;
      if (withInt) {
        const conns = await connectionsFor(api, sale.registerId);
        // QR platba je převod na účet — do EET nepatří (eviduje se hotovost a karta)
        const rec = (await api.get("pos.receipt", receiptId))!;
        // opakované odeslání téhož prodeje (clientId): EET už proběhla
        // storno opravované účtenky (byla v EET) se odešle se zápornou tržbou
        const storno = done.stornoId ? await api.get("pos.receipt", done.stornoId) : null;
        if (conns.eet && storno?.eetStatus === "pending") await eetRegisterReceipt(api, s.ctx.companyId, conns.eet, storno, true);
        if (conns.eet && sale.payment !== "qr" && !rec.eetStatus) {
          await eetRegisterReceipt(api, s.ctx.companyId, conns.eet, rec, true);
          eetQueue = (await eetResendPending(api, s.ctx.companyId, sale.registerId, 5)).pending;
        }
      }
      return { ...(await receiptPrint(api, s.ctx.companyId, receiptId)), eetQueue };
    });
    return { ok: true, data };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Odběratelé pro pokladnu (hledání podle názvu, IČO nebo čísla). */
export async function posCustomersAction(q: string): Promise<ActionResult<{ id: string; name: string; regNo: string; vatId: string; email: string }[]>> {
  const s = await requireSession();
  try {
    assertCan(s.ctx.perms, "pos.receipt", "write");
    if (!s.ctx.modules.has("ar")) return { ok: true, data: [] };
    const needle = String(q ?? "").trim().toLowerCase().slice(0, 60);
    const data = await inTenant(s.ctx, async (sess) => {
      const api = sess.sys().api();
      const out: { id: string; name: string; regNo: string; vatId: string; email: string }[] = [];
      for (const c of await api.find("ar.customer", { blocked: false }, { take: 2000, orderBy: { accountNum: "asc" } })) {
        const subj = c.subjectId ? await api.get("gab.subject", String(c.subjectId)) : null;
        const row = { id: String(c.id), name: String(subj?.name ?? c.accountNum), regNo: String(subj?.regNo ?? ""), vatId: String(subj?.vatId ?? ""), email: String(c.docEmail || subj?.email || "") };
        if (!needle || `${row.name} ${row.regNo} ${c.accountNum}`.toLowerCase().includes(needle)) out.push(row);
        if (out.length >= 30) break;
      }
      return out;
    });
    return { ok: true, data };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Prodej na fakturu známému odběrateli (zaúčtovaná vydaná faktura, bez účtenky). */
export async function posInvoiceAction(input: SaleInput): Promise<ActionResult<{ id: string; invoiceNum: string; amount: string; dueDate: string; email: string }>> {
  const s = await requireSession();
  try {
    assertCan(s.ctx.perms, "pos.receipt", "write");
    assertCan(s.ctx.perms, "ar.invoice", "write");
    const sale = { ...saleInput(input), payment: "invoice" as const };
    const data = await inTenant(s.ctx, async (sess) => {
      const api = sess.sys().api();
      if (s.ctx.modules.has("int")) sale.verifiedScale = await verifiedScaleOf(api, sale.registerId);
      const inv = await sellOnInvoice(api, sale);
      const c = await api.get("ar.customer", String(inv.customerId));
      const subj = c?.subjectId ? await api.get("gab.subject", String(c.subjectId)) : null;
      return { id: String(inv.id), invoiceNum: String(inv.invoiceNum), amount: String(inv.amountGross), dueDate: String(inv.dueDate ?? "").slice(0, 10), email: String(c?.docEmail || subj?.email || "") };
    });
    return { ok: true, data };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Odeslat účtenku nebo fakturu z pokladny e-mailem (PDF, napojení pošty). */
export async function posMailAction(kind: "receipt" | "invoice", id: string, to: string): Promise<ActionResult<{ test: boolean; testTo: string | null }>> {
  const s = await requireSession();
  try {
    assertCan(s.ctx.perms, "pos.receipt", "write");
    if (!s.ctx.modules.has("int")) throw new UserError("@INT:MailNoConnection");
    const email = String(to ?? "").trim();
    if (!isEmail(email)) throw new UserError("@SYS:InvalidEmail");
    const sent = await sendDocumentNow(s.ctx, kind === "invoice" ? "ar.invoice" : "pos.receipt", String(id), email);
    return { ok: true, data: { test: sent.test, testTo: sent.testTo } };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

function saleInput(input: SaleInput): SaleInput {
  return {
    registerId: String(input.registerId),
    customerId: input.customerId ? String(input.customerId) : null,
    // odběratel jen na účtenku (bez evidence) — jen když není vybraný známý odběratel
    buyer:
      !input.customerId && input.buyer
        ? { name: String(input.buyer.name ?? ""), street: String(input.buyer.street ?? ""), zip: String(input.buyer.zip ?? ""), city: String(input.buyer.city ?? "") }
        : null,
    payment: input.payment === "card" ? "card" : input.payment === "qr" ? "qr" : "cash",
    cashGiven: input.cashGiven ? String(input.cashGiven) : null,
    paymentRef: input.paymentRef ? String(input.paymentRef) : null,
    basketId: input.basketId ? String(input.basketId) : null,
    clientId: input.clientId ? String(input.clientId).slice(0, 36) : null,
    replacesId: input.replacesId && /^[0-9a-f-]{36}$/i.test(String(input.replacesId)) ? String(input.replacesId) : null,
    lines: (Array.isArray(input.lines) ? input.lines : []).map((l) => ({ itemId: String(l.itemId), qty: String(l.qty), scale: scaleLineOf(l.scale), manual: l.manual === true })),
  };
}

/** údaje z váhy od terminálu: jen texty v očekávaném tvaru (kontrolu tvaru a ceny dělá prodej) */
function scaleLineOf(v: unknown): ScaleLine | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const str = (k: string, n = 40) => String(o[k] ?? "").slice(0, n);
  return { weight: str("weight"), unitPrice: str("unitPrice"), total: str("total"), raw: str("raw", 2000), weighedAt: str("weighedAt") };
}

/** Pokladna s ověřenou vahou (Dialog 06): údaj bere server z napojení, terminál ho poslat nemůže.
 *  Kasa bez váhy (`template = till`) váhu nemá ani v terminálu (kasa/[id]/page.tsx) — vážené zboží se v ní
 *  zadává ručně; dřív ho tady server přesto vyžadoval z váhy a platba skončila „… se váží na váze“. */
async function verifiedScaleOf(api: Parameters<typeof connectionsFor>[0], registerId: string): Promise<SaleInput["verifiedScale"]> {
  const reg = await api.get("pos.register", registerId).catch(() => null);
  if (reg?.template === "till") return null;
  const conn = (await connectionsFor(api, registerId)).scale;
  if (!conn || conn.scaleProtocol !== "dialog06") return null;
  return { name: String(conn.name ?? conn.code ?? ""), serial: (conn.scaleSerial as string) || null, protocol: "dialog06" };
}

/** Platba kartou na terminálu: zahájení (částku spočítá server z položek). */
export async function posCardStartAction(input: SaleInput): Promise<ActionResult<PaymentState>> {
  const s = await requireSession();
  // simulátor brány: odkaz na testovací platební stránku (QR do telefonu)
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost"}`;
  try {
    assertCan(s.ctx.perms, "pos.receipt", "write");
    const sale = { ...saleInput(input), payment: "card" as const };
    const data = await inTenant(s.ctx, async (sess) => {
      const api = sess.sys().api();
      const conn = (await connectionsFor(api, sale.registerId)).payment;
      if (!conn) throw new UserError("@INT:NoConnection");
      sale.verifiedScale = await verifiedScaleOf(api, sale.registerId);
      const q = await quote(api, sale);
      return paymentStart(api, conn, q.paid, `${q.reg.code}`, { origin, tenantId: s.ctx.tenantId });
    });
    return { ok: true, data };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

export async function posCardStatusAction(registerId: string, ref: string, cancel = false): Promise<ActionResult<PaymentState | null>> {
  const s = await requireSession();
  try {
    assertCan(s.ctx.perms, "pos.receipt", "write");
    const data = await inTenant(s.ctx, async (sess) => {
      const api = sess.sys().api();
      const conn = (await connectionsFor(api, String(registerId))).payment;
      if (!conn) throw new UserError("@INT:NoConnection");
      if (cancel) {
        await paymentCancel(api, conn, String(ref));
        return null;
      }
      return paymentStatus(api, conn, String(ref));
    });
    return { ok: true, data };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Účtenka v seznamu kasy (směna): oprava, storno, opakovaný tisk. */
export interface PosReceiptRow {
  id: string;
  receiptNum: string;
  at: string;
  paid: string;
  payment: string;
  payStatus: string | null;
  customerId: string | null;
  customerName: string;
  buyer: { name: string; street: string; zip: string; city: string } | null;
  /** of = storno jiné účtenky, by = stornovaná */
  storno: "of" | "by" | null;
  canDelete: boolean;
  /** jde přepsat na stejném čísle (Otevřít → Přepsat účtenku) */
  canRewrite: boolean;
  lines: { itemId: string; qty: string; scale: ScaleLine | null }[];
}

/** Účtenky otevřené směny pokladny (nejnovější nahoře). */
export async function posShiftReceiptsAction(registerId: string): Promise<ActionResult<PosReceiptRow[]>> {
  const s = await requireSession();
  try {
    assertCan(s.ctx.perms, "pos.receipt", "read");
    const data = await inTenant(s.ctx, async (sess) => {
      const api = sess.sys().api();
      const sh = await openShiftOf(api, String(registerId));
      if (!sh) return [];
      const rs = await api.find("pos.receipt", { shiftId: sh.id }, { take: 200, orderBy: { createdAt: "desc" } });
      if (!rs.length) return [];
      // hromadně: řádky, odběratelé a jejich subjekty
      const lines = await api.find("pos.receiptLine", { receiptId: { in: rs.map((r) => r.id) } }, { take: 20000 });
      const custIds = [...new Set(rs.map((r) => r.customerId).filter(Boolean).map(String))];
      const custs = custIds.length && s.ctx.modules.has("ar") ? await api.find("ar.customer", { id: { in: custIds } }, { take: custIds.length }) : [];
      const subjIds = [...new Set(custs.map((c) => c.subjectId).filter(Boolean).map(String))];
      const subjs = subjIds.length ? await api.find("gab.subject", { id: { in: subjIds } }, { take: subjIds.length }) : [];
      const custName = (id: unknown) => {
        const c = custs.find((x) => x.id === id);
        return String(subjs.find((x) => x.id === c?.subjectId)?.name ?? c?.accountNum ?? "");
      };
      // smazat jde jen poslední účtenku řady – stačí ověřit nejnovější
      const newest = rs.find((r) => !r.offline);
      const deletable = newest && can(s.ctx.perms, "pos.receipt", "delete") && (await canDeleteReceipt(api, newest)) ? String(newest.id) : null;
      const shiftOpen = sh.status === "open";
      return rs.map((r): PosReceiptRow => ({
        id: String(r.id),
        receiptNum: String(r.receiptNum),
        at: String(r.soldAt ?? r.createdAt ?? ""),
        paid: String(r.amountPaid ?? "0"),
        payment: String(r.paymentMethod),
        payStatus: (r.payStatus as string) ?? null,
        customerId: (r.customerId as string) ?? null,
        customerName: r.customerId ? custName(r.customerId) : "",
        buyer: r.buyerName || r.buyerStreet || r.buyerCity ? { name: String(r.buyerName ?? ""), street: String(r.buyerStreet ?? ""), zip: String(r.buyerZip ?? ""), city: String(r.buyerCity ?? "") } : null,
        storno: r.stornoOfId ? "of" : r.stornoId ? "by" : null,
        canDelete: deletable === String(r.id),
        // stejná pravidla jako canRewriteReceipt (směna je otevřená – bez dotazu za účtenku)
        canRewrite: shiftOpen && !r.stornoOfId && !r.stornoId && !r.eetStatus && !r.emailedAt && !r.paymentRef && !r.offline && r.payStatus !== "paid",
        lines: lines
          .filter((l) => l.receiptId === r.id)
          .map((l) => ({
            itemId: String(l.itemId),
            qty: String(Number(l.qty)),
            // vážení z ověřené váhy: stejné údaje z váhy (cena za kg se znovu ověří proti ceníku)
            scale: l.scaleWeight
              ? { weight: Number(l.scaleWeight).toFixed(3), unitPrice: Number(l.scaleUnitPrice).toFixed(2), total: Number(l.scaleTotal).toFixed(2), raw: String(l.scaleRaw ?? ""), weighedAt: String(l.weighedAt ?? "") }
              : null,
          })),
      }));
    });
    return { ok: true, data };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Přepsat účtenku na stejném čísle (kasa → Otevřít → Přepsat účtenku): řádky a částky podle nákupu. */
export async function posRewriteAction(input: SaleInput): Promise<ActionResult<ReceiptPrint>> {
  const s = await requireSession();
  try {
    assertCan(s.ctx.perms, "pos.receipt", "write");
    const sale = saleInput(input);
    if (!sale.replacesId) throw new UserError("@SYS:InvalidValue");
    const data = await inTenant(s.ctx, async (sess) => {
      const api = sess.sys().api();
      if (s.ctx.modules.has("int")) sale.verifiedScale = await verifiedScaleOf(api, sale.registerId);
      const r = await api.get("pos.receipt", sale.replacesId!);
      if (!r) throw new UserError("@SYS:NotFound");
      await rewriteReceipt(api, r, sale);
      return receiptPrint(api, s.ctx.companyId, String(r.id));
    });
    return { ok: true, data };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/**
 * Tisk účtenek ze seznamu / detailu na síťovou tiskárnu Epson pokladny (napojení Epson v síti): data ESC/POS
 * po tiskárnách, prohlížeč je pošle přes ePOS. Prázdné = pokladna síťovou tiskárnu nemá (tisk jako dosud).
 */
export async function posNetPrintAction(ids: string[]): Promise<ActionResult<{ jobs: { host: string; data: string; count: number }[]; ok: string; down: string }>> {
  const s = await requireSession();
  try {
    assertCan(s.ctx.perms, "pos.receipt", "read");
    if (!s.ctx.modules.has("int")) return { ok: true, data: { jobs: [], ok: "", down: "" } };
    const list = (Array.isArray(ids) ? ids : []).map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 50);
    const lang = s.lang ?? "cs";
    const locale = lang === "en" ? "en-GB" : "cs-CZ";
    const money = new Intl.NumberFormat(locale, { style: "currency", currency: "CZK" });
    const fmt = (v: string | number) => money.format(Number(v));
    const t = await getT(lang, s.ctx.tenantId);
    const L = Object.fromEntries(Object.keys(posModule.labels.cs).map((k) => [k, t(`@POS:${k}`)]));
    const jobs = await inTenant(s.ctx, async (sess) => {
      const api = sess.sys().api();
      const byHost = new Map<string, Uint8Array[]>();
      const conns = new Map<string, RecordData | undefined>();
      for (const id of list) {
        const r = await api.get("pos.receipt", id);
        if (!r) continue;
        const regId = String(r.registerId);
        if (!conns.has(regId)) conns.set(regId, (await connectionsFor(api, regId)).printer);
        const c = conns.get(regId);
        if (!c || c.driver !== "escposNet" || !c.printerHost) continue;
        const pr = await receiptPrint(api, s.ctx.companyId, id);
        // opakovaný tisk: bez otevření zásuvky
        const bytes = receiptEscPos(pr, L, fmt, { width: c.paperWidth === "58" ? 32 : 48, codePage: c.codePage === "ascii" ? "ascii" : "cp852", drawer: false, locale });
        const host = String(c.printerHost).trim().replace(/\.+$/, "");
        byHost.set(host, [...(byHost.get(host) ?? []), bytes]);
      }
      return [...byHost].map(([host, parts]) => {
        const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
        let o = 0;
        for (const p of parts) {
          all.set(p, o);
          o += p.length;
        }
        return { host, data: Buffer.from(all).toString("base64"), count: parts.length };
      });
    });
    return { ok: true, data: { jobs, ok: t("@POS:NetPrinted"), down: t("@POS:PrinterNetDown") } };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Účtenka k opakovanému tisku / odeslání. */
export async function posReceiptPrintAction(id: string): Promise<ActionResult<ReceiptPrint>> {
  const s = await requireSession();
  try {
    assertCan(s.ctx.perms, "pos.receipt", "read");
    const data = await inTenant(s.ctx, (sess) => receiptPrint(sess.sys().api(), s.ctx.companyId, String(id)));
    return { ok: true, data };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Stornovat účtenku z kasy: opravná účtenka v otevřené směně, EET hned (síť mimo transakci). */
export async function posStornoAction(id: string): Promise<ActionResult<ReceiptPrint>> {
  const s = await requireSession();
  try {
    assertCan(s.ctx.perms, "pos.receipt", "write");
    const st = await inTenant(s.ctx, async (sess) => {
      const api = sess.sys().api();
      const r = await api.get("pos.receipt", String(id));
      if (!r) throw new UserError("@SYS:NotFound");
      return stornoReceipt(api, r);
    });
    const data = await inTenant(s.ctx, async (sess) => {
      const api = sess.sys().api();
      if (s.ctx.modules.has("int") && st.eetStatus === "pending") {
        const conns = await connectionsFor(api, String(st.registerId));
        if (conns.eet) await eetRegisterReceipt(api, s.ctx.companyId, conns.eet, (await api.get("pos.receipt", String(st.id)))!, true);
      }
      return receiptPrint(api, s.ctx.companyId, String(st.id));
    });
    return { ok: true, data };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Změnit odběratele účtenky z kasy (bez nové účtenky) — pravidla obsluhy pos.receipt (receipt-fix.ts). */
export async function posReceiptCustomerAction(id: string, customerId: string | null, buyer: { name?: string; street?: string; zip?: string; city?: string } | null): Promise<ActionResult<ReceiptPrint>> {
  const s = await requireSession();
  try {
    assertCan(s.ctx.perms, "pos.receipt", "write");
    const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n) || null;
    const b = customerId ? null : buyer;
    await saveRecord(s.ctx, "pos.receipt", String(id), {
      customerId: customerId ? String(customerId) : null,
      buyerName: clip(b?.name, 255),
      buyerStreet: clip(b?.street, 255),
      buyerZip: clip(b?.zip, 20),
      buyerCity: clip(b?.city, 255),
    });
    const data = await inTenant(s.ctx, (sess) => receiptPrint(sess.sys().api(), s.ctx.companyId, String(id)));
    return { ok: true, data };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Ruční dodatečné odeslání neodeslaných tržeb EET. */
export async function posEetResendAction(registerId: string): Promise<ActionResult<{ sent: number; pending: number }>> {
  const s = await requireSession();
  try {
    assertCan(s.ctx.perms, "pos.receipt", "write");
    const data = await inTenant(s.ctx, (sess) => eetResendPending(sess.sys().api(), s.ctx.companyId, String(registerId), 50));
    return { ok: true, data };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

export async function posShiftSummaryAction(registerId: string): Promise<ActionResult<Record<string, string | number> | null>> {
  const s = await requireSession();
  try {
    assertCan(s.ctx.perms, "pos.shift", "read");
    const data = await inTenant(s.ctx, async (sess) => {
      const api = sess.sys().api();
      const sh = await openShiftOf(api, String(registerId));
      if (!sh) return null;
      const t = await shiftTotals(api, String(sh.id));
      return {
        shiftNum: String(sh.shiftNum),
        receiptCount: t.receiptCount,
        gross: fromCents(t.gross),
        tax: fromCents(t.tax),
        cash: fromCents(t.cash),
        card: fromCents(t.card),
        qr: fromCents(t.qr),
        rounding: fromCents(t.rounding),
        openingCash: String(sh.openingCash ?? "0.00"),
        expectedCash: fromCents(toCents(sh.openingCash) + t.cash),
      };
    });
    return { ok: true, data };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

export async function posCloseShiftAction(registerId: string): Promise<ActionResult> {
  const s = await requireSession();
  try {
    await inTenant(s.ctx, async (sess) => {
      const sh = await openShiftOf(sess.sys().api(), String(registerId));
      if (!sh) throw new UserError("@POS:ShiftNotOpen");
      await sess.action("pos.shift", String(sh.id), "close");
    });
    revalidatePath(objectHref("pos.shift"));
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Obrázek záznamu (nahrání / odebrání). Vrací id nového souboru. */
export async function uploadImageAction(form: FormData): Promise<ActionResult<string | null>> {
  const s = await requireSession();
  const objectId = String(form.get("objectId"));
  const id = String(form.get("id"));
  const field = String(form.get("field"));
  const file = form.get("file");
  try {
    const data = file instanceof File && file.size ? { name: file.name, data: Buffer.from(await file.arrayBuffer()) } : null;
    const res = await setImage(s.ctx, objectId, id, field, data);
    revalidatePath(objectHref(objectId));
    return { ok: true, data: res };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Report: parametry → výsledek (sloupce s popisky a řádky). */
export async function runReportAction(module: string, id: string, params: RecordData) {
  const s = await requireSession();
  try {
    return { ok: true as const, data: await runReport(s, String(module), String(id), params ?? {}) };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

// ---------------------------------------------------------------------------
// Moje nastavení (každý přihlášený jen sám sobě)
// ---------------------------------------------------------------------------

const NOTIFY_KEYS = ["dailySummary", "overdueInvoices", "integrationErrors"] as const;

export async function saveProfileAction(input: { firstName: string; lastName: string; lang: string; notify: Record<string, boolean>; defaultCompanyId?: string | null }): Promise<ActionResult> {
  const s = await requireSession();
  const t = await getT(s.lang, s.ctx.tenantId);
  const firstName = String(input.firstName ?? "").trim().slice(0, 60);
  const lastName = String(input.lastName ?? "").trim().slice(0, 60);
  const name = `${firstName} ${lastName}`.trim();
  const errs: Record<string, string> = {};
  if (!firstName) errs.firstName = t("@SYS:Required");
  if (!lastName) errs.lastName = t("@SYS:Required");
  if (Object.keys(errs).length) return { ok: false, message: t("@SYS:FixErrors"), errors: errs };
  const notify = Object.fromEntries(NOTIFY_KEYS.map((k) => [k, !!input.notify?.[k]]));
  // výchozí firma jen z firem, kam uživatel smí
  const defaultCompanyId = input.defaultCompanyId && s.companies.some((c) => c.id === input.defaultCompanyId) ? input.defaultCompanyId : null;
  await prisma.sysUser.update({ where: { id: s.user.id }, data: { name, firstName, lastName, lang: input.lang === "en" ? "en" : "cs", notify, defaultCompanyId } });
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function changePasswordAction(input: { current: string; next: string; repeat: string }): Promise<ActionResult> {
  const s = await requireSession();
  const t = await getT(s.lang, s.ctx.tenantId);
  const next = String(input.next ?? "");
  if (next.length < 10) return { ok: false, message: t("@SYS:PasswordRules"), errors: { next: t("@SYS:PasswordRules") } };
  if (next !== input.repeat) return { ok: false, message: t("@SYS:PasswordMismatch"), errors: { repeat: t("@SYS:PasswordMismatch") } };
  const u = await prisma.sysUser.findUniqueOrThrow({ where: { id: s.user.id } });
  if (!(await bcrypt.compare(String(input.current ?? ""), u.passwordHash))) return { ok: false, message: t("@SYS:WrongPassword"), errors: { current: t("@SYS:WrongPassword") } };
  await prisma.sysUser.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(next, 12) } });
  return { ok: true, data: undefined };
}

export async function setPosPinAction(pin: string): Promise<ActionResult> {
  const s = await requireSession();
  const t = await getT(s.lang, s.ctx.tenantId);
  const p = String(pin ?? "");
  if (p && !/^\d{4,6}$/.test(p)) return { ok: false, message: t("@SYS:PosPinInvalid"), errors: { pin: t("@SYS:PosPinInvalid") } };
  await prisma.sysUser.update({ where: { id: s.user.id }, data: { posPinHash: p ? await bcrypt.hash(p, 10) : null } });
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Uživatelé (superuživatel všechny, správce firmy jen ve svých firmách)
// ---------------------------------------------------------------------------

export interface UserCompanyInput {
  companyId: string;
  admin: boolean;
  roleIds: string[];
}

export interface UserInput {
  id: string | null;
  firstName: string;
  lastName: string;
  email: string;
  superUser: boolean;
  active: boolean;
  lang: string;
  password?: string;
  /** nový uživatel bez hesla: poslat pozvánku e-mailem (heslo si nastaví odkazem) */
  sendInvite?: boolean;
  /** přiřazení k firmám, ve kterých smí editor spravovat uživatele */
  companies: UserCompanyInput[];
}

export async function saveUserAction(input: UserInput): Promise<ActionResult<{ mailed?: boolean; mailError?: string }>> {
  const s = await requireSession();
  if (!isAnyAdmin(s)) throw new Error("Forbidden");
  const t = await getT(s.lang, s.ctx.tenantId);
  const scope = new Set(s.adminCompanyIds);
  const errors: Record<string, string> = {};
  const email = input.email.trim().toLowerCase();
  const firstName = String(input.firstName ?? "").trim().slice(0, 60);
  const lastName = String(input.lastName ?? "").trim().slice(0, 60);
  const name = `${firstName} ${lastName}`.trim();
  if (!firstName) errors.firstName = t("@SYS:Required");
  if (!lastName) errors.lastName = t("@SYS:Required");
  if (!isEmail(email)) errors.email = t("@SYS:InvalidEmail");
  // nový uživatel: heslo, nebo pozvánka (heslo si nastaví sám); změna hesla = aspoň 10 znaků
  const invite = !input.id && !input.password && !!input.sendInvite;
  if (!invite && (!input.id || input.password) && (input.password ?? "").length < 10) errors.password = t(input.id ? "@SYS:PasswordTooShort" : "@SYS:PasswordOrInvite");
  const other = await prisma.sysUser.findUnique({ where: { email } });
  if (other && other.id !== input.id) errors.email = t("@SYS:EmailTaken");
  if (Object.keys(errors).length) return { ok: false, message: t("@SYS:FixErrors"), errors };

  const existing = input.id
    ? await prisma.sysUser.findFirst({ where: { id: input.id, tenantId: s.ctx.tenantId }, include: { companies: true } })
    : null;
  if (input.id && !existing) return { ok: false, message: t("@SYS:NotFound") };

  // správce firmy nesmí dělat superuživatele ani sahat na superuživatele
  if (!s.superUser && (input.superUser || existing?.role === "admin")) return { ok: false, message: t("@SYS:NoAccess") };
  const outside = (existing?.companies ?? []).filter((a) => !scope.has(a.companyId));
  const basicChanged =
    !!existing &&
    (existing.name !== name || existing.email !== email || existing.active !== input.active || existing.lang !== input.lang || !!input.password);
  if (!s.superUser && outside.length && basicChanged) return { ok: false, message: t("@SYS:OtherCompanies") };

  // přiřazení jen do firem v rozsahu editora a jen existující role tenanta
  const roles = new Set((await inTenant(s.ctx, (sess) => sess.sys().find("sys.role", {}, 1000))).map((r) => String(r.id)));
  const assignments = input.companies
    .filter((a) => scope.has(a.companyId))
    .map((a) => ({ companyId: a.companyId, admin: !!a.admin, roleIds: a.roleIds.filter((r) => roles.has(r)) }));
  if (!s.superUser && !input.superUser && assignments.length + outside.length === 0) return { ok: false, message: t("@SYS:NeedCompany") };

  // nesmí zmizet poslední aktivní superuživatel
  if (existing?.role === "admin" && (!input.superUser || !input.active)) {
    const supers = await prisma.sysUser.count({ where: { tenantId: s.ctx.tenantId, role: "admin", active: true } });
    if (supers <= 1) return { ok: false, message: t("@SYS:LastSuper") };
  }

  const data = {
    name,
    firstName,
    lastName,
    email,
    role: input.superUser ? "admin" : "user",
    active: input.active,
    lang: input.lang === "en" ? "en" : "cs",
    ...(input.password ? { passwordHash: await bcrypt.hash(input.password, 12) } : {}),
  };
  let created: string | null = null;
  await prisma.$transaction(async (tx) => {
    const user = existing
      ? await tx.sysUser.update({ where: { id: existing.id }, data })
      : await tx.sysUser.create({ data: { ...data, tenantId: s.ctx.tenantId, passwordHash: data.passwordHash ?? (await unusablePasswordHash()), passwordSetAt: data.passwordHash ? new Date() : null } });
    created = user.id;
    // přiřazení ve firmách editora nahradit, ostatní firmy nechat beze změny
    await tx.sysUserCompany.deleteMany({ where: { userId: user.id, companyId: { in: [...scope] } } });
    if (assignments.length) {
      await tx.sysUserCompany.createMany({ data: assignments.map((a) => ({ ...a, userId: user.id, tenantId: s.ctx.tenantId })) });
    }
    // změna hesla nebo deaktivace odhlásí ostatní relace uživatele
    if (existing && (input.password || !input.active)) await tx.sysSession.deleteMany({ where: { userId: existing.id } });
  });
  // nové heslo / e-mail od správce: zámek po neúspěšných pokusech se ruší, ať se uživatel hned přihlásí
  if (input.password || existing?.email !== email) {
    clearLoginLock(email);
    if (existing) clearLoginLock(existing.email);
  }
  let mailed: boolean | undefined;
  let mailError: string | undefined;
  if (invite && created) {
    // uživatel je uložený i když pozvánka neodejde — jde poslat znovu z jeho karty
    try {
      mailed = await sendPasswordLink(s.ctx.tenantId, created, "invite", { name: s.user.name, email: s.user.email }, s.tenant.name);
    } catch (e) {
      mailed = false;
      mailError = e instanceof UserError ? (await userError(e, s.lang, s.ctx.tenantId)).message : String(e);
    }
  }
  revalidatePath("/system/users");
  return { ok: true, data: { mailed, mailError } };
}

/**
 * Pozvánka znovu / reset hesla správcem: odkaz na nastavení hesla e-mailem. Stejná práva jako úprava
 * uživatele (správce firmy jen běžné uživatele svých firem). Reset zároveň odhlásí uživatele a zruší zámek.
 */
export async function sendUserMailAction(id: string, kind: "invite" | "reset"): Promise<ActionResult<{ mailed: boolean }>> {
  const s = await requireSession();
  if (!isAnyAdmin(s)) throw new Error("Forbidden");
  const t = await getT(s.lang, s.ctx.tenantId);
  const user = await prisma.sysUser.findFirst({ where: { id, tenantId: s.ctx.tenantId }, include: { companies: true } });
  if (!user) return { ok: false, message: t("@SYS:NotFound") };
  if (!s.superUser) {
    const scope = new Set(s.adminCompanyIds);
    if (user.role === "admin" || user.companies.some((a) => !scope.has(a.companyId))) return { ok: false, message: t("@SYS:NoAccess") };
  }
  try {
    if (kind === "reset") {
      await prisma.sysSession.deleteMany({ where: { userId: user.id } });
      clearLoginLock(user.email);
    }
    const mailed = await sendPasswordLink(s.ctx.tenantId, user.id, kind, { name: s.user.name, email: s.user.email }, s.tenant.name);
    revalidatePath("/system/users");
    return { ok: true, data: { mailed } };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Nastavení hesla z odkazu v pozvánce / resetu (bez přihlášení) → rovnou přihlásit. */
export async function setPasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const t = await getT("cs");
  const password = String(form.get("password") ?? "");
  if (password !== String(form.get("password2") ?? "")) return { message: t("@SYS:PasswordMismatch") };
  let email: string;
  try {
    email = await setPasswordByToken(String(form.get("token") ?? ""), password);
  } catch (e) {
    return userError(e, "cs", "");
  }
  if ((await login(email, password)) !== true) redirect("/login");
  redirect("/");
}

/** „Nemůžu se přihlásit“ z přihlašovací stránky → e-mail správci. Odpověď je vždy stejná. */
export async function loginHelpAction(_: FormState, form: FormData): Promise<FormState> {
  const t = await getT("cs");
  const email = String(form.get("email") ?? "");
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || "?";
  try {
    await requestLoginHelp(email, String(form.get("message") ?? ""), ip);
  } catch (e) {
    if (e instanceof UserError) return { message: t(e.label), values: { email } };
    console.error("žádost o pomoc s přihlášením neodešla", e);
  }
  return { values: { email, sent: "1" } };
}

/**
 * Smazat uživatele (přihlášení, oblíbené a přiřazení k firmám s ním). Sebe ne, posledního aktivního superuživatele ne;
 * správce firmy jen běžného uživatele, který je jen v jeho firmách. Jeho otevřené úkoly zůstanou nepřiřazené (uvidí je správci).
 */
export async function deleteUserAction(id: string): Promise<ActionResult> {
  const s = await requireSession();
  if (!isAnyAdmin(s)) throw new Error("Forbidden");
  const t = await getT(s.lang, s.ctx.tenantId);
  const user = await prisma.sysUser.findFirst({ where: { id, tenantId: s.ctx.tenantId }, include: { companies: true } });
  if (!user) return { ok: false, message: t("@SYS:NotFound") };
  if (user.id === s.user.id) return { ok: false, message: t("@SYS:CannotDeleteSelf") };
  if (!s.superUser) {
    const scope = new Set(s.adminCompanyIds);
    if (user.role === "admin" || user.companies.some((a) => !scope.has(a.companyId))) return { ok: false, message: t("@SYS:NoAccess") };
  }
  if (user.role === "admin" && user.active) {
    const supers = await prisma.sysUser.count({ where: { tenantId: s.ctx.tenantId, role: "admin", active: true } });
    if (supers <= 1) return { ok: false, message: t("@SYS:LastSuper") };
  }
  try {
    await prisma.sysUser.delete({ where: { id: user.id } });
    await withTenant(s.ctx.tenantId, async (tx) => {
      await tx.wfWorkItem.updateMany({ where: { tenantId: s.ctx.tenantId, assignedTo: user.id, status: "open" }, data: { assignedTo: null } });
      await tx.sysAudit.create({ data: { tenantId: s.ctx.tenantId, objectId: "sys.user", recordId: user.id, action: "delete", userId: s.user.id, changes: { name: [user.name, null], email: [user.email, null] } } });
    });
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
  revalidatePath("/system/users");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// DocuRef (poznámky a soubory u záznamů)
// ---------------------------------------------------------------------------

export async function docuRefListAction(objectId: string, recordId: string): Promise<ActionResult<DocuRefItem[]>> {
  const s = await requireSession();
  try {
    return { ok: true, data: await listDocuRefs(s.ctx, objectId, recordId) };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

export async function docuRefCountAction(objectId: string, recordId: string): Promise<number> {
  const s = await requireSession();
  return countDocuRefs(s.ctx, objectId, recordId);
}

export async function addNoteAction(objectId: string, recordId: string, name: string, note: string): Promise<ActionResult> {
  const s = await requireSession();
  try {
    await addNote(s.ctx, objectId, recordId, name, note);
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

export async function deleteDocuRefAction(id: string): Promise<ActionResult> {
  const s = await requireSession();
  try {
    await deleteDocuRef(s.ctx, id);
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

// ---------------------------------------------------------------------------
// Historie změn a oblíbené
// ---------------------------------------------------------------------------

export async function historyAction(objectId: string, recordId: string): Promise<ActionResult<HistoryEntry[]>> {
  const s = await requireSession();
  try {
    const t = await getT(s.lang, s.ctx.tenantId);
    return { ok: true, data: await recordHistory(s.ctx, objectId, recordId, t, s.lang) };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Přidá / odebere stránku z oblíbených; vrací nový stav. */
const RECENT_MAX = 10;

/** Nedávné uživatele (nejnovější první). */
export async function recentAction(): Promise<{ href: string; label: string; module: string }[]> {
  const s = await requireSession();
  return prisma.sysRecent.findMany({ where: { userId: s.user.id }, orderBy: { openedAt: "desc" }, take: RECENT_MAX, select: { href: true, label: true, module: true } });
}

/** Otevřená funkce z menu → do Nedávných; drží se jen RECENT_MAX nejnovějších (starší se smažou). */
export async function touchRecentAction(href: string, label: string, module: string): Promise<{ href: string; label: string; module: string }[]> {
  const s = await requireSession();
  if (!href.startsWith("/") || href.startsWith("//")) return recentAction();
  const h = href.slice(0, 1000);
  await prisma.sysRecent.upsert({
    where: { userId_href: { userId: s.user.id, href: h } },
    create: { userId: s.user.id, href: h, label: label.slice(0, 120), module: module.slice(0, 120) },
    update: { label: label.slice(0, 120), module: module.slice(0, 120), openedAt: new Date() },
  });
  const keep = await prisma.sysRecent.findMany({ where: { userId: s.user.id }, orderBy: { openedAt: "desc" }, take: RECENT_MAX, select: { href: true, label: true, module: true } });
  await prisma.sysRecent.deleteMany({ where: { userId: s.user.id, href: { notIn: keep.map((k) => k.href) } } });
  return keep;
}

export async function toggleFavoriteAction(href: string, label: string): Promise<boolean> {
  const s = await requireSession();
  if (!href.startsWith("/") || href.startsWith("//")) return false;
  const key = { userId_href: { userId: s.user.id, href: href.slice(0, 1000) } };
  const exists = await prisma.sysFavorite.findUnique({ where: key });
  if (exists) await prisma.sysFavorite.delete({ where: key });
  else await prisma.sysFavorite.create({ data: { userId: s.user.id, href: href.slice(0, 1000), label: label.slice(0, 120) } });
  revalidatePath("/", "layout");
  return !exists;
}

/** Uložit pohled (seznam s filtry a řazením) nebo stránku do oblíbených pod názvem a do složky. */
export async function saveFavoriteAction(href: string, label: string, folder: string): Promise<void> {
  const s = await requireSession();
  if (!href.startsWith("/") || href.startsWith("//") || !label.trim()) return;
  const data = { label: label.trim().slice(0, 120), folder: folder.trim().slice(0, 60) || null };
  await prisma.sysFavorite.upsert({
    where: { userId_href: { userId: s.user.id, href: href.slice(0, 1000) } },
    create: { userId: s.user.id, href: href.slice(0, 1000), ...data },
    update: data,
  });
  revalidatePath("/", "layout");
}

/** Úprava oblíbených: přejmenování, složka, odebrání (jen vlastní záznamy uživatele). */
export async function updateFavoritesAction(items: { href: string; label: string; folder: string; remove?: boolean }[]): Promise<void> {
  const s = await requireSession();
  for (const it of items.slice(0, 500)) {
    const where = { userId_href: { userId: s.user.id, href: String(it.href).slice(0, 1000) } };
    if (it.remove) await prisma.sysFavorite.deleteMany({ where: { userId: s.user.id, href: String(it.href) } });
    else if (String(it.label).trim())
      await prisma.sysFavorite.update({ where, data: { label: String(it.label).trim().slice(0, 120), folder: String(it.folder ?? "").trim().slice(0, 60) || null } }).catch(() => null);
  }
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// Výchozí nastavení (číselné řady a další výchozí data modulů)
// ---------------------------------------------------------------------------

/** Doplní chybějící výchozí nastavení ve firmě (nebo ve všech firmách tenanta). */
export async function runSetupAction(allCompanies: boolean): Promise<ActionResult<string>> {
  const s = await requireSession();
  const t = await getT(s.lang, s.ctx.tenantId);
  // superuživatel všechny firmy, správce firmy jen ty své
  const ids = (allCompanies ? s.companies.map((c) => c.id) : s.ctx.companyId ? [s.ctx.companyId] : []).filter((id) =>
    s.adminCompanyIds.includes(id),
  );
  // Společná data (DAT) nedostávají výchozí nastavení (jen parametry, které správce zadá)
  const dat = await prisma.sysCompany.findFirst({ where: { tenantId: s.ctx.tenantId, dat: true }, select: { id: true } });
  if (dat && ids.includes(dat.id)) ids.splice(ids.indexOf(dat.id), 1);
  if (!ids.length) return { ok: false, message: t("@SYS:NoAccess") };
  const total: Record<string, number> = {};
  try {
    for (const companyId of ids) {
      const created = await inTenant({ ...s.ctx, companyId }, (sess) => setupCompany(sess.sys().api(), s.ctx.modules, s.lang));
      for (const [k, n] of Object.entries(created)) total[k] = (total[k] ?? 0) + n;
    }
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
  revalidatePath("/", "layout");
  const list = Object.entries(total).map(([o, n]) => `${t(registry.objects.get(o)?.labelPlural)} ${n}`);
  return { ok: true, data: list.length ? t("@SYS:SetupDone", { list: list.join(", ") }) : t("@SYS:SetupNothing") };
}

/** Duplikovat: doklad s číselnou řadou se zkopíruje i s řádky ({ id }), jinak předvyplněné hodnoty nového záznamu. */
export async function duplicateRecordAction(objectId: string, id: string): Promise<ActionResult<DuplicateResult | null>> {
  const s = await requireSession();
  try {
    return { ok: true, data: await duplicateRecord(s.ctx, objectId, id) };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

// ---------------------------------------------------------------------------
// Odložené nákupy (boxy) — sdílené všemi pokladnami firmy
// ---------------------------------------------------------------------------

export async function posBasketsAction(): Promise<ActionResult<BasketView[]>> {
  const s = await requireSession();
  try {
    assertCan(s.ctx.perms, "pos.receipt", "write");
    return { ok: true, data: await inTenant(s.ctx, (sess) => openBaskets(sess.sys().api())) };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Kód boxu (QR / ručně) → jeho otevřený nákup, případně nový prázdný; null = není kód boxu. */
export async function posBasketOpenAction(registerId: string, code: string): Promise<ActionResult<BasketView | null>> {
  const s = await requireSession();
  try {
    assertCan(s.ctx.perms, "pos.receipt", "write");
    return {
      ok: true,
      data: await inTenant(s.ctx, async (sess) => {
        const api = sess.sys().api();
        const box = await boxByCode(api, String(code));
        return box ? basketForBox(api, box, String(registerId)) : null;
      }),
    };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

export async function posBasketSaveAction(input: {
  id?: string | null;
  label?: string | null;
  boxCode?: string | null;
  registerId: string;
  version?: number;
  lines: { itemId: string; qty: string }[];
}): Promise<ActionResult<BasketView>> {
  const s = await requireSession();
  try {
    assertCan(s.ctx.perms, "pos.receipt", "write");
    const clean = {
      id: input.id ? String(input.id) : null,
      label: input.label ? String(input.label).slice(0, 120) : null,
      boxCode: input.boxCode ? String(input.boxCode) : null,
      registerId: String(input.registerId),
      version: typeof input.version === "number" ? input.version : undefined,
      lines: (Array.isArray(input.lines) ? input.lines : []).map((l) => ({ itemId: String(l.itemId), qty: String(l.qty), scale: scaleLineOf((l as { scale?: unknown }).scale) })),
    };
    return { ok: true, data: await inTenant(s.ctx, (sess) => saveBasket(sess.sys().api(), clean)) };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

export async function posBasketCancelAction(id: string): Promise<ActionResult> {
  const s = await requireSession();
  try {
    assertCan(s.ctx.perms, "pos.receipt", "write");
    await inTenant(s.ctx, (sess) => closeBasket(sess.sys().api(), String(id), "cancelled"));
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Integrace → Testovací prostředí: zapnout / vypnout (testovací napojení a data). */
export async function intTestEnvAction(on: boolean): Promise<ActionResult<TestEnvState>> {
  const s = await requireSession();
  try {
    assertCan(s.ctx.perms, "int.connection", "write");
    const t = await getT(s.lang, s.ctx.tenantId);
    const data = await inTenant(s.ctx, async (sess) => {
      const api = sess.sys().api();
      if (on) await enableTestEnv(api, t, s.ctx.modules.has("pos"));
      else await disableTestEnv(api);
      return testEnvState(api);
    });
    return { ok: true, data };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Adresář → Založit podle IČO / DIČ: náhled nálezu (ARES / VIES). */
export async function gabLookupAction(query: string, target: "subject" | "company" = "subject"): Promise<ActionResult<RegistryHit | null>> {
  const s = await requireSession();
  try {
    if (target === "company" ? !s.superUser : !can(s.ctx.perms, "gab.subject", "read")) throw new UserError("@SYS:NoAccess");
    return { ok: true, data: await inTenant(s.ctx, (sess) => lookupRegistry(sess.sys().api(), String(query).slice(0, 20), target === "company" ? "company" : "subject")) };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

export async function gabCreateFromRegistryAction(query: string, opts: { vendor?: boolean; customer?: boolean }): Promise<ActionResult<string>> {
  const s = await requireSession();
  try {
    assertCan(s.ctx.perms, "gab.subject", "write");
    const o = { vendor: !!opts.vendor && s.ctx.modules.has("ap"), customer: !!opts.customer && s.ctx.modules.has("ar") };
    if (o.vendor) assertCan(s.ctx.perms, "ap.vendor", "write");
    if (o.customer) assertCan(s.ctx.perms, "ar.customer", "write");
    return { ok: true, data: await inTenant(s.ctx, (sess) => createFromRegistry(sess.sys().api(), String(query).slice(0, 20), o)) };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

// ---------------------------------------------------------------------------
// Tiskové sestavy
// ---------------------------------------------------------------------------

/** Data dokladu pro náhled v návrháři. */
export async function printPreviewAction(docType: string, recordId: string): Promise<ActionResult<Record<string, unknown>>> {
  const s = await requireSession();
  try {
    return { ok: true, data: (await printJob(s.ctx, String(docType), String(recordId))).data };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

export async function printRecentAction(docType: string, q: string): Promise<ActionResult<{ id: string; number: string }[]>> {
  const s = await requireSession();
  try {
    return { ok: true, data: await recentDocs(s.ctx, String(docType), String(q ?? "").slice(0, 40)) };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Uložit rozvržení šablony (návrhář). */
export async function printSaveLayoutAction(templateId: string, layout: string): Promise<ActionResult> {
  const s = await requireSession();
  try {
    if (layout.length > 2_000_000) throw new UserError("@PRT:ImageTooBig");
    await saveRecord(s.ctx, "prt.template", String(templateId), { layout: String(layout) });
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Správa systému → Založit firmu podle IČO / DIČ (jen superuživatel): firma, výchozí nastavení, údaje organizace se sídlem. */
export async function createCompanyFromRegistryAction(query: string): Promise<ActionResult<string>> {
  const s = await requireSession();
  try {
    if (!s.superUser) throw new UserError("@SYS:NoAccess");
    const id = await createCompanyFromRegistry(s.ctx, String(query).slice(0, 20));
    return { ok: true, data: id };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Banka → Hromadný import výpisů: jeden soubor (může mít víc výpisů a účtů). */
export async function bankBulkImportAction(form: FormData): Promise<ActionResult<import("@/server/bank-import").BulkRow[]>> {
  const s = await requireSession();
  try {
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new UserError("@SYS:Required");
    const { importStatementsBulk } = await import("@/server/bank-import");
    const rows = await importStatementsBulk(s, { name: file.name, data: Buffer.from(await file.arrayBuffer()) });
    return { ok: true, data: rows };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Hromadná akce nad vybranými záznamy seznamu (výpisy → deník HK…); každý záznam zvlášť. */
export async function bulkRecordAction(objectId: string, ids: string[], actionId: string, input?: Record<string, string>): Promise<ActionResult<{ ok: number; errors: string[] }>> {
  const s = await requireSession();
  const t = await getT(s.lang, s.ctx.tenantId);
  let ok = 0;
  const errors: string[] = [];
  for (const id of ids.slice(0, 500)) {
    try {
      const wctx = { ...s.ctx, warnings: [] as string[] };
      await runAction(wctx, objectId, id, actionId, undefined, undefined, input ? Object.fromEntries(Object.entries(input).map(([k, v]) => [String(k), String(v)])) : undefined);
      errors.push(...wctx.warnings);
      ok++;
    } catch (e) {
      errors.push(e instanceof UserError ? t(e.label, e.params) : e instanceof Error ? e.message : String(e));
    }
  }
  revalidatePath(objectHref(objectId));
  return { ok: true, data: { ok, errors } };
}

/**
 * Integrace → Načíst doklady: jeden soubor = jeden doklad ke zpracování
 * (příloha), volitelně hned vytěžit. Volá se po souborech (limit těla akce).
 */
export async function docImportAction(form: FormData): Promise<ActionResult<{ id: string; docNum: string; status: string; message: string | null }>> {
  const s = await requireSession();
  try {
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new UserError("@SYS:Required");
    const name = file.name.slice(0, 200);
    if (!/\.(pdf|jpe?g|png|webp|isdoc|isdocx|xml)$/i.test(name)) throw new UserError("@INT:OcrFileType");
    const target = String(form.get("target") ?? "auto");
    // volby z nahrání: druh dokladu, úhrada, zaměstnanec (placeno zaměstnancem) — přednost před vytěžením
    const choice: Record<string, string | null> = {};
    const dt = String(form.get("docType") ?? "");
    if (["invoice", "receipt", "donation"].includes(dt)) choice.docType = dt;
    const pay = String(form.get("paymentState") ?? "");
    if (["toPay", "paid", "employee"].includes(pay)) choice.paymentState = pay;
    const emp = String(form.get("employeeId") ?? "");
    if (pay === "employee" && /^[0-9a-f-]{36}$/i.test(emp)) choice.employeeId = emp;
    const doc = await saveRecord(s.ctx, "int.document", null, { fileName: name, target, ...choice });
    const { addFile } = await import("@/server/docuref");
    await addFile(s.ctx, "int.document", String(doc.id), { name, type: file.type, data: Buffer.from(await file.arrayBuffer()) });
    let out = doc;
    if (form.get("extract") === "1") {
      const { extractDocument } = await import("@/server/doc-import");
      out = await extractDocument(s.ctx, String(doc.id)).catch(async () => (await getRecord(s.ctx, "int.document", String(doc.id)))!);
      // vytěžení mohlo druh přepsat — volba uživatele platí (a kontrola znovu)
      if (choice.docType && out.docType !== choice.docType && out.status !== "listed") {
        const cur = (await getRecord(s.ctx, "int.document", String(doc.id)))!;
        await saveRecord(s.ctx, "int.document", String(doc.id), { ...cur, docType: choice.docType }, cur.version as number);
        await runAction(s.ctx, "int.document", String(doc.id), "check").catch(() => undefined);
        out = (await getRecord(s.ctx, "int.document", String(doc.id)))!;
      }
    }
    return { ok: true, data: { id: String(doc.id), docNum: String(out.docNum ?? doc.docNum), status: String(out.status), message: (out.message as string) ?? null } };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Pokladna: odemknout PINem (cookie pro uživatele a pokladnu). */
export async function posUnlockAction(registerId: string, pin: string): Promise<ActionResult<"ok" | "wrong" | "wait">> {
  const s = await requireSession();
  try {
    const reg = await getRecord(s.ctx, "pos.register", registerId);
    if (!reg) throw new UserError("@SYS:NotFound");
    const raw = await inTenant(s.ctx, (sess) => sess.tx.posRegister.findFirst({ where: { id: registerId, tenantId: s.ctx.tenantId } }));
    const { unlock } = await import("@/server/pos-lock");
    return { ok: true, data: await unlock(s.user.id, { ...reg, pin: raw?.pin ?? null }, String(pin).replace(/\D/g, "").slice(0, 4)) };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Pokladna: zamknout (směna zůstává otevřená). */
export async function posLockAction(registerId: string): Promise<ActionResult> {
  const s = await requireSession();
  const { lock } = await import("@/server/pos-lock");
  await lock(registerId);
  void s;
  return { ok: true, data: undefined };
}

/** Zvoneček: upozornění aktuální firmy. */
export async function noticesAction(): Promise<{ items: NoticeView[]; unread: number }> {
  const s = await requireSession();
  return listNotices(s.ctx, s.lang);
}

export async function markNoticesReadAction(ids: string[]): Promise<void> {
  const s = await requireSession();
  await markNoticesRead(s.ctx, Array.isArray(ids) ? ids.map(String) : []);
}

/** Náhled hodnot před uložením (doplnění z položky, čísla z řady) — nic se nezapíše. */
export async function previewRecordAction(
  objectId: string,
  id: string | null,
  values: Record<string, unknown>,
): Promise<ActionResult<{ values: Record<string, unknown>; titles: Record<string, string>; provisional: string[] }>> {
  const s = await requireSession();
  try {
    const r = await previewRecord(s.ctx, objectId, id, values as RecordData);
    const { _titles, _provisional, ...vals } = r as RecordData & { _titles?: Record<string, string>; _provisional?: string[] };
    return { ok: true, data: { values: vals, titles: _titles ?? {}, provisional: _provisional ?? [] } };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Náhled dokladu: zaúčtování nanečisto (zápisy HK a DPH), nic se nezapíše. */
export async function previewPostingAction(objectId: string, id: string): Promise<ActionResult<PostingPreview>> {
  const s = await requireSession();
  try {
    return { ok: true, data: await previewPosting(s.ctx, objectId, id) };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/**
 * Tisk na tiskárnu tiskové stanice (Shanon Pokladna): úloha do fronty stanice. `data` null = pro doklad
 * žádná tiskárna stanice → tiskne prohlížeč. `stationId` = počítač, ze kterého se tiskne (zástupce stanice).
 */
export async function stationPrintAction(docType: string, ids: string[], stationId?: string | null, templateId?: string | null): Promise<ActionResult<{ message: string; warn: boolean } | null>> {
  const s = await requireSession();
  try {
    const r = await queueStationPrint(s.ctx, docType, ids, { stationId: stationId && /^[0-9a-f-]{36}$/.test(stationId) ? stationId : null, templateId });
    if (!r) return { ok: true, data: null };
    const t = await getT(s.lang, s.ctx.tenantId);
    return { ok: true, data: { message: t(r.online ? "@INT:StationQueued" : "@INT:StationOffline", { printer: r.printer, device: r.device }), warn: !r.online } };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Nastavení → Nainstalovat na tento počítač: instalátor Shanon Pokladna (`stationId` = zařízení ze zástupce, jinak nové). */
export async function stationSetupAction(stationId?: string | null, pair = true, browser?: string): Promise<ActionResult<{ href: string; deviceId: string }>> {
  const s = await requireSession();
  try {
    if (!s.ctx.modules.has("int") || !can(s.ctx.perms, "int.device", "write")) throw new UserError("@SYS:NoAccess");
    return { ok: true, data: await stationSetup(s.ctx, stationId && /^[0-9a-f-]{36}$/.test(stationId) ? stationId : null, { pair: pair !== false, browser: typeof browser === "string" ? browser : undefined }) };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Deník → Vyrovnat: otevřené položky salda k řádku (podle kritérií). */
export async function settleViewAction(lineId: string, criteria: SettleCriteria): Promise<ActionResult<SettleView>> {
  const s = await requireSession();
  try {
    return { ok: true, data: await settleView(s.ctx, lineId, criteria ?? {}, s.lang) };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Deník → Vyrovnat → Uložit: vybrané položky a částky (prázdný seznam = zrušit vyrovnání). */
export async function settleSaveAction(lineId: string, items: { kind: "customer" | "vendor"; type?: "invoice" | "advance" | "agreement"; transId: string; amount: string }[]): Promise<ActionResult<null>> {
  const s = await requireSession();
  try {
    await settleSave(s.ctx, lineId, Array.isArray(items) ? items.slice(0, 200) : []);
    return { ok: true, data: null };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Doklad → Označit k vyrovnání: nezaúčtované řádky deníků k vyrovnání s dokladem. */
export async function markSettleViewAction(objectId: string, id: string, criteria: { all?: boolean; vs?: string; amount?: string }): Promise<ActionResult<MarkView>> {
  const s = await requireSession();
  try {
    return { ok: true, data: await markSettleView(s.ctx, objectId, id, criteria ?? {}, s.lang) };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Doklad → Označit k vyrovnání → uložit: řádek deníku vyrovná doklad při zaúčtování. */
export async function markSettleSaveAction(objectId: string, id: string, lineId: string, amount: string): Promise<ActionResult<null>> {
  const s = await requireSession();
  try {
    await markSettleSave(s.ctx, objectId, id, lineId, String(amount ?? ""));
    return { ok: true, data: null };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Nastavení → Tento prohlížeč tiskne přes počítač: zařízení dostane uživatele (pozná ho tisk i z jiných prohlížečů). */
export async function stationClaimAction(deviceId: string): Promise<ActionResult<null>> {
  const s = await requireSession();
  try {
    if (!/^[0-9a-f-]{36}$/.test(deviceId) || !s.ctx.modules.has("int")) throw new UserError("@SYS:InvalidValue");
    await stationClaim(s.ctx, deviceId);
    return { ok: true, data: null };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Nastavení → Diagnostika tohoto počítače (stanice, tiskárny, kam se tiskne). */
export async function stationDiagnosticsAction(browserStationId: string | null, deviceId?: string | null): Promise<ActionResult<StationDiagnostics>> {
  const s = await requireSession();
  try {
    if (!s.ctx.modules.has("int")) throw new UserError("@SYS:NoAccess");
    const uuid = (v?: string | null) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);
    // vybrané zařízení (detail zařízení) jen s právem číst zařízení
    if (uuid(deviceId) && !can(s.ctx.perms, "int.device", "read")) throw new UserError("@SYS:NoAccess");
    return { ok: true, data: await stationDiagnostics(s.ctx, uuid(browserStationId), uuid(deviceId)) };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Diagnostika → Zkušební stránka na tiskárnu počítače. */
export async function stationTestPageAction(printerId: string): Promise<ActionResult<null>> {
  const s = await requireSession();
  try {
    if (!/^[0-9a-f-]{36}$/.test(printerId)) throw new UserError("@SYS:InvalidValue");
    await runAction(s.ctx, "int.devicePrinter", printerId, "test");
    return { ok: true, data: null };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Diagnostika → Používat (tiskárna se nabízí v pravidlech a u pokladny) / Uložit do katalogu. */
export async function stationPrinterAction(printerId: string, op: "enable" | "disable" | "toCatalog"): Promise<ActionResult<{ message?: string }>> {
  const s = await requireSession();
  try {
    if (!/^[0-9a-f-]{36}$/.test(printerId)) throw new UserError("@SYS:InvalidValue");
    if (op === "toCatalog") {
      const r = await runAction(s.ctx, "int.devicePrinter", printerId, "toCatalog");
      return { ok: true, data: { message: r && typeof r === "object" ? r.message : undefined } };
    }
    if (op !== "enable" && op !== "disable") throw new UserError("@SYS:InvalidValue");
    await saveRecord(s.ctx, "int.devicePrinter", printerId, { enabled: op === "enable" });
    return { ok: true, data: {} };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

/** Diagnostika → Obnovit stav: stanice hned nahlásí tiskárny a jejich stav. */
/** Diagnostika → Připojit sdílenou tiskárnu z katalogu (stanice ji připojí ve Windows). */
export async function stationConnectAction(deviceId: string, modelId: string): Promise<ActionResult<null>> {
  const s = await requireSession();
  try {
    if (!/^[0-9a-f-]{36}$/.test(deviceId) || !/^[0-9a-f-]{36}$/.test(modelId) || !s.ctx.modules.has("int")) throw new UserError("@SYS:InvalidValue");
    if (!can(s.ctx.perms, "int.devicePrinter", "write")) throw new UserError("@SYS:NoAccess");
    await stationConnect(s.ctx, deviceId, modelId);
    return { ok: true, data: null };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

export async function stationRefreshAction(deviceId: string): Promise<ActionResult<null>> {
  const s = await requireSession();
  try {
    if (!/^[0-9a-f-]{36}$/.test(deviceId) || !s.ctx.modules.has("int")) throw new UserError("@SYS:InvalidValue");
    await stationRefresh(s.ctx, deviceId);
    return { ok: true, data: null };
  } catch (e) {
    return fail(e, s.lang, s.ctx.tenantId);
  }
}
