/** Simulátor platební brány — volba Zaplatit / Zrušit (veřejné, jen napojení simulátoru). */
import { simDecide } from "@/server/gateway-sim";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ tenant: string; log: string }> }) {
  const { tenant, log } = await params;
  const form = await req.formData().catch(() => null);
  const paid = String(form?.get("result") ?? "") === "paid";
  const res = await simDecide(tenant, log, paid);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  const self = `${proto}://${host}/pay-sim/${tenant}/${log}`;
  // návrat jen na stejnou aplikaci (e-shop), jinak výsledek na testovací stránce (pokladna: telefon)
  const back = res.returnUrl && res.returnUrl.startsWith(`${proto}://${host}/`) ? res.returnUrl : self;
  return Response.redirect(back, 303);
}
