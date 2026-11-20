/**
 * Aplikace Portál — přihlášení zaměstnanců a dodavatelů (bez uživatelského účtu Shanonu).
 *
 * - Zaměstnanec: osobní číslo + heslo (`sys_portal_account`, bcrypt), 5 chybných pokusů = zámek 15 min.
 *   Heslo si nastaví z pozvánky (odkaz 7 dní).
 * - Dodavatel: e-mail z Kontaktů portálu (`int.portalContact`) → odkaz do e-mailu (20 min, pozvánka 7 dní),
 *   odkaz přihlásí. Neznámý e-mail nedostane nic a stránka odpoví stejně (nejde zjišťovat adresy).
 * - Firmy přihlášeného se odvozují vždy znovu z karet: platná karta zaměstnance s přístupem / zapnutý kontakt
 *   + aktivní portál firmy se zapnutým přístupem pro daný druh (`int.portal.appEmployees` / `appVendors`).
 * Relace v cookie `shanon_portal` (v DB jen SHA-256), 30 dní. Tokeny v DB jen jako SHA-256.
 */
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import type { PrismaClient } from "@/generated/prisma/client";
import { isEmail } from "@/core/edt";
import { UserError } from "@/core/module";
import { prisma, withTenant, type Tx } from "./db";
import { companyModules } from "./modules";
import { getT } from "./i18n";
import { portalInviteMail, portalLinkMail } from "./mail-templates";
import { envUrls, sendSystemMail } from "./system-mail";

export type PortalKind = "employee" | "vendor";
export const PORTAL_COOKIE = "shanon_portal";
const SESSION_DAYS = 30;
const LINK_MIN = 20;
const INVITE_DAYS = 7;
const MAX_FAILS = 5;
const LOCK_MIN = 15;
export const PORTAL_MIN_PASSWORD = 8;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const normLogin = (kind: PortalKind, login: string) => (kind === "vendor" ? login.trim().toLowerCase() : login.trim().toUpperCase());

export interface PortalCompany {
  companyId: string;
  companyName: string;
  portalId: string;
  /** karta zaměstnance / kontakt dodavatele v této firmě */
  refId: string;
  name: string;
  email: string | null;
}

export interface PortalIdentity {
  accountId: string;
  tenantId: string;
  tenantCode: string;
  kind: PortalKind;
  login: string;
  name: string;
  companies: PortalCompany[];
  prefs: { companyId?: string; agenda?: string };
}

type Rows = { findMany(a: unknown): Promise<Record<string, unknown>[]> };
const rows = (tx: Tx, model: "hrEmployee" | "intPortalContact" | "intPortal") => (tx as unknown as Record<string, Rows>)[model];

/** Tenant podle kódu z adresy /p/<kód>. */
export async function portalTenant(code: string, client: PrismaClient = prisma) {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/i.test(code)) return null;
  const t = await client.sysTenant.findUnique({ where: { code: code.toLowerCase() }, include: { modules: true } });
  if (!t || !t.modules.some((m) => m.moduleId === "int")) return null;
  return t;
}

/**
 * Firmy, kam smí přihlášený (podle karet a nastavení portálů). Jen čtení identity — zápisy dokladů jdou
 * přes datovou službu (src/server/portal-app.ts).
 */
