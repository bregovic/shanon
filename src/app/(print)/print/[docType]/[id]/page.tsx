import { notFound } from "next/navigation";
import { PrintToolbar } from "@/components/print-toolbar";
import { UserError } from "@/core/module";
import { PrintDocument, printCss } from "@/lib/print-render";
import { requireSession } from "@/server/auth";
import { getT } from "@/server/i18n";
import { printJob } from "@/server/print";

export const metadata = { title: "Tisk" };

export default async function PrintPage({ params, searchParams }: { params: Promise<{ docType: string; id: string }>; searchParams: Promise<{ template?: string; auto?: string }> }) {
  const { docType, id } = await params;
  const { template, auto } = await searchParams;
  const s = await requireSession();
  const t = await getT(s.lang, s.ctx.tenantId);
  let job;
  try {
    job = await printJob(s.ctx, docType, id, template ?? null);
  } catch (e) {
    if (e instanceof UserError) notFound();
    throw e;
  }
  return (
    <div style={{ background: "#e9e9e9", minHeight: "100vh" }}>
      <style>{`${printCss(job.layout)} .print-sheet { box-shadow: 0 1px 6px rgba(0,0,0,.25); } @media print { .print-sheet { box-shadow: none; margin: 0 !important; } div { background: #fff !important; } }`}</style>
      <PrintToolbar
        title={job.title}
        templates={job.templates}
        templateId={job.templateId}
        autoPrint={auto === "1"}
        pdfHref={`/api/pdf/${docType}/${id}`}
        labels={{ print: t("@PRT:Print"), template: t("@PRT:Template1"), back: t("@PRT:Back"), pdf: t("@PRT:Pdf") }}
      />
      <div className="print-sheet" style={{ width: "fit-content", margin: "16px auto", background: "#fff" }}>
        <PrintDocument layout={job.layout} data={job.data} locale={s.lang === "en" ? "en-GB" : "cs-CZ"} />
      </div>
    </div>
  );
}
