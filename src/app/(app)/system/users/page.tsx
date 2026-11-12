import { notFound } from "next/navigation";
import { UsersView } from "@/components/users-view";
import { requireSession } from "@/server/auth";
import { inTenant } from "@/server/data";
import { prisma } from "@/server/db";
import { getT } from "@/server/i18n";

export const metadata = { title: "Uživatelé" };

export default async function UsersPage() {
  const s = await requireSession();
  if (s.user.role !== "admin") notFound();
  const t = await getT(s.lang, s.ctx.tenantId);
  const [users, roles] = await Promise.all([
    prisma.sysUser.findMany({
      where: { tenantId: s.ctx.tenantId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true, role: true, active: true, lang: true, roleIds: true },
    }),
    inTenant(s.ctx, (sess) => sess.find("sys.role", {}, 500)),
  ]);

  return (
    <UsersView
      crumbs={[{ label: t("@SYS:Module"), href: "/sys" }, { label: t("@SYS:Users") }]}
      users={users}
      roles={roles.map((r) => ({ id: String(r.id), label: `${r.code} · ${r.name}` }))}
      labels={{
        new: t("@SYS:New"),
        edit: t("@SYS:Edit"),
        save: t("@SYS:Save"),
        cancel: t("@SYS:Cancel"),
        close: t("@SYS:Close"),
        name: t("@SYS:Name"),
        email: t("@SYS:Email"),
        admin: t("@SYS:Admin"),
        administrator: t("@SYS:Administrator"),
        active: t("@SYS:Active"),
        lang: t("@SYS:Language"),
        roles: t("@SYS:Roles"),
        password: t("@SYS:ResetPassword"),
        passwordHelp: t("@SYS:PasswordHelp"),
        user: t("@SYS:User"),
      }}
    />
  );
}