export async function identityCompanies(tenantId: string, kind: PortalKind, login: string, client: PrismaClient = prisma): Promise<PortalCompany[]> {
  const tenant = await client.sysTenant.findUnique({ where: { id: tenantId }, include: { modules: true } });
  if (!tenant) return [];
  const today = new Date(new Date().toISOString().slice(0, 10));
  const found = await withTenant(
    tenantId,
    async (tx) => {
      if (kind === "employee" && !tenant.modules.some((m) => m.moduleId === "hr")) return [];
      const cards =
        kind === "employee"
          ? await rows(tx, "hrEmployee").findMany({
              where: { tenantId, personalNum: login, active: true, portalAccess: true, AND: [{ OR: [{ validFrom: null }, { validFrom: { lte: today } }] }, { OR: [{ validTo: null }, { validTo: { gte: today } }] }] },
            })
          : await rows(tx, "intPortalContact").findMany({ where: { tenantId, email: { equals: login, mode: "insensitive" }, active: true } });
      if (!cards.length) return [];
      const companyIds = [...new Set(cards.map((c) => String(c.companyId)))];
      const portals = await rows(tx, "intPortal").findMany({
        where: { tenantId, companyId: { in: companyIds }, active: true, ...(kind === "employee" ? { appEmployees: true } : { appVendors: true }) },
        orderBy: { createdAt: "asc" },
      });
      const companies = await tx.sysCompany.findMany({ where: { tenantId, id: { in: companyIds } }, select: { id: true, name: true } });
      return cards.flatMap((c) => {
        const p = portals.find((x) => x.companyId === c.companyId);
        const co = companies.find((x) => x.id === c.companyId);
        if (!p || !co) return [];
        return [{ companyId: co.id, companyName: co.name, portalId: String(p.id), refId: String(c.id), name: String((kind === "employee" ? c.name : c.name || c.email) ?? ""), email: (c.email as string) ?? null }];
      });
    },
    client,
  );
  // Integrace (a u zaměstnanců Zaměstnanci) musí být v agendě firmy
  const out: PortalCompany[] = [];
  for (const c of found) {
    const mods = await companyModules(tenantId, c.companyId, tenant.modules.map((m) => m.moduleId), client);
    if (mods.has("int") && (kind === "vendor" || mods.has("hr"))) out.push(c);
  }
  return out.sort((a, b) => a.companyName.localeCompare(b.companyName, "cs"));
}

async function account(tenantId: string, kind: PortalKind, login: string, client: PrismaClient) {
  const l = normLogin(kind, login);
  return client.sysPortalAccount.upsert({ where: { tenantId_kind_login: { tenantId, kind, login: l } }, create: { tenantId, kind, login: l }, update: {} });
}

async function startSession(accountId: string, client: PrismaClient) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await client.sysPortalSession.create({ data: { id: sha(token), accountId, expiresAt } });
  await client.sysPortalAccount.update({ where: { id: accountId }, data: { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null } });
  (await cookies()).set(PORTAL_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt });
}

// brzda proti zahlcení (na instanci): žádosti o odkaz / pokusy o přihlášení z adresy za hodinu
const hits = new Map<string, number[]>();
function tooMany(key: string, max: number) {
  const now = Date.now();
  const h = (hits.get(key) ?? []).filter((x) => x > now - 3_600_000);
  h.push(now);
  hits.set(key, h);
  return h.length > max;
}

/** Zaměstnanec: osobní číslo + heslo. Chyba = jedna obecná hláška (nic neprozradí). */
export async function employeeLogin(tenantCode: string, personalNum: string, password: string, ip: string, client: PrismaClient = prisma): Promise<void> {
  const tenant = await portalTenant(tenantCode, client);
  if (!tenant) throw new UserError("@INT:AppLoginFailed");
  if (tooMany(`emp:${tenant.id}:${ip}`, 30)) throw new UserError("@INT:AppTooMany");
  const login = normLogin("employee", personalNum);
  const acc = await client.sysPortalAccount.findUnique({ where: { tenantId_kind_login: { tenantId: tenant.id, kind: "employee", login } } });
  if (!acc || !acc.passwordHash) throw new UserError("@INT:AppLoginFailed");
  if (acc.lockedUntil && acc.lockedUntil > new Date()) throw new UserError("@INT:AppLocked", { minutes: String(Math.ceil((acc.lockedUntil.getTime() - Date.now()) / 60_000)) });
  if (!(await bcrypt.compare(password, acc.passwordHash))) {
    const fails = acc.failedLogins + 1;
    await client.sysPortalAccount.update({ where: { id: acc.id }, data: { failedLogins: fails, lockedUntil: fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MIN * 60_000) : null } });
    throw new UserError(fails >= MAX_FAILS ? "@INT:AppLocked" : "@INT:AppLoginFailed", { minutes: String(LOCK_MIN) });
  }
  if (!(await identityCompanies(tenant.id, "employee", login, client)).length) throw new UserError("@INT:AppNoAccess");
  await startSession(acc.id, client);
}

