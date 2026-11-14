import { HelpIndex } from "@/components/help-view";
import { registry } from "@/registry";
import { requireSession } from "@/server/auth";
import { helpTopics } from "@/server/help";
import { getT } from "@/server/i18n";

export const metadata = { title: "Nápověda" };

/** Nápověda: návody k agendám zapnutých modulů, po modulech. */
export default async function HelpPage() {
  const s = await requireSession();
  const t = await getT(s.lang, s.ctx.tenantId);
  const topics = helpTopics().filter((x) => !x.module || x.module === "general" || s.ctx.modules.has(x.module));
  const byModule = new Map<string, typeof topics>();
  for (const x of topics) byModule.set(x.module || "general", [...(byModule.get(x.module || "general") ?? []), x]);
  const label = (m: string) => (m === "general" ? t("@SYS:HelpGeneral") : t(registry.modules.get(m)?.label ?? m));
  const groups = [...byModule].map(([m, items]) => ({ label: label(m), items: items.map((i) => ({ id: i.id, title: i.title, summary: i.summary, module: m })) }));
  return <HelpIndex crumbs={[{ label: t("@SYS:Help") }]} groups={groups} labels={{ search: t("@SYS:HelpSearch"), intro: t("@SYS:HelpIntro"), none: t("@SYS:HelpNone") }} />;
}
