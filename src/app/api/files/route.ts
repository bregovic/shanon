/** Nahrání souboru k záznamu (DocuRef). Relaci a práva ověřuje docuref.ts. */
import { UserError } from "@/core/module";
import { getSession } from "@/server/auth";
import { addFile, MAX_FILE_BYTES } from "@/server/docuref";
import { getT } from "@/server/i18n";

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return Response.json({ ok: false }, { status: 401 });
  const len = Number(req.headers.get("content-length") ?? 0);
  const t = await getT(s.lang, s.ctx.tenantId);
  if (len > MAX_FILE_BYTES + 64 * 1024) return Response.json({ ok: false, message: t("@SYS:FileTooLarge", { max: "10 MB" }) }, { status: 413 });
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new UserError("@SYS:Required");
    await addFile(s.ctx, String(form.get("objectId")), String(form.get("recordId")), {
      name: file.name,
      type: file.type,
      data: Buffer.from(await file.arrayBuffer()),
    });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UserError) return Response.json({ ok: false, message: t(e.label, e.params) }, { status: 400 });
    throw e;
  }
}
