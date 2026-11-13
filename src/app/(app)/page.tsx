import { HomeTiles } from "@/components/home-tiles";
import { requireSession } from "@/server/auth";
import { getT } from "@/server/i18n";
import { menuIndex, visibleModules } from "@/server/menu";

export default async function Home() {
  const s = await requireSession();
  const t = await getT(s.lang, s.ctx.tenantId);
  const modules = visibleModules(s)
    .sort((a, b) => (a.id === "sys" ? 1 : b.id === "sys" ? -1 : 0))
    .map((m) => ({ id: m.id, label: t(m.label), description: t(m.description), icon: m.icon }));
  return (
    <HomeTiles
      title={t("@SYS:Modules")}
      modules={modules}
      menu={menuIndex(s, t)}
      labels={{ search: t("@SYS:MenuSearch"), noResults: t("@SYS:MenuNoResults"), results: t("@SYS:MenuResults") }}
    />
  );
}
