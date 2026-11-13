"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dependencyClosure, dependents, UserError, type RecordData } from "@/core/module";
import { registry } from "@/registry";
import { isAnyAdmin, login, logout, requireSession, setCompany } from "@/server/auth";
import { deleteRecord, getObject, getRecord, inTenant, listRecords, refOptions, runAction, saveRecord } from "@/server/data";
import { prisma } from "@/server/db";
import { addNote, countDocuRefs, deleteDocuRef, listDocuRefs, type DocuRefItem } from "@/server/docuref";
import { recordHistory, type HistoryEntry } from "@/server/history";
import { importRecords, readTable, type ImportReport } from "@/server/import";
import { can } from "@/core/security";
import { fromCents, toCents } from "@/core/money";
import { openShiftOf, quote, receiptPrint, sell, shiftTotals, type ReceiptPrint, type SaleInput } from "@/modules/pos/sale";
import { assertPaid, connectionsFor, eetRegisterReceipt, eetResendPending, paymentCancel, paymentStart, paymentStatus, type PaymentState } from "@/modules/int/drivers";
import { setupCompany } from "@/server/setup";
import { getT } from "@/server/i18n";
import { objectHref } from "@/server/ui";

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
  if (!ok) return { message: (await getT("cs"))("@SYS:BadLogin"), values: { email } };
  redirect("/");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}

export async function switchCompanyAction(form: FormData) {
  const s = await requireSession();
  const id = String(form.get("companyId"));
  if (s.companies.some((c) => c.id === id)) await setCompany(id);
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
  return { message: t(e.label, e.params), errors };
}

export async function saveAction(_: FormState, form: FormData): Promise<FormState> {
  const s = await requireSession();
  const objectId = String(form.get("_object"));
  const id = String(form.get("_id") || "") || null;
  const version = form.get("_version") ? Number(form.get("_version")) : undefined;
  const back = String(form.get("_back") || "");
  const fields = JSON.parse(String(form.get("_fields") ?? "[]")) as { name: string; kind: string }[];

  const input: RecordData = {};
  const titles: Record<string, string> = {};
  for (const f of fields) {
    input[f.name] = f.kind === "bool" ? form.has(`f:${f.name}`) : form.get(`f:${f.name}`);
    if (f.kind === "ref") titles[f.name] = String(form.get(`t:${f.name}`) ?? "");
  }
  let saved: RecordData;
  try {
    saved = await saveRecord(s.ctx, objectId, id, input, version);
  } catch (e) {
    return { ...(await userError(e, s.lang, s.ctx.tenantId)), values: input, titles };
  }
  revalidatePath(objectHref(objectId));
  if (back) redirect(back);
  redirect(objectHref(objectId, String(saved.id)) + (id ? "?saved=1" : ""));
}

export async function deleteAction(_: FormState, form: FormData): Promise<FormState> {
  const s = await requireSession();
  const objectId = String(form.get("_object"));
  const back = String(form.get("_back") || "") || objectHref(objectId);
  try {
    await deleteRecord(s.ctx, objectId, String(form.get("_id")));
  } catch (e) {
    return userError(e, s.lang, s.ctx.tenantId);
  }
  revalidatePath(objectHref(objectId));
  redirect(back);
}

export async function recordAction(_: FormState, form: FormData): Promise<FormState> {
  const s = await requireSession();
  const objectId = String(form.get("_object"));
  const id = String(form.get("_id"));
  try {
    await runAction(s.ctx, objectId, id, String(form.get("_action")));
  } catch (e) {
    return userError(e, s.lang, s.ctx.tenantId);
  }
  revalidatePath(objectHref(objectId, id));
  return { ok: true };
}

export async function searchRefs(objectId: string, q: string) {
  const s = await requireSession();
  getObject(objectId);
  return refOptions(s.ctx, objectId, q);
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

export async function toggleModuleAction(form: FormData) {
  const s = await requireAdmin();
  const id = String(form.get("module"));
  const mod = registry.modules.get(id);
  if (!mod || mod.core) return;
  const tenantId = s.ctx.tenantId;
  if (form.get("enable") === "1") {
    const all = [...dependencyClosure(registry, [id])].filter((m) => !s.ctx.modules.has(m));
    await prisma.sysTenantModule.createMany({ data: all.map((moduleId) => ({ tenantId, moduleId })), skipDuplicates: true });
    // výchozí nastavení nově zapnutých modulů ve všech firmách
    const enabled = new Set([...s.ctx.modules, ...all]);
    for (const c of s.companies) {
      await inTenant({ ...s.ctx, companyId: c.id, modules: enabled }, (sess) =>
        setupCompany(sess.sys().api(), new Set(all), s.lang),
      );
    }
  } else {
    // vypnout jen pokud na něm nezávisí jiný zapnutý modul (data zůstávají)
    if (dependents(registry, id).some((d) => s.ctx.modules.has(d))) return;
    await prisma.sysTenantModule.deleteMany({ where: { tenantId, moduleId: id } });
  }
  revalidatePath("/", "layout");
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
    const saved = await saveRecord(s.ctx, objectId, id, values, version);
    revalidatePath(objectHref(objectId));
    return { ok: true, data: saved };
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
    return fail(e, s.lang, s.ctx.tenantId);
  }
}

