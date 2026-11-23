/**
 * Tisková stanice (Shanon Pokladna pro Windows): párování, fronta tiskových úloh a výběr tiskárny.
 *
 * Párovací kód `shp.<tenantId>.<náhodný>` je v osobním instalátoru (platí 3 dny, jednou); stanice za něj
 * dostane klíč `shs.<tenantId>.<náhodný>` — v DB jen otisky (int.device.pairHash / tokenHash).
 * Stanice si úlohy vyzvedává dlouhým dotazem (`takeJobs`, čeká až 25 s, nová úloha ji probudí),
 * stáhne PDF (`jobPdf`, nastavení tisku v hlavičce) a nahlásí výsledek (`reportJob`).
 * Tisk z Shanonu (`queueStationPrint`) = právo číst doklad; tiskárnu vybírá `resolveStationPrinter`.
 */
import "server-only";
import { randomBytes } from "node:crypto";
import { stationSha } from "./station-codes";
import type { RecordData, DataApi } from "@/core/module";
import { UserError } from "@/core/module";
import { PAPERS, type PrintLayout } from "@/core/print";
import { prisma, withTenant } from "./db";
import { companyModules } from "./modules";
import { inTenant, type Ctx } from "./data";
import { findPrintable, printJob } from "./print";
import { renderPdf } from "./print-pdf";
import { onStationWake, wakeStation } from "./station-wake";
import { labelTable } from "@/registry";
import { resolveLabel } from "@/core/labels";

const sha = stationSha;
/** stanice je online, když se ozvala v poslední minutě (dlouhý dotaz trvá 25 s) */
const ONLINE_MS = 60_000;

function stationCtx(dev: { tenantId: string; companyId: string | null; id: string; name: string; createdBy: string | null }, modules: Set<string>): Ctx {
  return {
    tenantId: dev.tenantId,
    companyId: dev.companyId,
    userId: dev.createdBy ?? dev.id,
    userName: `Stanice · ${dev.name}`,
    role: "api",
    perms: { admin: false, levels: {} },
    modules,
    extensions: new Set(),
    lang: "cs",
  };
}

async function ctxFor(dev: { tenantId: string; companyId: string | null; id: string; name: string; createdBy: string | null }) {
  const tenant = await prisma.sysTenant.findUnique({ where: { id: dev.tenantId }, include: { modules: true } });
  if (!tenant) return null;
  return stationCtx(dev, await companyModules(dev.tenantId, dev.companyId, tenant.modules.map((m) => m.moduleId)));
}

/** Spárovat stanici kódem z instalátoru → klíč stanice (jednou; kód se tím spotřebuje). */
export async function pairStation(code: string, info: { host?: string; version?: string }) {
  const m = /^shp\.([0-9a-f-]{36})\.[A-Za-z0-9_-]{20,}$/.exec(code.trim());
  if (!m) return null;
  const tenantId = m[1];
  const dev = await withTenant(tenantId, (tx) => tx.intDevice.findFirst({ where: { tenantId, pairHash: sha(code.trim()), active: true } }));
  if (!dev || !dev.pairExpires || dev.pairExpires.getTime() < Date.now()) return null;
  const ctx = await ctxFor(dev);
  if (!ctx) return null;
  const token = `shs.${tenantId}.${randomBytes(24).toString("base64url")}`;
  await inTenant(ctx, (s) =>
    s
      .sys()
      .api()
      .update("int.device", dev.id, {
        tokenHash: sha(token),
        pairHash: null,
        pairExpires: null,
        paired: true,
        hostName: info.host ? String(info.host).slice(0, 120) : null,
        agentVersion: info.version ? String(info.version).slice(0, 40) : null,
        lastSeenAt: new Date().toISOString(),
      }),
  );
  return { token, deviceId: dev.id, name: dev.name };
}

