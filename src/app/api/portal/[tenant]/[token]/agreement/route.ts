/**
 * Portál smluv — uzavření smlouvy (veřejné, bez přihlášení). Kontroly a limity:
 * `src/server/agreement-portal.ts`. Tady jen velikost těla a past na roboty.
 */
import { agreementPortalMail, agreementPortalSubmit } from "@/server/agreement-portal";

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
    { tariffId: str("tariffId"), firstName: str("firstName"), lastName: str("lastName"), email: str("email"), phone: str("phone"), street: str("street"), city: str("city"), zipCode: str("zipCode"), startDate: str("startDate"), consent: b.consent === true, answers: answersOf(b.answers) },
    ip,
  );
  if (!res) return Response.json({ ok: false, error: "Odkaz neplatí." }, { status: 404 });
  // vyplněná smlouva a obchodní podmínky e-mailem (mimo transakci uzavření)
  const mailedTo = res.ok ? await agreementPortalMail(tenant, token, res) : null;
  const { agreementId: _id, ...out } = res;
  void _id;
  return Response.json({ ...out, mailedTo: mailedTo ?? undefined }, { status: res.ok ? 200 : 400 });
}

/** Odpovědi formuláře: jen jednoduché hodnoty, nejvýš 200 polí po 2 000 znacích. */
function answersOf(v: unknown): Record<string, string | boolean> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string | boolean> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 200)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(k)) continue;
    if (typeof x === "boolean") out[k] = x;
    else if (typeof x === "string" || typeof x === "number") out[k] = String(x).slice(0, 2000);
  }
  return out;
}
