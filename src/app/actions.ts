"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dependencyClosure, dependents, UserError, type RecordData } from "@/core/module";
import { registry } from "@/registry";
import { login, logout, requireSession, setCompany } from "@/server/auth";
import { deleteRecord, getObject, getRecord, inTenant, listRecords, refOptions, runAction, saveRecord } from "@/server/data";
import { prisma } from "@/server/db";
import { addNote, countDocuRefs, deleteDocuRef, listDocuRefs, type DocuRefItem } from "@/server/docuref";
import { recordHistory, type HistoryEntry } from "@/server/history";
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

async function requireAdmin() {
  const s = await requireSession();
  if (s.user.role !== "admin") throw new Error("Forbidden");
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
  params: { filters?: Record<string, string>; sort?: string; dir?: "asc" | "desc"; page?: number; pageSize?: number; filter?: Record<string, string> },
): Promise<ActionResult<{ rows: RecordData[]; total: number }>> {
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
      lang: s.lang,
    });
    return { ok: true, data: { rows: r.rows, total: r.total } };
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

// ---------------------------------------------------------------------------
// Uživatelé (jen správce tenanta)
// ---------------------------------------------------------------------------

export interface UserInput {
  id: string | null;
  name: string;
  email: string;
  admin: boolean;
  active: boolean;
  lang: string;
  roleIds: string[];
  password?: string;
}

export async function saveUserAction(input: UserInput): Promise<ActionResult> {
  const s = await requireAdmin();
  const t = await getT(s.lang, s.ctx.tenantId);
  const errors: Record<string, string> = {};
  const email = input.email.trim().toLowerCase();
  if (!input.name.trim()) errors.name = t("@SYS:Required");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = t("@SYS:InvalidEmail");
  if ((!input.id || input.password) && (input.password ?? "").length < 10) errors.password = t("@SYS:PasswordTooShort");
  const other = await prisma.sysUser.findUnique({ where: { email } });
  if (other && other.id !== input.id) errors.email = t("@SYS:EmailTaken");
  if (Object.keys(errors).length) return { ok: false, message: t("@SYS:FixErrors"), errors };

  // role jen z tohoto tenanta
  const roles = input.roleIds.length
    ? await inTenant(s.ctx, (sess) => sess.find("sys.role", {}, 500))
    : [];
  const roleIds = input.roleIds.filter((id) => roles.some((r) => r.id === id));

  const data = {
    name: input.name.trim(),
    email,
    role: input.admin ? "admin" : "user",
    active: input.active,
    lang: input.lang === "en" ? "en" : "cs",
    roleIds,
    ...(input.password ? { passwordHash: await bcrypt.hash(input.password, 12) } : {}),
  };
  if (input.id) {
    const existing = await prisma.sysUser.findFirst({ where: { id: input.id, tenantId: s.ctx.tenantId } });
    if (!existing) return { ok: false, message: t("@SYS:NotFound") };
    // nesmí zmizet poslední aktivní správce
    if (existing.role === "admin" && (!input.admin || !input.active)) {
      const admins = await prisma.sysUser.count({ where: { tenantId: s.ctx.tenantId, role: "admin", active: true } });
      if (admins <= 1) return { ok: false, message: t("@SYS:LastAdmin") };
    }
    await prisma.sysUser.update({ where: { id: input.id }, data });
    // změna hesla nebo deaktivace odhlásí ostatní relace uživatele
    if (input.password || !input.active) await prisma.sysSession.deleteMany({ where: { userId: input.id } });
  } else {
    await prisma.sysUser.create({ data: { ...data, tenantId: s.ctx.tenantId, passwordHash: data.passwordHash! } });
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
