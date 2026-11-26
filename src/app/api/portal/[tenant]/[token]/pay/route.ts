/**
 * Portál smluv — platba kartou (Apple Pay, Google Pay) bránou za první splátku uzavřené smlouvy.
 * POST { ref } = adresa platební stránky; GET ?ref= = stav po návratu z brány (ověří se u brány).
 * `ref` = id smlouvy z odpovědi uzavření (zná ho jen ten, kdo smlouvu uzavřel). Logika: `src/server/agreement-portal.ts`.
 */
import { agreementPortalPaid, agreementPortalPay } from "@/server/agreement-portal";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ tenant: string; token: string }> }) {
  const { tenant, token } = await params;
  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  const ref = String(b.ref ?? "");
  // za proxy Railway: veřejná adresa z hlaviček
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  const origin = `${proto}://${host}`;
  const back = String(b.back ?? "");
  // návrat jen na stejný web (stránka portálu)
  const backUrl = back.startsWith("/") && !back.startsWith("//") ? `${origin}${back}` : origin;
  const url = await agreementPortalPay(tenant, token, ref, origin, backUrl).catch(() => null);
  return url ? Response.json({ ok: true, url }) : Response.json({ ok: false, error: "Platba kartou teď nejde – zaplaťte prosím převodem." }, { status: 400 });
}

export async function GET(req: Request, { params }: { params: Promise<{ tenant: string; token: string }> }) {
  const { tenant, token } = await params;
  const ref = new URL(req.url).searchParams.get("ref") ?? "";
  const st = await agreementPortalPaid(tenant, token, ref).catch(() => null);
  return st ? Response.json({ ok: true, ...st }) : Response.json({ ok: false }, { status: 404 });
}
