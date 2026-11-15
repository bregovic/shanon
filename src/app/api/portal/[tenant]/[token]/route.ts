/**
 * Dodavatelský portál — příjem souborů (veřejné, bez přihlášení). Kontroly a limity:
 * `src/server/supplier-portal.ts`. Tady jen velikost těla a past na roboty.
 */
import { portalSubmit } from "@/server/supplier-portal";
import { PORTAL_CAPS } from "@/modules/int/portal";

export const dynamic = "force-dynamic";

// tělo požadavku nejvýš na max. počet souborů × max. velikost (+ formulář)
const MAX_BODY = (PORTAL_CAPS.maxFiles * PORTAL_CAPS.maxFileMb + 1) * 1024 * 1024;

export async function POST(req: Request, { params }: { params: Promise<{ tenant: string; token: string }> }) {
  const { tenant, token } = await params;
  const len = Number(req.headers.get("content-length") ?? 0);
  if (!len || len > MAX_BODY) return Response.json({ ok: false, error: "Požadavek je příliš velký." }, { status: 413 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ ok: false, error: "Neplatný požadavek." }, { status: 400 });
  }
  // past na roboty: skryté pole vyplní jen automat — odpověď jako úspěch, nic se neuloží
  if (String(form.get("website") ?? "")) return Response.json({ ok: true, files: [] });
  const files: { name: string; type: string; data: Buffer }[] = [];
  for (const f of form.getAll("files")) if (f instanceof File && f.size) files.push({ name: f.name, type: f.type, data: Buffer.from(await f.arrayBuffer()) });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  const res = await portalSubmit(
    tenant,
    token,
    { kind: String(form.get("kind") ?? ""), regNo: String(form.get("regNo") ?? ""), name: String(form.get("name") ?? ""), email: String(form.get("email") ?? ""), note: String(form.get("note") ?? ""), files },
    ip,
  );
  if (!res) return Response.json({ ok: false, error: "Odkaz neplatí." }, { status: 404 });
  return Response.json(res, { status: res.ok ? 200 : 400 });
}
