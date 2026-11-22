/** Aplikace Portál — podání dokladů přihlášeného (soubory). Identita z cookie portálu, kontroly v portal-app.ts. */
import { UserError } from "@/core/module";
import { PORTAL_CAPS } from "@/modules/int/portal";
import { getT } from "@/server/i18n";
import { portalAppSubmit } from "@/server/portal-app";
import { portalIdentity } from "@/server/portal-auth";

export const dynamic = "force-dynamic";

const MAX_BODY = (PORTAL_CAPS.maxFiles * PORTAL_CAPS.maxFileMb + 1) * 1024 * 1024;

export async function POST(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const id = await portalIdentity(tenant);
  if (!id) return Response.json({ ok: false, error: "Přihlášení vypršelo — přihlaste se znovu.", files: [] }, { status: 401 });
  const len = Number(req.headers.get("content-length") ?? 0);
  if (!len || len > MAX_BODY) return Response.json({ ok: false, error: "Požadavek je příliš velký.", files: [] }, { status: 413 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ ok: false, error: "Neplatný požadavek.", files: [] }, { status: 400 });
  }
  const files: { name: string; type: string; data: Buffer }[] = [];
  for (const f of form.getAll("files")) if (f instanceof File && f.size) files.push({ name: f.name, type: f.type, data: Buffer.from(await f.arrayBuffer()) });
  try {
    const res = await portalAppSubmit(id, { companyId: String(form.get("companyId") ?? ""), agenda: String(form.get("agenda") ?? ""), note: String(form.get("note") ?? ""), paymentState: String(form.get("paymentState") ?? ""), files });
    return Response.json(res, { status: res.ok ? 200 : 400 });
  } catch (e) {
    // chyba nastavení firmy (číselná řada…) → hláška uživateli, podrobnosti do logu serveru
    console.error("portál: podání", e);
    const t = await getT("cs", id.tenantId);
    return Response.json({ ok: false, error: e instanceof UserError ? t(e.label, e.params) : t("@INT:AppError"), files: [] }, { status: 400 });
  }
}
