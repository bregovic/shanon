/** E-shop — Zaplatit kartou / Google Pay: přesměrování na platební stránku brány (jinak zpět na objednávku). */
import { shopPay } from "@/server/eshop";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ org: string; token: string }> }) {
  const { org, token } = await params;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  const origin = `${proto}://${host}`;
  const url = /^[A-Za-z0-9_-]{20,64}$/.test(token) ? await shopPay(org, token, origin).catch(() => null) : null;
  return Response.redirect(url ?? `${origin}/${org}/objednavka/${token}`, 303);
}
