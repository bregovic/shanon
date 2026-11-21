import { sharedMap } from "./data";
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { DEFAULT_LANG, type Lang } from "@/core/labels";
import { ADMIN, mergePerms, type Perms } from "@/core/security";
import { registry } from "@/registry";
import type { Ctx } from "./data";
import { prisma, withTenant } from "./db";
import { companyModules } from "./modules";

const COOKIE = "shanon_session";
const TTL_DAYS = 14;
// skutečný hash, aby porovnání u neexistujícího účtu trvalo stejně dlouho
const DUMMY_HASH = bcrypt.hashSync("dummy-password", 12);
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

// jednoduchá brzda proti hádání hesel (na instanci); trvalejší řešení: tabulka pokusů
const attempts = new Map<string, { n: number; until: number }>();

/** Zrušit zámek po neúspěšných pokusech (správce nastavil nové heslo / změnil e-mail). */
export function clearLoginLock(email: string) {
  attempts.delete(email.trim().toLowerCase());
}

/** Minut do odemčení účtu po neúspěšných pokusech (0 = nezamčeno) — do žádosti „Nemůžu se přihlásit“. */
export function loginLockMinutes(email: string): number {
  const a = attempts.get(email.trim().toLowerCase());
  return a && a.n >= 5 && a.until > Date.now() ? Math.max(1, Math.ceil((a.until - Date.now()) / 60_000)) : 0;
}

/** `locked` = minut do odemčení po 5 neúspěšných pokusech (heslo se v tu chvíli neověřuje). */
export async function login(email: string, password: string): Promise<boolean | { locked: number }> {
  const key = email.trim().toLowerCase();
  const a = attempts.get(key);
  if (a && a.n >= 5 && a.until > Date.now()) return { locked: Math.max(1, Math.ceil((a.until - Date.now()) / 60_000)) };

  const user = await prisma.sysUser.findUnique({ where: { email: key } });
  // porovnání i pro neexistujícího uživatele, ať odezva neprozradí existenci účtu
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.active || !ok) {
    attempts.set(key, { n: (a?.n ?? 0) + 1, until: Date.now() + 15 * 60_000 });
    return false;
  }
  attempts.delete(key);

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_DAYS * 86_400_000);
  // výchozí firma z Mého nastavení (bez přístupu k ní vybere session první dostupnou)
  await prisma.sysSession.create({ data: { id: hash(token), userId: user.id, expiresAt, companyId: user.defaultCompanyId ?? null } });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return true;
}

export async function logout() {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) await prisma.sysSession.deleteMany({ where: { id: hash(token) } });
  store.delete(COOKIE);
}

export interface AppSession {
  ctx: Ctx;
  lang: Lang;
  user: { id: string; name: string; email: string; role: string };
  tenant: { id: string; name: string };
  companies: { id: string; code: string; name: string }[];
  /** superuživatel tenanta (všechny firmy, moduly, role) */
  superUser: boolean;
  /** firmy, ve kterých smí spravovat uživatele a nastavení */
  adminCompanyIds: string[];
}

/** Smí spravovat uživatele / nastavení aspoň jedné firmy. */
export const isAnyAdmin = (s: AppSession) => s.superUser || s.adminCompanyIds.length > 0;

/** Přihlášený uživatel a jeho kontext; jednou za požadavek. */
export const getSession = cache(async (): Promise<AppSession | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.sysSession.findUnique({
    where: { id: hash(token) },
    include: { user: { include: { companies: true, tenant: { include: { modules: true, extensions: true } } } } },
  });
  if (!session || session.expiresAt < new Date() || !session.user.active) return null;
  const { user } = session;
  const { tenant } = user;

  // firmy: superuživatel všechny, ostatní jen přiřazené
  const superUser = user.role === "admin";
  const assigned = new Map(user.companies.filter((a) => a.tenantId === tenant.id).map((a) => [a.companyId, a]));
  const allCompanies = await withTenant(tenant.id, (tx) =>
    // nosné firmy virtuálních společností nejsou pro práci (jen pro sdílená data)
    tx.sysCompany.findMany({ where: { tenantId: tenant.id, OR: [{ virtual: false }, ...(user.role === "admin" ? [{ dat: true }] : [])] }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  );
  const companies = superUser ? allCompanies : allCompanies.filter((c) => assigned.has(c.id));
  const companyId = companies.find((c) => c.id === session.companyId)?.id ?? companies[0]?.id ?? null;

  // moduly aktuální firmy (agenda firmy) + jejich závislosti
  const modules = await companyModules(tenant.id, companyId, tenant.modules.map((m) => m.moduleId));
  const extensions = new Set(
    tenant.extensions
      .map((e) => e.extensionId)
      .filter((id) => {
        const x = registry.extensions.get(id);
        return x && (x.visibility === "public" || x.owner === tenant.id) && x.dependsOn.every((d) => modules.has(d));
      }),
  );

  // oprávnění platí pro aktuální firmu (role a správce se přiřazují po firmách)
  const here = companyId ? assigned.get(companyId) : undefined;
  let perms: Perms;
  if (superUser) perms = ADMIN;
  else if (here?.admin) perms = { admin: false, companyAdmin: true, levels: {} };
  else {
    const permRows = here?.roleIds.length
      ? await withTenant(tenant.id, (tx) =>
          tx.sysRolePermission.findMany({ where: { tenantId: tenant.id, roleId: { in: here.roleIds } }, select: { target: true, level: true } }),
        )
      : [];
    perms = { admin: false, levels: mergePerms(permRows) };
  }
  /** firmy, kde smí spravovat uživatele (superuživatel všechny) */
  const adminCompanyIds = superUser ? allCompanies.map((c) => c.id) : [...assigned.values()].filter((a) => a.admin).map((a) => a.companyId);

  // finanční dimenze tenanta (popisky polí dim1…dim6)
  const dims = modules.has("gl")
    ? (
        await withTenant(tenant.id, async (tx) =>
          // dimenze firmy (nebo sdílené ve virtuální společnosti); bez firmy žádné
          companyId
            ? tx.glDimension.findMany({
                where: { tenantId: tenant.id, active: true, companyId: (await sharedMap(tx, tenant.id, companyId))["gl.dimension"] ?? companyId },
                select: { position: true, name: true },
                orderBy: { position: "asc" },
              })
            : [],
        )
      ).map((d) => ({ slot: d.position, name: d.name }))
    : [];

  // uživatelé firmy (superuživatelé + přiřazení) — výběr v polích typu uživatel (řešitel úkolu…)
  const users = companyId
    ? await prisma.sysUser.findMany({
        where: { tenantId: tenant.id, active: true, OR: [{ role: "admin" }, { companies: { some: { companyId } } }] },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];

  return {
    ctx: { tenantId: tenant.id, userId: user.id, companyId, role: user.role, perms, modules, extensions, lang: (user.lang as Lang) ?? DEFAULT_LANG, dims, userName: user.name, users },
    lang: (user.lang as Lang) ?? DEFAULT_LANG,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    tenant: { id: tenant.id, name: tenant.name },
    companies,
    superUser,
    adminCompanyIds,
  };
});

export async function requireSession(): Promise<AppSession> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

export async function setCompany(companyId: string) {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return;
  await prisma.sysSession.updateMany({ where: { id: hash(token) }, data: { companyId } });
}
