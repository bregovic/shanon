import { notFound } from "next/navigation";
import { ReportView } from "@/components/report-view";
import { defaultParams } from "@/core/report";
import { registry } from "@/registry";
import { requireSession } from "@/server/auth";
import { getT } from "@/server/i18n";
import { canRunReport, findReport, runReport } from "@/server/report";
import { listRecords } from "@/server/data";

export default async function ReportPage({ params }: { params: Promise<{ module: string; report: string }> }) {
  const { module, report } = await params;
  const s = await requireSession();
  const def = findReport(module, report);
  const mod = registry.modules.get(module);
  if (!def || !mod) notFound();
  const t = await getT(s.lang, s.ctx.tenantId);
  if (!canRunReport(s, module, def)) return <p style={{ padding: 24 }}>{t("@SYS:NoAccess")}</p>;
  const initial = await runReport(s, module, report, defaultParams(def));
  // parametry dimenzí jen pro aktivní dimenze, s jejich názvy
  const paramDefs = await Promise.all(
    def.params
      .filter((p) => p.kind !== "dimension" || s.ctx.dims?.some((d) => `dim${d.slot}` === p.name))
      .map(async (p) => ({
        name: p.name,
        kind: p.kind,
        label: p.kind === "dimension" ? s.ctx.dims!.find((d) => `dim${d.slot}` === p.name)!.name : t(p.label),
        // výběr záznamu (pokladna…): titulek = titleField a název
        options:
          p.kind === "ref" && p.refObject
            ? (await listRecords(s.ctx, p.refObject, { pageSize: 200 })).rows.map((r) => {
                const o = registry.objects.get(p.refObject!)!;
                return { value: String(r.id), label: [r[o.titleField], r.name].filter(Boolean).join(" · ") };
              })
            : undefined,
      })),
  );
  return (
    <ReportView
      module={module}
      report={report}
      crumbs={[{ label: t(mod.label), href: `/${module}` }, { label: t(def.label) }]}
      description={def.description ? t(def.description) : ""}
      params={paramDefs}
      initial={initial}
      lang={s.lang}
      labels={{ run: t("@SYS:Run"), export: t("@SYS:Export"), total: t("@SYS:Total"), empty: t("@SYS:Empty") }}
    />
  );
}
