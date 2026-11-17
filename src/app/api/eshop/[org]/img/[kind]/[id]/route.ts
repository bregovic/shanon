/** E-shop — obrázky položek, kategorií, logo a úvodní obrázek (jen to, co obchod ukazuje). */
import { shopImage } from "@/server/eshop";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ org: string; kind: string; id: string }> }) {
  const { org, kind, id } = await params;
  const img = await shopImage(org, kind, id);
  if (!img) return new Response("Nenalezeno", { status: 404 });
  return new Response(new Uint8Array(img.data), {
    headers: { "Content-Type": img.mime, "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" },
  });
}
