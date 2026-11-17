/**
 * Šablona CSV pro import (hlavička z popisků polí). `?data=1` = i se záznamy (stejné filtry a řazení jako seznam,
 * hodnoty v tvaru pro import) — úprava v Excelu a import zpět aktualizuje záznamy podle klíče.
 */
import { UserError } from "@/core/module";
import { can } from "@/core/security";
import { getSession } from "@/server/auth";
import { getObject, inTenant } from "@/server/data";
import type { RecordData } from "@/core/module";
import { getT } from "@/server/i18n";
import { importTemplate } from "@/server/import";
import { hiddenFields } from "@/server/ui";

const MAX_ROWS = 50_000;
const PAGE = 2_000;

export async function GET(req: Request, { params }: { params: Promise<{ objectId: string }> }) {
  const s = await getSession();
  if (!s) return new Response(null, { status: 401 });
  const { objectId } = await params;
  try {
    const def = getObject(objectId);
    if (!s.ctx.modules.has(def.id.split(".")[0]) || !can(s.ctx.perms, def.id, "write") || def.systemOnly) throw new UserError("@SYS:NoAccess");
    const t = await getT(s.lang, s.ctx.tenantId);
    const url = new URL(req.url);
    let rows: RecordData[] | undefined;
    if (url.searchParams.get("data") === "1") {
      let filters: Record<string, string> = {};
      try {
        const f = JSON.parse(url.searchParams.get("filters") ?? "{}");
        if (f && typeof f === "object") filters = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, String(v)]));
      } catch {
        /* neplatné filtry = bez filtrů */
      }
      const sort = url.searchParams.get("sort") ?? undefined;
      const dir = url.searchParams.get("dir") === "desc" ? "desc" : "asc";
      rows = await inTenant(s.ctx, async (sess) => {
        const out: RecordData[] = [];
        for (let page = 1; out.length < MAX_ROWS; page++) {
          const r = await sess.list(objectId, { filters, sort, dir, page, pageSize: PAGE, maxPageSize: PAGE, lang: s.lang });
          out.push(...r.rows);
          if (r.rows.length < PAGE) break;
        }
        return out.slice(0, MAX_ROWS);
      });
    }
    const name = `${t(def.labelPlural)}.csv`;
    return new Response(importTemplate(def, s.lang, hiddenFields(s.ctx, def), rows), {
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
