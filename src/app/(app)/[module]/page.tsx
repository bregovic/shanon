import { notFound } from "next/navigation";
import { ModuleWorkspace, type WorkspaceColumn } from "@/components/module-workspace";
import { registry } from "@/registry";
import { isAnyAdmin, requireSession } from "@/server/auth";
import { getT } from "@/server/i18n";
import { objectHref } from "@/server/ui";
import { can, canSeeModule } from "@/core/security";

export default async function ModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  const s = await requireSession();
  const mod = registry.modules.get(module);
  if (!mod || !s.ctx.modules.has(module) || !canSeeModule(s.ctx.perms, mod.id, mod.objects.map((o) => o.id))) notFound();
  const t = await getT(s.lang, s.ctx.tenantId);

  const toSection = (g: (typeof mod.menu)[number], i: number) => ({
    id: `${i}`,
    title: t(g.label),
    items: g.items
      // stránky správy jen pro správce, objekty jen s právem číst
      .filter((it) =>
        it.href
          ? !it.href.startsWith("/system/") || (it.href === "/system/modules" ? s.superUser : isAnyAdmin(s))
          : can(s.ctx.perms, it.object!, "read"),
      )
      .map((it) => {
        const o = it.object ? registry.objects.get(it.object)! : null;
        return { label: t(it.label ?? o!.labelPlural), href: it.href ?? objectHref(o!.id) };
      }),
  });
  const sections = mod.menu.map(toSection);
  const isSetup = (i: number) => mod.menu[i].label === "@SYS:Setup" || mod.menu[i].label === "@SYS:Security";
  const forms = sections.filter((x, i) => !isSetup(i) && x.items.length);
  const setup = sections.filter((x, i) => isSetup(i) && x.items.length);
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