/** Stanice podle klíče v hlavičce Authorization; null = neplatný klíč nebo vypnuté zařízení. */
export async function stationAuth(authorization: string | null) {
  const m = /^Bearer\s+(shs\.([0-9a-f-]{36})\.[A-Za-z0-9_-]{20,})$/.exec(authorization ?? "");
  if (!m) return null;
  const [, token, tenantId] = m;
  const dev = await withTenant(tenantId, (tx) => tx.intDevice.findFirst({ where: { tenantId, tokenHash: sha(token), active: true } }));
  if (!dev) return null;
  const ctx = await ctxFor(dev);
  return ctx ? { ctx, deviceId: dev.id, lastSeen: dev.lastSeenAt } : null;
}

type Station = NonNullable<Awaited<ReturnType<typeof stationAuth>>>;

/** Stanice hlásí počítač, verzi a tiskárny Windows. */
export async function stationHello(st: Station, info: { host?: string; version?: string; printers?: { name: string; default?: boolean }[] }) {
  const printers = (info.printers ?? [])
    .filter((p) => p && typeof p.name === "string")
    .slice(0, 50)
    .map((p) => `${p.default ? "* " : ""}${p.name.slice(0, 200)}`)
    .join("\n");
  await inTenant(st.ctx, (s) =>
    s
      .sys()
      .api()
      .update("int.device", st.deviceId, {
        hostName: info.host ? String(info.host).slice(0, 120) : null,
        agentVersion: info.version ? String(info.version).slice(0, 40) : null,
        printers,
        lastSeenAt: new Date().toISOString(),
      }),
  );
}

/** Úloha předaná stanici, která se do 2 minut neozvala (stanice spadla) — dostane ji znovu. */
const RESEND_MS = 120_000;

async function pendingJobs(st: Station) {
  return inTenant(st.ctx, async (s) => {
    const api = s.sys().api();
    // „naposledy online“ stačí obnovit jednou za půl minuty
    if (!st.lastSeen || Date.now() - st.lastSeen.getTime() > 30_000) {
      await api.update("int.device", st.deviceId, { lastSeenAt: new Date().toISOString() });
      st.lastSeen = new Date();
    }
    const rows = await api.find("int.printJob", { deviceId: st.deviceId, status: { in: ["queued", "sent"] } }, { take: 20, orderBy: { createdAt: "asc" } });
    const due = rows.filter((j) => j.status === "queued" || !j.sentAt || Date.now() - new Date(String(j.sentAt)).getTime() > RESEND_MS);
    if (!due.length) return [];
    const conns = await api.find("int.connection", { id: { in: [...new Set(due.map((j) => String(j.connectionId)))] } }, { take: 50 });
    const now = new Date().toISOString();
    for (const j of due) await api.update("int.printJob", String(j.id), { status: "sent", sentAt: now });
    return due.map((j) => {
      const c = conns.find((x) => x.id === j.connectionId);
      return { id: String(j.id), printer: c?.printerName ? String(c.printerName) : "", copies: Number(j.copies) || 1, reference: String(j.reference ?? "") };
    });
  });
}

/** Dlouhý dotaz stanice: úlohy k tisku, jinak čeká (nejvýš `waitSec`), dokud nějaká nepřijde. */
export async function takeJobs(st: Station, waitSec: number) {
  const until = Date.now() + Math.min(Math.max(waitSec, 0), 25) * 1000;
  for (;;) {
    const jobs = await pendingJobs(st);
    const left = until - Date.now();
    if (jobs.length || left <= 0) return jobs;
    await new Promise<void>((resolve) => {
      const off = onStationWake(st.deviceId, () => {
        clearTimeout(t);
        off();
        resolve();
      });
      const t = setTimeout(() => {
        off();
        resolve();
      }, left);
    });
  }
}

