/** Tisková sestava jako PDF (náhled v prohlížeči, ?download=1 = stáhnout). */
import { UserError } from "@/core/module";
import { getSession } from "@/server/auth";
import { getT } from "@/server/i18n";
import { printJob } from "@/server/print";
import { renderPdf } from "@/server/print-pdf";

export async function GET(req: Request, { params }: { params: Promise<{ docType: string; id: string }> }) {
  const s = await getSession();
  if (!s) return new Response(null, { status: 401 });
  const { docType, id } = await params;
  const url = new URL(req.url);
  try {
    const job = await printJob(s.ctx, docType, id, url.searchParams.get("template"));
    const pdf = await renderPdf(job.layout, job.data, { locale: s.lang === "en" ? "en-GB" : "cs-CZ", title: job.title });
    const name = `${(job.title || "doklad").replace(/[^\w.-]+/g, "_")}.pdf`;
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