/**
 * Dodavatel: poslat přihlašovací odkaz — jen e-mailu z Kontaktů portálu. Neznámý e-mail: nic, bez chyby.
 * Vrací false jen při neplatném zápisu adresy.
 */
export async function requestVendorLink(tenantCode: string, email: string, ip: string, client: PrismaClient = prisma): Promise<boolean> {
  const e = email.trim().toLowerCase();
  if (!isEmail(e)) return false;
  const tenant = await portalTenant(tenantCode, client);
  if (!tenant || tooMany(`ip:${ip}`, 20) || tooMany(`mail:${tenant.id}:${e}`, 5)) return true;
  const companies = await identityCompanies(tenant.id, "vendor", e, client);
  if (!companies.length) return true;
  await sendLink(tenant.id, tenant.code, "vendor", e, companies, "login", client);
  return true;
}

/** Odkaz do e-mailu: přihlášení dodavatele / pozvánka (dodavatel: přihlásí; zaměstnanec: nastavení hesla). */
async function sendLink(tenantId: string, tenantCode: string, kind: PortalKind, login: string, companies: PortalCompany[], purpose: "login" | "invite", client: PrismaClient, inviter?: string) {
  const acc = await account(tenantId, kind, login, client);
  const token = randomBytes(32).toString("base64url");
  const minutes = purpose === "invite" ? INVITE_DAYS * 24 * 60 : LINK_MIN;
  await client.sysPortalAccount.update({
    where: { id: acc.id },
    data: { tokenHash: sha(token), tokenExpires: new Date(Date.now() + minutes * 60_000), ...(purpose === "invite" ? { invitedAt: new Date() } : {}) },
  });
  const base = `${envUrls().self}/p/${tenantCode}`;
  const link = kind === "employee" ? `${base}/heslo?t=${token}` : `${base}/vstup?t=${token}`;
  const t = await getT("cs", tenantId);
  const to = kind === "vendor" ? login : companies.find((c) => c.email)?.email;
  if (!to) throw new UserError("@HR:InviteNoEmail", { num: login });
  const mail =
    purpose === "login"
      ? portalLinkMail(t, { link, minutes: LINK_MIN, companies: companies.map((c) => c.companyName) })
      : portalInviteMail(t, { kind, name: companies[0]?.name ?? "", login, link, days: INVITE_DAYS, companies: companies.map((c) => c.companyName), inviter: inviter ?? "", appUrl: base });
  try {
    await sendSystemMail({ to, ...mail });
  } catch (err) {
    console.error("systémová pošta portálu", err);
    throw new UserError("@SYS:MailFailed", { error: String((err as Error).message ?? err).slice(0, 200) });
  }
}

/** Pozvánka do Portálu (akce na kartě zaměstnance / kontaktu). Bez přístupu ani do jedné firmy = chyba. */
export async function sendPortalInvite(tenantId: string, kind: PortalKind, login: string, inviter: string, client: PrismaClient = prisma): Promise<string> {
  const tenant = await client.sysTenant.findUniqueOrThrow({ where: { id: tenantId } });
  const l = normLogin(kind, login);
  const companies = await identityCompanies(tenantId, kind, l, client);
  if (!companies.length) throw new UserError(kind === "employee" ? "@HR:InviteNoAccess" : "@INT:NoAppPortal", { num: l });
  await sendLink(tenantId, tenant.code, kind, l, companies, "invite", client, inviter);
  return kind === "vendor" ? l : (companies.find((c) => c.email)?.email ?? "");
}

async function accountByToken(token: string, client: PrismaClient) {
  if (!token || token.length < 20) return null;
  const acc = await client.sysPortalAccount.findFirst({ where: { tokenHash: sha(token) } });
  if (!acc || !acc.tokenExpires || acc.tokenExpires < new Date()) return null;
  return acc;
}

