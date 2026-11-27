/** Zákaznická obrazovka (veřejné, odkaz portálu): dlouhý dotaz na stav nákupu pokladny, `?v=` = poslední známá verze. */
import { displayPortalState } from "@/server/display-portal";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ tenant: string; token: string }> }) {
  const { tenant, token } = await params;
  const since = Number(new URL(req.url).searchParams.get("v") ?? -1);
  const r = await displayPortalState(tenant, token, Number.isFinite(since) ? since : -1).catch(() => null);
  if (!r) return new Response(JSON.stringify({ error: "not-found" }), { status: 404, headers: { "Content-Type": "application/json" } });
  return new Response(JSON.stringify(r), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
