/** Veřejný portál – logo a fotka pozadí (jen to, co stránka portálu ukazuje). */
import { portalImage } from "@/server/supplier-portal";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ tenant: string; token: string; kind: string }> }) {
  const { tenant, token, kind } = await params;
  const img = await portalImage(tenant, token, kind).catch(() => null);
  if (!img) return new Response("Nenalezeno", { status: 404 });
  return new Response(new Uint8Array(img.data), {
    headers: { "Content-Type": img.mime, "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" },
  });
}
