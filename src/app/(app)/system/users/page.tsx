import { notFound } from "next/navigation";
import { UsersView } from "@/components/users-view";
import { isAnyAdmin, requireSession } from "@/server/auth";
import { inTenant } from "@/server/data";
import { prisma } from "@/server/db";
import { getT } from "@/server/i18n";

export const metadata = { title: "Uživatelé" };

export default async function UsersPage() {
  const s = await requireSession();
  if (!isAnyAdmin(s)) notFound();
  const t = await getT(s.lang, s.ctx.tenantId);
  const scope = new Set(s.adminCompanyIds);
  const [all, roles, companies] = await Promise.all([
    prisma.sysUser.findMany({
      where: { tenantId: s.ctx.tenantId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true, role: true, active: true, lang: true, companies: true },
    }),
    inTenant(s.ctx, (sess) => sess.sys().find("sys.role", {}, 1000)),
    inTenant(s.ctx, (sess) => sess.sys().find("sys.company", {}, 1000)),
  ]);
  // správce firmy vidí jen uživatele svých firem (a ne superuživatele)
  const users = s.superUser ? all : all.filter((u) => u.role !== "admin" && u.companies.some((a) => scope.has(a.companyId)));
  const companyCode = new Map(companies.map((c) => [String(c.id), String(c.code)]));

  return (
    <UsersView
      crumbs={[{ label: t("@SYS:Module"), href: "/sys" }, { label: t("@SYS:Users") }]}
      canSuper={s.superUser}
      users={users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        superUser: u.role === "admin",
        active: u.active,
        lang: u.lang,
        companies: u.companies.map((a) => ({ companyId: a.companyId, admin: a.admin, roleIds: a.roleIds })),
        companyCodes: u.companies.map((a) => `${companyCode.get(a.companyId) ?? "?"}${a.admin ? " ★" : ""}`).join(", "),
      }))}
      companies={companies.filter((c) => scope.has(String(c.id))).map((c) => ({ id: String(c.id), label: `${c.code} · ${c.name}` }))}
      roles={roles.map((r) => ({ id: String(r.id), label: `${r.code} · ${r.name}` }))}
      labels={{
        new: t("@SYS:New"),
        save: t("@SYS:Save"),
        cancel: t("@SYS:Cancel"),
        close: t("@SYS:Close"),
        name: t("@SYS:Name"),
        email: t("@SYS:Email"),
        superUser: t("@SYS:SuperUser"),
        active: t("@SYS:Active"),
        lang: t("@SYS:Language"),
        roles: t("@SYS:Roles"),
        companies: t("@SYS:Companies"),
        userCompanies: t("@SYS:UserCompanies"),
        access: t("@SYS:CompanyAccess"),
        companyAdmin: t("@SYS:CompanyAdmin"),
        password: t("@SYS:ResetPassword"),
        passwordHelp: t("@SYS:PasswordHelp"),
        user: t("@SYS:User"),
        general: t("@SYS:General"),
      }}
    />
  );
}
