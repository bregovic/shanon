/** Stažení souboru z DocuRef — jen s právem číst záznam, ke kterému patří. */
import { UserError } from "@/core/module";
import { getSession } from "@/server/auth";
import { readFile } from "@/server/docuref";

/** Tyto typy smí prohlížeč zobrazit přímo; ostatní jen ke stažení (žádné HTML/SVG/JS). */
const INLINE = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "text/plain"]);

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return new Response(null, { status: 401 });
  const { id } = await params;
  try {
    const f = await readFile(s.ctx, id);
    const inline = INLINE.has(f.mime);
    return new Response(new Uint8Array(f.data), {
      headers: {
        "Content-Type": inline ? f.mime : "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        "Content-Length": String(f.data.length),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof UserError) return new Response(null, { status: 404 });
    throw e;
  }
}
