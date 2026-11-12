/**
 * Export seznamu do Excelu — stejné filtry a řazení jako v gridu, stejná
 * kontrola oprávnění (datová služba). Nejvýš 50 000 řádků.
 */
import ExcelJS from "exceljs";
import { UserError, type RecordData } from "@/core/module";
import { displayValue } from "@/lib/meta";
import { registry } from "@/registry";
import { getSession } from "@/server/auth";
import { inTenant } from "@/server/data";
import { getT } from "@/server/i18n";
import { fieldsMeta } from "@/server/ui";

const MAX_ROWS = 50_000;
const PAGE = 2_000;

export async function GET(req: Request, { params }: { params: Promise<{ objectId: string }> }) {
  const s = await getSession();
  if (!s) return new Response(null, { status: 401 });
  const { objectId } = await params;
  const def = registry.objects.get(objectId);
  if (!def) return new Response(null, { status: 404 });
  const url = new URL(req.url);
  let filters: Record<string, string> = {};
  try {
    const f = JSON.parse(url.searchParams.get("filters") ?? "{}");
    if (f && typeof f === "object") filters = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, String(v)]));
  } catch {
    /* neplatné filtry = bez filtrů */
  }
  const sort = url.searchParams.get("sort") ?? undefined;
  const dir = url.searchParams.get("dir") === "desc" ? "desc" : "asc";
  const t = await getT(s.lang, s.ctx.tenantId);
  const meta = fieldsMeta(s.ctx, def, t);
  const columns = def.list.map((f) => meta[f]);

  let rows: RecordData[];
  try {
    rows = await inTenant(s.ctx, async (sess) => {
      const out: RecordData[] = [];
      for (let page = 1; out.length < MAX_ROWS; page++) {
        const r = await sess.list(objectId, { filters, sort, dir, page, pageSize: PAGE, maxPageSize: PAGE, lang: s.lang });
        out.push(...r.rows);
        if (r.rows.length < PAGE) break;
      }
      return out.slice(0, MAX_ROWS);
    });
  } catch (e) {
    if (e instanceof UserError) return new Response(t(e.label, e.params), { status: 403 });
    throw e;
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Shanon";
  const ws = wb.addWorksheet(t(def.labelPlural).slice(0, 31));
  ws.columns = columns.map((c) => ({
    header: c.label,
    key: c.name,
    width: c.kind === "string" || c.kind === "text" || c.kind === "ref" ? 28 : 14,
    style:
      c.kind === "decimal"
        ? { numFmt: "#,##0.00" }
        : c.kind === "date"
          ? { numFmt: "d.m.yyyy" }
          : c.kind === "datetime"
            ? { numFmt: "d.m.yyyy h:mm" }
            : {},
  }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of rows) {
    const values: Record<string, unknown> = {};
    for (const c of columns) {
      const v = c.ext ? (r.ext as RecordData | undefined)?.[c.name] : r[c.name];
      if (v === null || v === undefined || v === "") values[c.name] = null;
      else if (c.kind === "decimal" || c.kind === "int") values[c.name] = Number(v);
      else if (c.kind === "date") values[c.name] = new Date(`${v}T00:00:00Z`);
      else if (c.kind === "datetime") values[c.name] = new Date(String(v));
      else values[c.name] = displayValue(c, r, s.lang);
    }
    ws.addRow(values);
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

  const buf = await wb.xlsx.writeBuffer();
  const name = `${t(def.labelPlural)} ${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new Response(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
