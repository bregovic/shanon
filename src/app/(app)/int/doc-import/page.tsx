import { notFound } from "next/navigation";
import { DocImportView } from "@/components/doc-import-view";
import { can } from "@/core/security";
import { DocTarget } from "@/modules/int";
import { requireSession } from "@/server/auth";
import { getT } from "@/server/i18n";
import { objectHref } from "@/server/ui";

export const metadata = { title: "Načíst doklady" };

/** Integrace → Načíst doklady (i z Dodavatelů / Odběratelů s předvoleným cílem). */
export default async function DocImportPage({ searchParams }: { searchParams: Promise<{ target?: string }> }) {
  const s = await requireSession();
  if (!s.ctx.modules.has("int") || !s.ctx.companyId || !can(s.ctx.perms, "int.document", "write")) notFound();
  const t = await getT(s.lang, s.ctx.tenantId);
  const { target } = await searchParams;
  const mods = s.ctx.modules;
  const targets = DocTarget.values
    .filter((v) => v.value === "auto" || mods.has(v.value.startsWith("ap") ? "ap" : "ar"))
    .map((v) => ({ value: v.value, label: t(v.label) }));
  const k = (x: string) => t(`@INT:${x}`);
  const statuses = ["new", "processing", "attention", "ready", "listed", "error", "rejected"];
  return (
    <DocImportView
      crumbs={[{ label: k("Module"), href: "/int" }, { label: k("DocImport") }]}
      targets={targets}
      initialTarget={target && targets.some((x) => x.value === target) ? target : "auto"}
      listHref={objectHref("int.document")}
      docHref={objectHref("int.document", "__ID__")}
      statusLabels={Object.fromEntries(statuses.map((v) => [v, k(`Doc${v[0].toUpperCase()}${v.slice(1)}`)]))}
      labels={{
        intro: k("DocImportIntro"),
        files: k("DocImportFiles"),
        drop: k("DocImportDrop"),
        extract: k("DocImportExtract"),
        start: k("DocImportStart"),
        openList: k("DocImportOpenList"),
        uploading: k("DocImportUploading"),
        target: k("DocTarget"),
      }}
    />
  );
}