/** Nastavení tisku pro SumatraPDF podle papíru dokladu a počtu kopií. */
export function printSettings(layout: Pick<PrintLayout, "paper">, copies: number): string {
  const paper = PAPERS[layout.paper];
  const parts: string[] = [];
  if (layout.paper === "receiptA6") parts.push("noscale", "paper=A6");
  else if (paper && !paper.h) parts.push("noscale");
  else if (layout.paper === "a4") parts.push("fit", "paper=A4");
  else if (layout.paper === "a5") parts.push("fit", "paper=A5");
  else parts.push("fit");
  if (copies > 1) parts.push(`${Math.min(copies, 20)}x`);
  return parts.join(",");
}

/** PDF úlohy (doklad nebo zkušební stránka) a nastavení tisku. */
export async function jobPdf(st: Station, jobId: string): Promise<{ pdf: Buffer; settings: string; name: string }> {
  const { job, conn, dev } = await inTenant(st.ctx, async (s) => {
    const api = s.sys().api();
    const job = await api.get("int.printJob", jobId);
    if (!job || job.deviceId !== st.deviceId) throw new UserError("@SYS:NotFound");
    return { job, conn: await api.get("int.connection", String(job.connectionId)), dev: await api.get("int.device", st.deviceId) };
  });
  const copies = Number(job.copies) || 1;
  if (!job.docType || !job.recordId) {
    const layout = testPageLayout(String(conn?.paperWidth ?? "a4"));
    const printer = String(conn?.printerName || conn?.name || ""), device = String(dev?.name ?? "");
    const t = (k: string, params: Record<string, string> = {}) => resolveLabel(labelTable, k, st.ctx.lang ?? "cs").replace(/\{(\w+)\}/g, (m, n: string) => params[n] ?? m);
    const data = { test: { title: t("@INT:StationTestTitle"), text: t("@INT:StationTestText", { printer, device }), printer, at: new Date().toLocaleString("cs-CZ", { timeZone: "Europe/Prague" }) } };
    return { pdf: await renderPdf(layout, data), settings: printSettings(layout, copies), name: "zkouska" };
  }
  const docType = String(job.docType);
  // tisk za stanici = číst jen tento druh dokladu (datová služba hlídá firmu a RLS)
  const ctx: Ctx = { ...st.ctx, perms: { admin: false, levels: { [docType]: "read" } } };
  const pj = await printJob(ctx, docType, String(job.recordId), job.templateId ? String(job.templateId) : null);
  return { pdf: await renderPdf(pj.layout, pj.data, { title: pj.title }), settings: printSettings(pj.layout, copies), name: pj.title || "doklad" };
}

/** Zkušební stránka na papír tiskárny. */
function testPageLayout(paperWidth: string): PrintLayout {
  const paper = paperWidth === "58" ? "receipt58" : paperWidth === "80" ? "receipt80" : paperWidth === "a6" ? "receiptA6" : "a4";
  const w = PAPERS[paper].w;
  const x = paper === "a4" ? 20 : 0;
  const tw = paper === "a4" ? 170 : w;
  return {
    paper,
    fontSize: 9,
    elements: [
      { id: "t", type: "text", x, y: paper === "a4" ? 20 : 0, w: tw, h: 8, text: "{test.title}", style: { bold: true, size: 12, align: "center" } },
      { id: "l", type: "line", x, y: paper === "a4" ? 30 : 9, w: tw, h: 1 },
      { id: "p", type: "text", x, y: paper === "a4" ? 32 : 11, w: tw, h: 12, text: "{test.text}\n{test.at}", style: { align: "center" } },
      { id: "q", type: "qr", x: x + tw / 2 - 12, y: paper === "a4" ? 50 : 26, w: 24, h: 24, field: "test.printer" },
    ],
  };
}

/** Výsledek tisku od stanice. */
export async function reportJob(st: Station, jobId: string, ok: boolean, message?: string) {
  await inTenant(st.ctx, async (s) => {
    const api = s.sys().api();
    const job = await api.get("int.printJob", jobId);
    if (!job || job.deviceId !== st.deviceId) throw new UserError("@SYS:NotFound");
    await api.update("int.printJob", jobId, {
      status: ok ? "done" : "error",
      doneAt: ok ? new Date().toISOString() : null,
      message: message ? String(message).slice(0, 250) : null,
    });
  });
}

