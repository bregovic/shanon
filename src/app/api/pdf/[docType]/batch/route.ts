/** Vybrané doklady v jednom PDF (hromadný tisk ze seznamu), ?ids=a,b,c. */
import { UserError } from "@/core/module";
import { getSession } from "@/server/auth";
import { getT } from "@/server/i18n";
import { batchIds, printJob } from "@/server/print";
import { renderPdfMany } from "@/server/print-pdf";

export async function GET(req: Request, { params }: { params: Promise<{ docType: string }> }) {
  const s = await getSession();
  if (!s) return new Response(null, { status: 401 });
  const { docType } = await params;
  const url = new URL(req.url);
  try {
    const ids = batchIds(url.searchParams.get("ids"));
    const template = url.searchParams.get("template");
    // doklad po dokladu: každý má vlastní transakci a kontrolu práva (printJob)
    const jobs = [];
    for (const id of ids) jobs.push(await printJob(s.ctx, docType, id, template));
    const pdf = await renderPdfMany(
      jobs.map((j) => ({ layout: j.layout, data: j.data })),
      { locale: s.lang === "en" ? "en-GB" : "cs-CZ", title: jobs.map((j) => j.title).join(", ") },
    );
    const name = `${(jobs.length === 1 ? jobs[0].title : `${jobs[0].title}-${jobs[jobs.length - 1].title}`).replace(/[^\w.-]+/g, "_") || "doklady"}.pdf`;
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${url.searchParams.get("download") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof UserError) {
      const t = await getT(s.lang, s.ctx.tenantId);
      return new Response(t(e.label, e.params), { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    throw e;
  }
}
