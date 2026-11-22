import { redirect } from "next/navigation";
import { HomeTiles } from "@/components/home-tiles";
import { requireSession } from "@/server/auth";
import { getT } from "@/server/i18n";
import { menuIndex, visibleModules } from "@/server/menu";
import { myTasks } from "@/server/work-items";

export default async function Home() {
  const s = await requireSession();
  // role s vlastní úvodní stránkou (Pokladník → pokladna, Pracovník → nahrání dokladů)
  if (s.homeHref) redirect(s.homeHref);
  const t = await getT(s.lang, s.ctx.tenantId);
  const modules = visibleModules(s)
    .sort((a, b) => (a.id === "sys" ? 1 : b.id === "sys" ? -1 : 0))
    .map((m) => ({ id: m.id, label: t(m.label), description: t(m.description), icon: m.icon }));
  const tasks = await myTasks(s.ctx, t).catch(() => null);
  return (
    <HomeTiles
      tasks={tasks}
      taskLabels={{
        title: t("@WF:Overview"), empty: t("@WF:OverviewEmpty"), unassigned: t("@WF:OverviewUnassigned"), all: t("@WF:OverviewAll"), overdue: t("@WF:OverviewOverdue"),
        approve: t("@WF:Approve"), reject: t("@WF:Reject"), done: t("@WF:Done"), open: t("@WF:OverviewOpen"), today: t("@WF:OverviewToday"),
        daysAgo: t("@WF:OverviewDaysAgo"), due: t("@WF:OverviewDue"), overdueCount: t("@WF:OverviewOverdueCount"),
      }}
      title={t("@SYS:Modules")}
      modules={modules}
      menu={menuIndex(s, t)}
      labels={{ search: t("@SYS:MenuSearch"), noResults: t("@SYS:MenuNoResults"), results: t("@SYS:MenuResults") }}
    />
  );
}