/**
 * Tiskárna stanice pro doklad: účtenka → tiskárna pokladny (je-li to tiskárna stanice); jinak pravidla
 * „Doklady na tiskárnu“ — přednost má pravidlo pro uživatele, pak tiskárna počítače, ze kterého se tiskne
 * (`stationId` ze zástupce Shanon Pokladna), pak podle kódu tiskárny. null = tisk z prohlížeče.
 */
export async function resolveStationPrinter(api: DataApi, docType: string, recordId: string | null, stationId: string | null, userId: string): Promise<RecordData | null> {
  const printers = (await api.find("int.connection", { kind: "printer", driver: "station", active: true }, { take: 100, orderBy: { code: "asc" } })).filter((c) => c.deviceId);
  if (!printers.length) return null;
  if (docType === "pos.receipt" && recordId) {
    const rec = await api.get("pos.receipt", recordId).catch(() => null);
    const reg = rec?.registerId ? await api.get("pos.register", String(rec.registerId)).catch(() => null) : null;
    // pokladna má vybranou tiskárnu: tiskárna stanice → sem, jiná (prohlížeč, sériová) → stanice ne
    if (reg?.printerConnId) return printers.find((c) => c.id === reg.printerConnId) ?? null;
  }
  const routes = await api.find("int.printRoute", { docType }, { take: 100 });
  const rank = (r: RecordData, c: RecordData) => (r.userId === userId ? 0 : 2) + (stationId && c.deviceId === stationId ? 0 : 1);
  const cands = routes
    .filter((r) => !r.userId || r.userId === userId)
    .map((r) => ({ r, c: printers.find((c) => c.id === r.connectionId) }))
    .filter((x): x is { r: RecordData; c: RecordData } => !!x.c)
    .sort((a, b) => rank(a.r, a.c) - rank(b.r, b.c) || String(a.c.code).localeCompare(String(b.c.code)));
  return cands[0]?.c ?? null;
}

export interface StationQueued {
  printer: string;
  device: string;
  online: boolean;
}

/**
 * Poslat doklady na tiskárnu stanice (Tisk v Shanonu, kasa). null = žádná tiskárna stanice → tisk z prohlížeče.
 * Právo = číst doklady (stejně jako tisk z prohlížeče).
 */
export async function queueStationPrint(ctx: Ctx, docType: string, ids: string[], opts: { stationId?: string | null; templateId?: string | null } = {}): Promise<StationQueued | null> {
  const p = findPrintable(docType);
  if (!p || !ids.length) return null;
  const out = await inTenant(ctx, async (s) => {
    const recs: RecordData[] = [];
    for (const id of ids.slice(0, 100)) {
      const r = await s.get(docType, id);
      if (!r) throw new UserError("@SYS:NotFound");
      recs.push(r);
    }
    const api = s.sys().api();
    const conn = await resolveStationPrinter(api, docType, ids[0], opts.stationId ?? null, ctx.userId);
    if (!conn) return null;
    for (const r of recs)
      await api.create("int.printJob", {
        deviceId: conn.deviceId,
        connectionId: conn.id,
        docType,
        recordId: r.id,
        templateId: opts.templateId || null,
        reference: String(r[p.numberField] ?? ""),
        copies: Number(conn.copies) || 1,
        status: "queued",
      });
    const dev = await api.get("int.device", String(conn.deviceId));
    const seen = dev?.lastSeenAt ? new Date(String(dev.lastSeenAt)).getTime() : 0;
    return { deviceId: String(conn.deviceId), printer: String(conn.printerName || conn.name), device: String(dev?.name ?? ""), online: Date.now() - seen < ONLINE_MS };
  });
  if (!out) return null;
  wakeStation(out.deviceId);
  return { printer: out.printer, device: out.device, online: out.online };
}
