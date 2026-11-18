/** Hromadný tisk ze seznamu: vybrané doklady pod sebou, každý od nové stránky (?ids=a,b,c). */
import { notFound } from "next/navigation";
import { PrintToolbar } from "@/components/print-toolbar";
import { UserError } from "@/core/module";
import { PrintDocument, printCss } from "@/lib/print-render";
import { requireSession } from "@/server/auth";
import { getT } from "@/server/i18n";
import { batchIds, printJob } from "@/server/print";

export const metadata = { title: "Tisk" };

export default async function PrintBatchPage({ params, searchParams }: { params: Promise<{ docType: string }>; searchParams: Promise<{ ids?: string; template?: string; auto?: string }> }) {
  const { docType } = await params;
  const { ids: raw, template, auto } = await searchParams;
  const s = await requireSession();
  const t = await getT(s.lang, s.ctx.tenantId);
  const jobs = [];
  try {
    const ids = batchIds(raw);
    for (const id of ids) jobs.push(await printJob(s.ctx, docType, id, template ?? null));
  } catch (e) {
    if (e instanceof UserError) notFound();
    throw e;
  }
  const first = jobs[0];
  const locale = s.lang === "en" ? "en-GB" : "cs-CZ";
  return (
    <div style={{ background: "#e9e9e9", minHeight: "100vh" }}>
      <style>{`${printCss(first.layout)} .print-sheet { box-shadow: 0 1px 6px rgba(0,0,0,.25); } @media print { .print-sheet { box-shadow: none; margin: 0 !important; break-after: page; } .print-sheet:last-child { break-after: auto; } div { background: #fff !important; } }`}</style>
      <PrintToolbar
        title={t("@PRT:BatchTitle", { count: String(jobs.length) })}
        templates={first.templates}
        templateId={first.templateId}
        autoPrint={auto === "1"}
        pdfHref={`/api/pdf/${docType}/batch?ids=${jobs.length ? encodeURIComponent(String(raw)) : ""}`}
        labels={{ print: t("@PRT:Print"), template: t("@PRT:Template1"), back: t("@PRT:Back"), pdf: t("@PRT:Pdf") }}
      />
      {jobs.map((j, i) => (
        <div key={i} className="print-sheet" style={{ width: "fit-content", margin: "16px auto", background: "#fff" }}>
          <PrintDocument layout={j.layout} data={j.data} locale={locale} />
        </div>
      ))}
    </div>
  );
}
