/** Stažení souboru z DocuRef — jen s právem číst záznam, ke kterému patří. */
import { UserError } from "@/core/module";
import { getSession } from "@/server/auth";
import { readFile } from "@/server/docuref";
import sharp from "sharp";

/** Náhledy obrázků (?w=…): jen tyto šířky, v paměti posledních MAX_THUMBS (id se nemění = obsah se nemění). */
const WIDTHS = new Set([160, 240, 320, 480, 640]);
const MAX_THUMBS = 400;
const thumbs = new Map<string, Uint8Array<ArrayBuffer>>();

async function thumbnail(key: string, data: Buffer, width: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const hit = thumbs.get(key);
  if (hit) {
    // nedávno použitý na konec (vyřazuje se nejstarší)
    thumbs.delete(key);
    thumbs.set(key, hit);
    return hit;
  }
  try {
    const out = new Uint8Array(await sharp(data).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer());
    thumbs.set(key, out);
    if (thumbs.size > MAX_THUMBS) thumbs.delete(thumbs.keys().next().value!);
    return out;
  } catch {
    return null; // neznámý formát → originál
  }
}

/** Tyto typy smí prohlížeč zobrazit přímo; ostatní jen ke stažení (žádné HTML/SVG/JS). */
const INLINE = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "text/plain"]);

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return new Response(null, { status: 401 });
  const { id } = await params;
  try {
    const f = await readFile(s.ctx, id);
    // náhled pro dlaždice (pokladna): zmenšený webp místo originální fotky
    const w = Number(new URL(req.url).searchParams.get("w"));
    if (WIDTHS.has(w) && f.mime.startsWith("image/") && f.mime !== "image/gif") {
      const t = await thumbnail(`${s.ctx.tenantId}:${id}:${w}`, f.data, w);
      if (t)
        return new Response(t, {
          headers: { "Content-Type": "image/webp", "Content-Length": String(t.length), "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=31536000, immutable" },
        });
    }
    const inline = INLINE.has(f.mime);
    return new Response(new Uint8Array(f.data), {
      headers: {
        "Content-Type": inline ? f.mime : "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        "Content-Length": String(f.data.length),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        // obrázek se nikdy nemění (nový = nové id) — kasa ho nemusí stahovat znovu
        "Cache-Control": f.mime.startsWith("image/") ? "private, max-age=31536000, immutable" : "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof UserError) return new Response(null, { status: 404 });
    throw e;
  }
}
