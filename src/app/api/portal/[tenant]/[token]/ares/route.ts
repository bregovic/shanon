/** Portál smluv – údaje firmy z ARES podle IČO pro formulář (veřejné, limit na adresu v agreement-portal.ts). */
import { agreementPortalAres } from "@/server/agreement-portal";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ tenant: string; token: string }> }) {
  const { tenant, token } = await params;
  const ico = new URL(req.url).searchParams.get("ico") ?? "";
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  const r = await agreementPortalAres(tenant, token, ico, ip).catch(() => ({ ok: false as const, error: "ARES teď neodpovídá – vyplňte údaje ručně." }));
  if (!r) return Response.json({ ok: false, error: "Odkaz neplatí." }, { status: 404 });
  return Response.json(r, { headers: { "Cache-Control": "no-store" } });
}
