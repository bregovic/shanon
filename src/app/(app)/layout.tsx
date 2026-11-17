import { AppShell } from "@/components/app-shell";
import { registry } from "@/registry";
import { requireSession } from "@/server/auth";
import { getT } from "@/server/i18n";
import { canSeeModule } from "@/core/security";
import { FavoritesProvider } from "@/components/favorites";
import { prisma } from "@/server/db";
import { menuIndex } from "@/server/menu";
import { inTenant } from "@/server/data";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const t = await getT(s.lang, s.ctx.tenantId);
  const modules = [...registry.modules.values()]
    .filter((m) => s.ctx.modules.has(m.id) && canSeeModule(s.ctx.perms, m.id, m.objects.map((o) => o.id)))
    .map((m) => ({ id: m.id, label: t(m.label), icon: m.icon, href: `/${m.id}` }))
    .sort((a, b) => (a.id === "sys" ? 1 : b.id === "sys" ? -1 : a.label.localeCompare(b.label, "cs")));
  const initials = s.user.name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  // logo organizace aktuální firmy (Organizace → Logo) místo loga Shanon; bez loga nebo modulu zůstane Shanon
  const orgLogo =
    s.ctx.companyId && s.ctx.modules.has("org")
      ? await inTenant(s.ctx, async (sess) => ((await sess.sys().api().find("org.entity", {}, { take: 1 }))[0]?.logo as string) ?? null).catch(() => null)
      : null;

  const favorites = await prisma.sysFavorite.findMany({
    where: { userId: s.user.id },
    orderBy: { createdAt: "asc" },
    select: { href: true, label: true, folder: true },
  });

  return (
    <FavoritesProvider
      favorites={favorites}
      labels={{
        add: t("@SYS:AddFavorite"),
        remove: t("@SYS:RemoveFavorite"),
        title: t("@SYS:Favorites"),
        empty: t("@SYS:NoFavorites"),
        manage: t("@SYS:FavoritesManage"),
        name: t("@SYS:Name"),
        folder: t("@SYS:FavoriteFolder"),
        save: t("@SYS:Save"),
        cancel: t("@SYS:Cancel"),
        removeItem: t("@SYS:Delete"),
      }}
    >
    <AppShell
      modules={modules}
      companies={s.companies}
      companyId={s.ctx.companyId}
      logoSrc={orgLogo ? `/api/files/${orgLogo}` : null}
      user={{ name: s.user.name, email: s.user.email, initials, admin: s.superUser }}
      labels={{ home: t("@SYS:Home"), settings: t("@SYS:UserSettings"), signOut: t("@SYS:SignOut"), search: t("@SYS:MenuSearchShort"), noResults: t("@SYS:MenuNoResults"), recent: t("@SYS:Recent"), noRecent: t("@SYS:NoRecent"), help: t("@SYS:Help"), lang: s.lang, notices: { title: t("@SYS:Notices"), empty: t("@SYS:NoticesEmpty"), allRead: t("@SYS:NoticesAllRead"), showRead: t("@SYS:NoticesShowRead") } }}
      menu={menuIndex(s, t)}
    >
      {children}
    </AppShell>
    </FavoritesProvider>
  );
}
