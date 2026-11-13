/** Šablona CSV pro import do číselníku (hlavička z popisků polí). */
import { UserError } from "@/core/module";
import { can } from "@/core/security";
import { getSession } from "@/server/auth";
import { getObject } from "@/server/data";
import { getT } from "@/server/i18n";
import { importTemplate } from "@/server/import";
import { hiddenFields } from "@/server/ui";

export async function GET(_: Request, { params }: { params: Promise<{ objectId: string }> }) {
  const s = await getSession();
  if (!s) return new Response(null, { status: 401 });
  const { objectId } = await params;
  try {
    const def = getObject(objectId);
    if (!s.ctx.modules.has(def.id.split(".")[0]) || !can(s.ctx.perms, def.id, "write") || def.systemOnly) throw new UserError("@SYS:NoAccess");
    const t = await getT(s.lang, s.ctx.tenantId);
    const name = `${t(def.labelPlural)}.csv`;
    return new Response(importTemplate(def, s.lang, hiddenFields(s.ctx, def)), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof UserError) return new Response(null, { status: 403 });
    throw e;
  }
}
