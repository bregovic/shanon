/**
 * Portál smluv — uzavření smlouvy (veřejné, bez přihlášení). Kontroly a limity:
 * `src/server/agreement-portal.ts`. Tady jen velikost těla a past na roboty.
 */
import { agreementPortalSubmit } from "@/server/agreement-portal";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ tenant: string; token: string }> }) {
  const { tenant, token } = await params;
  const len = Number(req.headers.get("content-length") ?? 0);
  if (!len || len > 20_000) return Response.json({ ok: false, error: "Požadavek je příliš velký." }, { status: 413 });
  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "Neplatný požadavek." }, { status: 400 });
  }
  // past na roboty: skryté pole vyplní jen automat — odpověď jako úspěch, nic se neuloží
  if (String(b.website ?? "")) return Response.json({ ok: true });
  const str = (k: string) => String(b[k] ?? "");
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  const res = await agreementPortalSubmit(
    tenant,
    token,
    { tariffId: str("tariffId"), firstName: str("firstName"), lastName: str("lastName"), email: str("email"), phone: str("phone"), street: str("street"), city: str("city"), zipCode: str("zipCode"), startDate: str("startDate"), consent: b.consent === true },
    ip,
  );
  if (!res) return Response.json({ ok: false, error: "Odkaz neplatí." }, { status: 404 });
  return Response.json(res, { status: res.ok ? 200 : 400 });
}
