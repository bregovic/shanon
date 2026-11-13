/** Export reportu do Excelu (stejné parametry a oprávnění jako na stránce). */
import ExcelJS from "exceljs";
import { UserError } from "@/core/module";
import { getSession } from "@/server/auth";
import { getT } from "@/server/i18n";
import { findReport, runReport } from "@/server/report";

export async function GET(req: Request, { params }: { params: Promise<{ module: string; report: string }> }) {
  const s = await getSession();
  if (!s) return new Response(null, { status: 401 });
  const { module, report } = await params;
  const def = findReport(module, report);
  if (!def) return new Response(null, { status: 404 });
  const input = Object.fromEntries(new URL(req.url).searchParams.entries());
  const t = await getT(s.lang, s.ctx.tenantId);
  let res;
  try {
    res = await runReport(s, module, report, input);
  } catch (e) {
    if (e instanceof UserError) return new Response(t(e.label, e.params), { status: 403 });
    throw e;
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = "Shanon";
  const ws = wb.addWorksheet(t(def.label).slice(0, 31));
  ws.columns = res.columns.map((c) => ({ header: c.label, key: c.name, width: c.kind === "amount" ? 16 : c.name === "name" ? 40 : 12, style: c.kind === "amount" ? { numFmt: "# ##0.00" } : {} }));
  ws.getRow(1).font = { bold: true };
  for (const r of res.rows) {
    const row = ws.addRow(Object.fromEntries(res.columns.map((c) => [c.name, c.kind === "amount" ? Number(r[c.name] ?? 0) : String(r[c.name] ?? "")])));
    if (r._level) row.font = { bold: true };
  }
  const tot = res.columns.filter((c) => c.total);
  if (tot.length) {
    const row = ws.addRow(Object.fromEntries(res.columns.map((c, i) => [c.name, c.total ? res.rows.filter((r) => !r._level).reduce((a, r) => a + Math.round(Number(r[c.name] ?? 0) * 100), 0) / 100 || 0 : i === 0 ? t("@SYS:Total") : ""])));
    row.font = { bold: true };
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Response(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${t(def.label)}.xlsx`)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
