import { notFound } from "next/navigation";
import { ModuleWorkspace, type WorkspaceColumn } from "@/components/module-workspace";
import { registry } from "@/registry";
import { requireSession } from "@/server/auth";
import { getT } from "@/server/i18n";
import { moduleMenu, visibleModules, type MenuKind } from "@/server/menu";

const COLUMNS: [MenuKind, string][] = [
  ["forms", "@SYS:Forms"],
  ["functions", "@SYS:Functions"],
  ["reports", "@SYS:Reports"],
  ["setup", "@SYS:Settings"],
];

export default async function ModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  const s = await requireSession();
  const mod = registry.modules.get(module);
  if (!mod || !visibleModules(s).includes(mod)) notFound();
  const t = await getT(s.lang, s.ctx.tenantId);

  const entries = moduleMenu(s, t, mod);
  // sloupce: Formuláře, Funkce, Reporty, Nastavení — prázdné se nezobrazí
  const columns: WorkspaceColumn[] = COLUMNS.map(([kind, label]) => ({
    title: t(label),
    sections: mod.menu
      .map((g, i) => ({ id: String(i), title: t(g.label), items: entries.filter((e) => e.sectionIndex === i && e.kind === kind).map((e) => ({ label: e.label, href: e.href })) }))
      .filter((x) => x.items.length),
  })).filter((c) => c.sections.length);

  return (
    <ModuleWorkspace
      crumbs={[{ label: t("@SYS:Modules"), href: "/" }, { label: t(mod.label) }]}
      columns={columns}
      labels={{ expandAll: t("@SYS:ExpandAll"), collapseAll: t("@SYS:CollapseAll") }}
    />
  );
}
