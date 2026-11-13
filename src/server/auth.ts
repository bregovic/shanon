import "server-only";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { DEFAULT_LANG, type Lang } from "@/core/labels";
import { dependencyClosure } from "@/core/module";
import { ADMIN, mergePerms, type Perms } from "@/core/security";
import { registry } from "@/registry";
import type { Ctx } from "./data";
import { prisma, withTenant } from "./db";

const COOKIE = "shanon_session";
const TTL_DAYS = 14;
// skutečný hash, aby porovnání u neexistujícího účtu trvalo stejně dlouho
const DUMMY_HASH = bcrypt.hashSync("dummy-password", 12);
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

// jednoduchá brzda proti hádání hesel (na instanci); trvalejší řešení: tabulka pokusů
const attempts = new Map<string, { n: number; until: number }>();

export async function login(email: string, password: string): Promise<boolean> {
  const key = email.toLowerCase();
  const a = attempts.get(key);
  if (a && a.n >= 5 && a.until > Date.now()) return false;

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
  await prisma.sysSession.create({ data: { id: hash(token), userId: user.id, expiresAt } });
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

  // moduly: zapnuté + jejich závislosti, jen ty, které v kódu existují
  const modules = new Set(
    [...dependencyClosure(registry, ["sys", ...tenant.modules.map((m) => m.moduleId)])].filter((m) => registry.modules.has(m)),
  );
  const extensions = new Set(
    tenant.extensions
      .map((e) => e.extensionId)
      .filter((id) => {
        const x = registry.extensions.get(id);
        return x && (x.visibility === "public" || x.owner === tenant.id) && x.dependsOn.every((d) => modules.has(d));
      }),
  );

  // firmy: superuživatel všechny, ostatní jen přiřazené
  const superUser = user.role === "admin";
  const assigned = new Map(user.companies.filter((a) => a.tenantId === tenant.id).map((a) => [a.companyId, a]));
  const allCompanies = await withTenant(tenant.id, (tx) =>
    tx.sysCompany.findMany({ where: { tenantId: tenant.id }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  );
  const companies = superUser ? allCompanies : allCompanies.filter((c) => assigned.has(c.id));
  const companyId = companies.find((c) => c.id === session.companyId)?.id ?? companies[0]?.id ?? null;

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
        await withTenant(tenant.id, (tx) =>
          tx.glDimension.findMany({ where: { tenantId: tenant.id, active: true }, select: { position: true, name: true }, orderBy: { position: "asc" } }),
        )
      ).map((d) => ({ slot: d.position, name: d.name }))
    : [];

  return {
    ctx: { tenantId: tenant.id, userId: user.id, companyId, role: user.role, perms, modules, extensions, lang: (user.lang as Lang) ?? DEFAULT_LANG, dims, userName: user.name },
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
