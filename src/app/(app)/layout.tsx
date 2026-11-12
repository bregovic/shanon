import { AppShell } from "@/components/app-shell";
import { registry } from "@/registry";
import { requireSession } from "@/server/auth";
import { getT } from "@/server/i18n";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const t = await getT(s.lang, s.ctx.tenantId);
  const modules = [...registry.modules.values()]
    .filter((m) => s.ctx.modules.has(m.id))
    .map((m) => ({ id: m.id, label: t(m.label), icon: m.icon, href: `/${m.id}` }))
    .sort((a, b) => (a.id === "sys" ? 1 : b.id === "sys" ? -1 : a.label.localeCompare(b.label, "cs")));
  const initials = s.user.name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <AppShell
      modules={modules}
      companies={s.companies}
      companyId={s.ctx.companyId}
      user={{ name: s.user.name, email: s.user.email, initials, admin: s.user.role === "admin" }}
      labels={{ home: t("@SYS:Home"), settings: t("@SYS:Settings"), signOut: t("@SYS:SignOut") }}
    >
      {children}
    </AppShell>
  );
}
