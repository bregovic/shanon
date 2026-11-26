/**
 * Hromadné stažení: soubor akce (`actions[].download` + `bulk`) za každý vybraný záznam, dohromady v ZIP
 * (?ids=a,b,c). Každý soubor se stejnou kontrolou práv jako jednotlivé stažení; nejvýš jako hromadný tisk.
 */
import { UserError } from "@/core/module";
import { getSession } from "@/server/auth";
import { downloadFile } from "@/server/data";
import { getT } from "@/server/i18n";
import { batchIds } from "@/server/print";
import { zipFiles } from "@/server/zip";

export async function GET(req: Request, { params }: { params: Promise<{ objectId: string; actionId: string }> }) {
  const s = await getSession();
  if (!s) return new Response(null, { status: 401 });
  const { objectId, actionId } = await params;
  try {
    const ids = batchIds(new URL(req.url).searchParams.get("ids"));
    const files = [];
    for (const id of ids) {
      const f = await downloadFile(s.ctx, objectId, id, actionId);
      files.push({ name: f.name, data: typeof f.data === "string" ? Buffer.from(f.data, "utf8") : Buffer.from(f.data) });
    }
    const zip = zipFiles(files);
    const name = `${actionId.toUpperCase()}-${new Date().toISOString().slice(0, 10)}-${files.length}.zip`;
    return new Response(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
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
