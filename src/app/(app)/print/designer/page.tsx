import { notFound } from "next/navigation";
import { PrintDesigner } from "@/components/print-designer";
import { can } from "@/core/security";
import prt from "@/modules/prt";
import { requireSession } from "@/server/auth";
import { listRecords } from "@/server/data";
import { getT } from "@/server/i18n";
import { findPrintable, parseLayout, printablesFor } from "@/server/print";

export const metadata = { title: "Návrhář sestav" };

export default async function DesignerPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t: initialId } = await searchParams;
  const s = await requireSession();
  if (!s.ctx.modules.has("prt") || !s.ctx.companyId || !can(s.ctx.perms, "prt.template", "write")) notFound();
  const t = await getT(s.lang, s.ctx.tenantId);
  const printables = printablesFor(s.ctx);
  const allowed = new Set(printables.map((p) => p.id));
  const rows = (await listRecords(s.ctx, "prt.template", { pageSize: 200 })).rows.filter((r) => allowed.has(String(r.docType)));
  const templates = rows.map((r) => ({ id: String(r.id), name: `${r.name} (${r.code})`, docType: String(r.docType), layout: parseLayout(r.layout, findPrintable(String(r.docType))!) }));
  const catalogs = printables.map((p) => ({
    docType: p.id,
    fields: p.fields.map((f) => ({ path: f.path, label: t(f.label), format: f.format })),
    lineFields: p.lineFields.map((f) => ({ path: f.path, label: t(f.label), format: f.format })),
  }));
  const labels = { ...Object.fromEntries(Object.keys(prt.labels.cs).map((k) => [k, t(`@PRT:${k}`)])), Save: t("@SYS:Save") };
  return (
    <PrintDesigner
      crumbs={[{ label: t("@PRT:Module"), href: "/prt" }, { label: t("@PRT:Designer") }]}
      templates={templates}
      catalogs={catalogs}
      initialId={initialId ?? null}
      labels={labels}
    />
  );
}