export async function runRecordAction(objectId: string, id: string, actionId: string): Promise<ActionResult> {
  const s = await requireSession();
  try {
    await runAction(s.ctx, objectId, id, actionId);
    revalidatePath(objectHref(objectId, id));
    return { ok: true, data: undefined };
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
    const table = await readTable(file.name, Buffer.from(await file.arrayBuffer()));
    const report = await importRecords(s.ctx, objectId, table, { dryRun: form.get("dryRun") === "1", lang: s.lang });
    if (report.applied) revalidatePath(objectHref(objectId));
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
    const receiptId = await inTenant(s.ctx, async (sess) => {
      const api = sess.sys().api();
      // platba kartou přes terminál: schválená transakce na stejnou částku
      const conns = withInt ? await connectionsFor(api, sale.registerId) : {};
      if (sale.payment === "card" && conns.payment && conns.payment.driver !== "manual") {
        const q = await quote(api, sale);
        await assertPaid(api, conns.payment, String(sale.paymentRef ?? ""), q.paid);
      } else sale.paymentRef = null;
      return String((await sell(api, sale)).id);
    });
    // EET až po uložení účtenky (síť nesmí držet transakci); pak dodatečné odeslání čekajících
    const data = await inTenant(s.ctx, async (sess) => {
      const api = sess.sys().api();
      let eetQueue: number | undefined;
      if (withInt) {
        const conns = await connectionsFor(api, sale.registerId);
        if (conns.eet) {
          await eetRegisterReceipt(api, s.ctx.companyId, conns.eet, (await api.get("pos.receipt", receiptId))!, true);
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

function saleInput(input: SaleInput): SaleInput {
  return {
    registerId: String(input.registerId),
    payment: input.payment === "card" ? "card" : "cash",
    cashGiven: input.cashGiven ? String(input.cashGiven) : null,
    paymentRef: input.paymentRef ? String(input.paymentRef) : null,
    lines: (Array.isArray(input.lines) ? input.lines : []).map((l) => ({ itemId: String(l.itemId), qty: String(l.qty) })),
  };
}

/** Platba kartou na terminálu: zahájení (částku spočítá server z položek). */
export async function posCardStartAction(input: SaleInput): Promise<ActionResult<PaymentState>> {
  const s = await requireSession();
  try {
    assertCan(s.ctx.perms, "pos.receipt", "write");
    const sale = { ...saleInput(input), payment: "card" as const };
    const data = await inTenant(s.ctx, async (sess) => {
      const api = sess.sys().api();
      const conn = (await connectionsFor(api, sale.registerId)).payment;
      if (!conn) throw new UserError("@INT:NoConnection");
      const q = await quote(api, sale);
      return paymentStart(api, conn, q.paid, `${q.reg.code}`);
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
  name: string;
  email: string;
  superUser: boolean;
  active: boolean;
  lang: string;
  password?: string;
  /** přiřazení k firmám, ve kterých smí editor spravovat uživatele */
  companies: UserCompanyInput[];
}

export async function saveUserAction(input: UserInput): Promise<ActionResult> {
  const s = await requireSession();
  if (!isAnyAdmin(s)) throw new Error("Forbidden");
  const t = await getT(s.lang, s.ctx.tenantId);
  const scope = new Set(s.adminCompanyIds);
  const errors: Record<string, string> = {};
  const email = input.email.trim().toLowerCase();
  if (!input.name.trim()) errors.name = t("@SYS:Required");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = t("@SYS:InvalidEmail");
  if ((!input.id || input.password) && (input.password ?? "").length < 10) errors.password = t("@SYS:PasswordTooShort");
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
    (existing.name !== input.name.trim() || existing.email !== email || existing.active !== input.active || existing.lang !== input.lang || !!input.password);
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
    name: input.name.trim(),
    email,
    role: input.superUser ? "admin" : "user",
    active: input.active,
    lang: input.lang === "en" ? "en" : "cs",
    ...(input.password ? { passwordHash: await bcrypt.hash(input.password, 12) } : {}),
  };
  await prisma.$transaction(async (tx) => {
    const user = existing
      ? await tx.sysUser.update({ where: { id: existing.id }, data })
      : await tx.sysUser.create({ data: { ...data, tenantId: s.ctx.tenantId, passwordHash: data.passwordHash! } });
    // přiřazení ve firmách editora nahradit, ostatní firmy nechat beze změny
    await tx.sysUserCompany.deleteMany({ where: { userId: user.id, companyId: { in: [...scope] } } });
    if (assignments.length) {
      await tx.sysUserCompany.createMany({ data: assignments.map((a) => ({ ...a, userId: user.id, tenantId: s.ctx.tenantId })) });
    }
    // změna hesla nebo deaktivace odhlásí ostatní relace uživatele
    if (existing && (input.password || !input.active)) await tx.sysSession.deleteMany({ where: { userId: existing.id } });
  });
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
export async function toggleFavoriteAction(href: string, label: string): Promise<boolean> {
  const s = await requireSession();
  if (!href.startsWith("/") || href.startsWith("//")) return false;
  const key = { userId_href: { userId: s.user.id, href: href.slice(0, 255) } };
  const exists = await prisma.sysFavorite.findUnique({ where: key });
  if (exists) await prisma.sysFavorite.delete({ where: key });
  else await prisma.sysFavorite.create({ data: { userId: s.user.id, href: href.slice(0, 255), label: label.slice(0, 120) } });
  revalidatePath("/", "layout");
  return !exists;
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
  if (!ids.length) return { ok: false, message: t("@SYS:NoAccess") };
  const total: Record<string, number> = {};
  for (const companyId of ids) {
    const created = await inTenant({ ...s.ctx, companyId }, (sess) => setupCompany(sess.sys().api(), s.ctx.modules, s.lang));
    for (const [k, n] of Object.entries(created)) total[k] = (total[k] ?? 0) + n;
  }
  revalidatePath("/", "layout");
  const list = Object.entries(total).map(([o, n]) => `${t(registry.objects.get(o)?.labelPlural)} ${n}`);
  return { ok: true, data: list.length ? t("@SYS:SetupDone", { list: list.join(", ") }) : t("@SYS:SetupNothing") };
}
