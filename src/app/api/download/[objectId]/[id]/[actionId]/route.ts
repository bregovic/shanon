/** Soubor z akce záznamu (XML pro úřad, PDF…) — se stejnou kontrolou práv jako čtení. */
import { UserError } from "@/core/module";
import { getSession } from "@/server/auth";
import { downloadFile } from "@/server/data";
import { getT } from "@/server/i18n";

export async function GET(_: Request, { params }: { params: Promise<{ objectId: string; id: string; actionId: string }> }) {
  const s = await getSession();
  if (!s) return new Response(null, { status: 401 });
  const { objectId, id, actionId } = await params;
  try {
    const f = await downloadFile(s.ctx, objectId, id, actionId);
    const body = typeof f.data === "string" ? new TextEncoder().encode(f.data) : new Uint8Array(f.data);
    return new Response(body, {
      headers: {
        "Content-Type": f.mime,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof UserError) {
      const t = await getT(s.lang, s.ctx.tenantId);
      // chyba se ukáže jako text — prohlížeč ji zobrazí místo stažení
      return new Response(t(e.label, e.params), { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    throw e;
  }
}
