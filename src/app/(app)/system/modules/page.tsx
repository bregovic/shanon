import { notFound } from "next/navigation";
import { FeatureList, type FeatureRow } from "@/components/feature-list";
import { dependents } from "@/core/module";
import { registry } from "@/registry";
import { requireSession } from "@/server/auth";
import { getT } from "@/server/i18n";

export default async function ModulesPage() {
  const s = await requireSession();
  if (!s.superUser) notFound();
  const t = await getT(s.lang, s.ctx.tenantId);
  const name = (id: string) => t(registry.modules.get(id)!.label);

  const modules: FeatureRow[] = [...registry.modules.values()].map((m) => {
    const enabled = s.ctx.modules.has(m.id);
    const neededBy = dependents(registry, m.id).filter((d) => s.ctx.modules.has(d));
    return {
      kind: "module",
      id: m.id,
      icon: m.icon,
      label: t(m.label),
      description: t(m.description),
      enabled,
      canToggle: !m.core && (!enabled || neededBy.length === 0),
      notes: [
        ...(m.dependsOn.length ? [`${t("@SYS:Requires")}: ${m.dependsOn.map(name).join(", ")}`] : []),
        ...(enabled && neededBy.length ? [`${t("@SYS:RequiredBy")}: ${neededBy.map(name).join(", ")}`] : []),
      ],
    };
  });
  const extensions: FeatureRow[] = [...registry.extensions.values()]
    .filter((x) => x.visibility === "public" || x.owner === s.ctx.tenantId)
    .map((x) => {
      const enabled = s.ctx.extensions.has(x.id);
      return {
        kind: "extension",
        id: x.id,
        icon: "Apps",
        label: t(x.label),
        description: t(x.description),
        enabled,
        canToggle: enabled || x.dependsOn.every((d) => s.ctx.modules.has(d)),
        notes: [`${t("@SYS:Requires")}: ${x.dependsOn.map(name).join(", ")}`],
      };
    });

  return (
    <FeatureList
      crumbs={[{ label: t("@SYS:Module"), href: "/sys" }, { label: t("@SYS:Modules") }]}
      sections={[
        { title: t("@SYS:Modules"), rows: modules },
        { title: t("@SYS:Extensions"), rows: extensions },
      ]}
      labels={{ enable: t("@SYS:Enable"), disable: t("@SYS:Disable"), enabled: t("@SYS:Enabled") }}
    />
  );
}
