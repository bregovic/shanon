import { notFound } from "next/navigation";
import { ModuleWorkspace, type WorkspaceColumn } from "@/components/module-workspace";
import { registry } from "@/registry";
import { requireSession } from "@/server/auth";
import { getT } from "@/server/i18n";
import { objectHref } from "@/server/ui";

export default async function ModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  const s = await requireSession();
  const mod = registry.modules.get(module);
  if (!mod || !s.ctx.modules.has(module)) notFound();
  const t = await getT(s.lang, s.ctx.tenantId);

  const toSection = (g: (typeof mod.menu)[number], i: number) => ({
    id: `${i}`,
    title: t(g.label),
    items: g.items
      .filter((it) => it.href !== "/system/modules" || s.user.role === "admin")
      .map((it) => {
        const o = it.object ? registry.objects.get(it.object)! : null;
        return { label: t(it.label ?? o!.labelPlural), href: it.href ?? objectHref(o!.id) };
      }),
  });
  const sections = mod.menu.map(toSection);
  const forms = sections.filter((_, i) => mod.menu[i].label !== "@SYS:Setup");
  const setup = sections.filter((_, i) => mod.menu[i].label === "@SYS:Setup");
  const columns: WorkspaceColumn[] = [
    ...(forms.length ? [{ title: t("@SYS:Forms"), sections: forms }] : []),
    ...(setup.length ? [{ title: t("@SYS:Settings"), sections: setup }] : []),
  ];

  return (
    <ModuleWorkspace
      crumbs={[{ label: t("@SYS:Modules"), href: "/" }, { label: t(mod.label) }]}
      columns={columns}
      labels={{ expandAll: t("@SYS:ExpandAll"), collapseAll: t("@SYS:CollapseAll") }}
    />
  );
}
