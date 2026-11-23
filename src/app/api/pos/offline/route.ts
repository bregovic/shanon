/**
 * Kasa odesílá prodeje uložené bez připojení (src/lib/pos-offline.ts). Obyčejná adresa místo serverové
 * akce: stránka kasy otevřená ze zálohy (bez připojení) může být ze starší verze aplikace.
 */
import { getSession } from "@/server/auth";
import { syncOfflineSales } from "@/server/pos-offline";
import { publicUrl } from "@/server/system-mail";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return Response.json({ error: "login" }, { status: 401 });
  // jen z vlastní stránky (relace v cookie)
  const origin = req.headers.get("origin");
  let pub: string | null = null;
  try {
    pub = new URL(publicUrl()).host;
  } catch {
    /* veřejná adresa není nastavená (lokálně) */
  }
  const hosts = [req.headers.get("x-forwarded-host"), req.headers.get("host"), pub].filter(Boolean);
  if (origin && !hosts.includes(new URL(origin).host)) return Response.json({ error: "origin" }, { status: 403 });
  try {
    return Response.json(await syncOfflineSales(s.ctx, await req.json()), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