/** Odkaz z e-mailu dodavatele: přihlásí (jednorázově). */
export async function consumeVendorLink(tenantCode: string, token: string, client: PrismaClient = prisma): Promise<boolean> {
  const tenant = await portalTenant(tenantCode, client);
  const acc = await accountByToken(token, client);
  if (!tenant || !acc || acc.tenantId !== tenant.id || acc.kind !== "vendor") return false;
  await client.sysPortalAccount.update({ where: { id: acc.id }, data: { tokenHash: null, tokenExpires: null } });
  if (!(await identityCompanies(tenant.id, "vendor", acc.login, client)).length) return false;
  await startSession(acc.id, client);
  return true;
}

/** Platný odkaz na nastavení hesla zaměstnance → osobní číslo (pro formulář), jinak null. */
export async function employeeByToken(tenantCode: string, token: string, client: PrismaClient = prisma): Promise<string | null> {
  const tenant = await portalTenant(tenantCode, client);
  const acc = await accountByToken(token, client);
  return tenant && acc && acc.tenantId === tenant.id && acc.kind === "employee" ? acc.login : null;
}

/** Nastavit heslo z pozvánky a rovnou přihlásit. */
export async function setEmployeePassword(tenantCode: string, token: string, password: string, client: PrismaClient = prisma): Promise<void> {
  const tenant = await portalTenant(tenantCode, client);
  const acc = await accountByToken(token, client);
  if (!tenant || !acc || acc.tenantId !== tenant.id || acc.kind !== "employee") throw new UserError("@SYS:LinkInvalid");
  if (password.length < PORTAL_MIN_PASSWORD) throw new UserError("@INT:AppPasswordShort", { min: String(PORTAL_MIN_PASSWORD) });
  await client.$transaction([
    client.sysPortalAccount.update({ where: { id: acc.id }, data: { passwordHash: await bcrypt.hash(password, 12), tokenHash: null, tokenExpires: null, failedLogins: 0, lockedUntil: null } }),
    client.sysPortalSession.deleteMany({ where: { accountId: acc.id } }),
  ]);
  if (!(await identityCompanies(tenant.id, "employee", acc.login, client)).length) throw new UserError("@INT:AppNoAccess");
  await startSession(acc.id, client);
}

/** Přihlášený z cookie (relace platí, tenant sedí, má aspoň jednu firmu), jinak null. */
export async function portalIdentity(tenantCode: string, client: PrismaClient = prisma): Promise<PortalIdentity | null> {
  const token = (await cookies()).get(PORTAL_COOKIE)?.value;
  if (!token) return null;
  const s = await client.sysPortalSession.findUnique({ where: { id: sha(token) }, include: { account: true } });
  if (!s || s.expiresAt < new Date()) return null;
  const tenant = await portalTenant(tenantCode, client);
  if (!tenant || tenant.id !== s.account.tenantId) return null;
  const kind = s.account.kind as PortalKind;
  const companies = await identityCompanies(tenant.id, kind, s.account.login, client);
  if (!companies.length) return null;
  return {
    accountId: s.account.id,
    tenantId: tenant.id,
    tenantCode: tenant.code,
    kind,
    login: s.account.login,
    name: companies[0].name || s.account.login,
    companies,
    prefs: (s.account.prefs ?? {}) as PortalIdentity["prefs"],
  };
}

export async function portalLogout(client: PrismaClient = prisma) {
  const store = await cookies();
  const token = store.get(PORTAL_COOKIE)?.value;
  if (token) await client.sysPortalSession.deleteMany({ where: { id: sha(token) } });
  store.delete(PORTAL_COOKIE);
}

/** Zapamatovat poslední firmu a agendu (nabídnou se při dalším otevření). */
export async function savePortalPrefs(accountId: string, prefs: PortalIdentity["prefs"], client: PrismaClient = prisma) {
  await client.sysPortalAccount.update({ where: { id: accountId }, data: { prefs: { companyId: prefs.companyId ?? null, agenda: prefs.agenda ?? null } } });
}
