import Link from "next/link";
import { registry } from "@/registry";
import { requireSession } from "@/server/auth";
import { getT } from "@/server/i18n";
import { objectHref } from "@/server/ui";
import { logoutAction, switchCompanyAction } from "../actions";
import { NavLink } from "@/components/nav-link";
import { AutoSubmitSelect } from "@/components/auto-submit-select";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const t = await getT(s.lang, s.ctx.tenantId);

  const groups = [...registry.modules.values()]
    .filter((m) => s.ctx.modules.has(m.id))
    .flatMap((m) =>
      m.menu.map((g) => ({
        key: `${m.id}:${g.label}`,
        title: g.label === "@SYS:Setup" ? `${t(g.label)} · ${t(m.label)}` : t(g.label),
        setup: g.label === "@SYS:Setup",
        items: g.items
          .filter((i) => i.href !== "/system/modules" || s.user.role === "admin")
          .map((i) => {
            const o = i.object ? registry.objects.get(i.object)! : null;
            return { href: i.href ?? objectHref(o!.id), label: t(i.label ?? o!.labelPlural) };
          }),
      })),
    );
  // pracovní skupiny nahoře, nastavení dole
  const ordered = [...groups.filter((g) => !g.setup), ...groups.filter((g) => g.setup)];

  const menu = (
    <>
      {ordered.map((g) => (
        <div key={g.key}>
          <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{g.title}</div>
          {g.items.map((i) => (
            <NavLink key={i.href} href={i.href}>
              {i.label}
            </NavLink>
          ))}
        </div>
      ))}
    </>
  );

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <details className="group border-b border-line bg-surface md:hidden">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-xs font-bold text-accent-fg">S</div>
          <span className="font-semibold">Shanon</span>
          <span className="ml-auto text-sm text-muted">☰</span>
        </summary>
        <nav className="space-y-5 px-3 pb-4">{menu}</nav>
        <form action={logoutAction} className="border-t border-line px-5 py-3">
          <button className="text-sm text-muted">{t("@SYS:SignOut")}</button>
        </form>
      </details>
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <Link href="/" className="flex items-center gap-2 px-5 py-4">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-xs font-bold text-accent-fg">S</div>
          <span className="font-semibold">Shanon</span>
          <span className="ml-auto truncate text-xs text-muted">{s.tenant.name}</span>
        </Link>
        {s.companies.length > 0 && (
          <form action={switchCompanyAction} className="px-4 pb-3">
            <AutoSubmitSelect
              name="companyId"
              defaultValue={s.ctx.companyId ?? ""}
              options={s.companies.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))}
            />
          </form>
        )}
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-6">{menu}</nav>
        <div className="flex items-center gap-2 border-t border-line px-4 py-3 text-sm">
          <div className="grid h-7 w-7 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
            {s.user.name.slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{s.user.name}</div>
            <div className="truncate text-xs text-muted">{s.user.email}</div>
          </div>
          <form action={logoutAction}>
            <button className="text-xs text-muted hover:text-fg">{t("@SYS:SignOut")}</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
