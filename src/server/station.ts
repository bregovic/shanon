/**
 * Tisková stanice (Shanon Pokladna pro Windows): párování, fronta tiskových úloh a výběr tiskárny.
 *
 * Párovací kód `shp.<tenantId>.<náhodný>` je v osobním instalátoru (platí 3 dny, jednou); stanice za něj
 * dostane klíč `shs.<tenantId>.<náhodný>` — v DB jen otisky (int.device.pairHash / tokenHash).
 * Stanice si úlohy vyzvedává dlouhým dotazem (`takeJobs`, čeká až 25 s, nová úloha ji probudí),
 * stáhne PDF (`jobPdf`, nastavení tisku v hlavičce) a nahlásí výsledek (`reportJob`).
 * Tiskárny Windows hlásí stanice sama (`stationHello` → int.devicePrinter). Tisk z Shanonu (`queueStationPrint`)
 * = právo číst doklad; tiskárnu vybírají pravidla Správy tisku (`resolvePrintTarget`).
 */
import "server-only";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { newPairCode, stationSha } from "./station-codes";
import { stationSetupExe, stationSetupScript } from "./station-installer";
import { publicUrl } from "./system-mail";
import type { RecordData } from "@/core/module";
import { UserError, type DataApi } from "@/core/module";
import { PAPERS, type PrintLayout } from "@/core/print";
import { prisma, withTenant } from "./db";
import { companyModules } from "./modules";
import { inTenant, type Ctx } from "./data";
import { findPrintable, printJob } from "./print";
import { renderPdf } from "./print-pdf";
import { onStationWake, wakeStation } from "./station-wake";
import { defaultPrintRules, devicePaperRoll, guessPaper, resolvePrintTarget } from "@/modules/int/print-rules";
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
  const host = info.host ? String(info.host).slice(0, 120) : null;
  // přeinstalace počítače, který už v Shanonu je (nové zařízení z Nastavení, stejný název počítače):
  // spárovat původní zařízení – zůstanou jeho tiskárny, pravidla tisku i pokladna; nové se smaže
  const same = dev.autoName && host
    ? await inTenant(ctx, async (s) => (await s.sys().api().find("int.device", { active: true }, { take: 500 })).find((d) => d.id !== dev.id && String(d.hostName ?? "").toLowerCase() === host.toLowerCase()) ?? null)
    : null;
  if (same) {
    await inTenant(ctx, async (s) => {
      const api = s.sys().api();
      await api.update("int.device", String(same.id), {
        tokenHash: sha(token),
        pairHash: null,
        pairExpires: null,
        paired: true,
        hostName: host,
        agentVersion: info.version ? String(info.version).slice(0, 40) : null,
        lastSeenAt: new Date().toISOString(),
        ...(same.userId ? {} : { userId: dev.userId ?? null }),
      });
      await api.remove("int.device", String(dev.id)).catch(() => api.update("int.device", String(dev.id), { active: false, pairHash: null, pairExpires: null }));
    });
    return { token, deviceId: String(same.id), name: String(same.name ?? host) };
  }
  await inTenant(ctx, async (s) => {
    const api = s.sys().api();
    // založeno z Nastavení: kód a název podle počítače (kód jen když je volný)
    const named: RecordData = {};
    if (dev.autoName && host) {
      named.name = host;
      named.autoName = false;
      const code = host.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 20);
      if (code && !(await api.find("int.device", { code }, { take: 1 })).length) named.code = code;
    }
    await api.update("int.device", dev.id, {
      ...named,
      tokenHash: sha(token),
      pairHash: null,
      pairExpires: null,
      paired: true,
      hostName: host,
      agentVersion: info.version ? String(info.version).slice(0, 40) : null,
      lastSeenAt: new Date().toISOString(),
    });
  });
  return { token, deviceId: dev.id, name: dev.autoName && host ? host : dev.name };
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

/** virtuální tiskárny Windows (PDF, XPS, OneNote, fax) se mezi tiskárny zařízení nezapisují */
/** tiskárny, které nejsou skutečné (tisk do souboru, sdílení, záznam obrazovky) – do Shanonu se nehlásí */
const VIRTUAL = /fax|onenote|xps|pdf|send to|odeslat do|snagit|anydesk|teamviewer|evernote|webex|zoom|foxit|nitro|doro|bullzip|cutepdf/i;

/** Stanice hlásí počítač, verzi a tiskárny Windows — nové tiskárny se zapíší k zařízení (papír odhadem z názvu). */
const STATES = new Set(["ready", "printing", "offline", "noPaper", "lowPaper", "jammed", "doorOpen", "toner", "error", "unknown"]);

export async function stationHello(st: Station, info: { host?: string; version?: string; printers?: { name: string; default?: boolean; state?: string; queued?: number }[] }) {
  const found = (info.printers ?? [])
    .filter((p) => p && typeof p.name === "string" && p.name.trim() && !VIRTUAL.test(p.name))
    .slice(0, 50)
    .map((p) => ({ name: p.name.trim().slice(0, 200), isDefault: !!p.default, state: STATES.has(String(p.state)) ? String(p.state) : null, queued: Number.isFinite(Number(p.queued)) ? Math.max(0, Math.min(9999, Math.round(Number(p.queued)))) : null }));
  const now = new Date().toISOString();
  await inTenant(st.ctx, async (s) => {
    const api = s.sys().api();
    const dev = await api.update("int.device", st.deviceId, {
      hostName: info.host ? String(info.host).slice(0, 120) : null,
      agentVersion: info.version ? String(info.version).slice(0, 40) : null,
      lastSeenAt: new Date().toISOString(),
      helloWanted: false,
    });
    const known = await api.find("int.devicePrinter", { deviceId: st.deviceId }, { take: 200 });
    for (const f of found) {
      const k = known.find((x) => x.printerName === f.name);
      if (!k)
        await api.create("int.devicePrinter", {
          deviceId: st.deviceId,
          label: `${dev.code} · ${f.name}`.slice(0, 120),
          printerName: f.name,
          paper: guessPaper(f.name),
          copies: 1,
          isDefault: f.isDefault,
          present: true,
          ...(f.state ? { state: f.state, queued: f.queued, stateAt: now } : {}),
        });
      else if (k.isDefault !== f.isDefault || !k.present || f.state)
        await api.update("int.devicePrinter", String(k.id), { isDefault: f.isDefault, present: true, ...(f.state ? { state: f.state, queued: f.queued, stateAt: now } : {}) });
    }
    for (const k of known) if (k.present && !found.some((f) => f.name === k.printerName)) await api.update("int.devicePrinter", String(k.id), { present: false, isDefault: false, state: "offline", stateAt: now });
    // první hlášení tiskáren: výchozí pravidla tisku pro tento počítač
    if (!known.length && found.length) await defaultPrintRules(api, st.deviceId);
  });
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
    const printers = await api.find("int.devicePrinter", { id: { in: [...new Set(due.map((j) => String(j.printerId)))] } }, { take: 50 });
    const now = new Date().toISOString();
    for (const j of due) await api.update("int.printJob", String(j.id), { status: "sent", sentAt: now });
    return due.map((j) => {
      const c = printers.find((x) => x.id === j.printerId);
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
    // Shanon chce hlášení tiskáren (Diagnostika → Obnovit stav): odpovědět hned, stanice ho pošle
    if (jobs.length || left <= 0 || (await helloWanted(st))) return jobs;
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
    // zrušená úloha: stanice ji nevytiskne (PDF nedostane)
    if (!job || job.deviceId !== st.deviceId || job.status === "cancelled") throw new UserError("@SYS:NotFound");
    return { job, conn: await api.get("int.devicePrinter", String(job.printerId)), dev: await api.get("int.device", st.deviceId) };
  });
  const copies = Number(job.copies) || 1;
  if (!job.docType || !job.recordId) {
    const layout = testPageLayout(String(conn?.paper ?? "a4"));
    const printer = String(conn?.printerName ?? ""), device = String(dev?.name ?? "");
    const t = (k: string, params: Record<string, string> = {}) => resolveLabel(labelTable, k, st.ctx.lang ?? "cs").replace(/\{(\w+)\}/g, (m, n: string) => params[n] ?? m);
    const data = { test: { title: t("@INT:StationTestTitle"), text: t("@INT:StationTestText", { printer, device }), printer, at: new Date().toLocaleString("cs-CZ", { timeZone: "Europe/Prague" }) } };
    return { pdf: await renderPdf(layout, data), settings: printSettings(layout, copies), name: "zkouska" };
  }
  const docType = String(job.docType);
  // tisk za stanici = číst jen tento druh dokladu (datová služba hlídá firmu a RLS)
  const ctx: Ctx = { ...st.ctx, perms: { admin: false, levels: { [docType]: "read" } } };
  // papír tiskárny, na kterou úloha jde (role účtenky, A6); A4 tiskárna = výchozí rozvržení dokladu
  const pj = await printJob(ctx, docType, String(job.recordId), job.templateId ? String(job.templateId) : null, undefined, devicePaperRoll(conn?.paper));
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
    if (job.status === "cancelled") return; // zrušená mezitím – výsledek nepřepíše stav
    await api.update("int.printJob", jobId, {
      status: ok ? "done" : "error",
      doneAt: ok ? new Date().toISOString() : null,
      message: message ? String(message).slice(0, 250) : null,
    });
  });
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
    // bez zástupce Shanon Pokladna (běžný prohlížeč): počítač, na kterém uživatel pracuje
    const stationId = opts.stationId ?? (await userStation(api, ctx.userId));
    const target = await resolvePrintTarget(api, docType, { recordId: ids[0], stationId, userId: ctx.userId });
    if (!target) return null;
    const conn = target.printer;
    for (const r of recs)
      await api.create("int.printJob", {
        deviceId: conn.deviceId,
        printerId: conn.id,
        docType,
        recordId: r.id,
        templateId: opts.templateId || null,
        reference: String(r[p.numberField] ?? ""),
        copies: Number(conn.copies) || 1,
        status: "queued",
      });
    const dev = target.device;
    const seen = dev.lastSeenAt ? new Date(String(dev.lastSeenAt)).getTime() : 0;
    return { deviceId: String(conn.deviceId), printer: String(conn.label), device: String(dev.name ?? ""), online: Date.now() - seen < ONLINE_MS };
  });
  if (!out) return null;
  wakeStation(out.deviceId);
  return { printer: out.printer, device: out.device, online: out.online };
}

/**
 * Nastavení → „Nainstalovat na tento počítač“: instalátor pro zařízení tohoto počítače (zná ho zástupce
 * Shanon Pokladna), jinak nové zařízení pojmenované při spárování podle názvu počítače. Právo = zápis zařízení.
 */
export async function stationSetup(ctx: Ctx, deviceId: string | null): Promise<{ href: string; deviceId: string }> {
  const { code, dev } = await inTenant(ctx, async (s) => {
    const api = s.sys().api();
    let dev = deviceId ? await api.get("int.device", deviceId).catch(() => null) : null;
    if (dev && !dev.active) dev = null;
    if (!dev) {
      const used = new Set((await api.find("int.device", {}, { take: 1000 })).map((d) => String(d.code)));
      let n = 1;
      while (used.has(`PC${n}`)) n++;
      dev = await api.create("int.device", { code: `PC${n}`, name: resolveLabel(labelTable, "@INT:DeviceSetupName", ctx.lang ?? "cs"), autoName: true, active: true, userId: ctx.userId });
    } else if (!dev.userId) await api.update("int.device", String(dev.id), { userId: ctx.userId });
    const pc = newPairCode(ctx.tenantId);
    await api.update("int.device", String(dev.id), { pairHash: pc.hash, pairExpires: pc.expires.toISOString() });
    return { code: pc.code, dev };
  });
  return { href: installerHref(code), deviceId: String(dev.id) };
}

/**
 * Počítač pro tisk bez zástupce Shanon Pokladna (běžný prohlížeč, jiný profil): jediné aktivní zařízení,
 * jehož uživatelem je přihlášený (doplní instalace nebo výběr v Nastavení). Víc počítačů = nevíme → null.
 */
async function userStation(api: DataApi, userId: string): Promise<string | null> {
  // pole typu uživatel filtruje datová služba podle jména / e-mailu – zařízení firmy je pár, porovnat v paměti
  const devs = (await api.find("int.device", { active: true }, { take: 500 })).filter((d) => d.userId === userId);
  return devs.length === 1 ? String(devs[0].id) : null;
}

/** Nastavení → Tento prohlížeč tiskne přes: zařízení (aktivní, spárovaná) pro výběr. */
export async function stationChoices(ctx: Ctx): Promise<{ id: string; label: string; mine: boolean }[]> {
  return inTenant(ctx, async (s) => {
    const devs = await s.sys().api().find("int.device", { active: true, paired: true }, { take: 100, orderBy: { code: "asc" } });
    return devs.map((d) => ({ id: String(d.id), label: [d.name, d.hostName && d.hostName !== d.name ? d.hostName : null].filter(Boolean).join(" · ") || String(d.code), mine: d.userId === ctx.userId }));
  });
}

/** Výběr počítače v Nastavení: zařízení dostane uživatele (když ho ještě nemá) – tisk ho pak pozná i jinde. */
export async function stationClaim(ctx: Ctx, deviceId: string): Promise<void> {
  await inTenant(ctx, async (s) => {
    const api = s.sys().api();
    const dev = await api.get("int.device", deviceId);
    if (!dev || !dev.active) throw new UserError("@SYS:NotFound");
    if (!dev.userId) await api.update("int.device", deviceId, { userId: ctx.userId });
  });
}

/** odkaz na instalátor: v adrese je párovací kód — instalátor si ho po stažení přečte ze záznamu Windows o původu */
export const installerHref = (code: string) => `/api/station/installer/${code}`;

/** Instalátor / instalační skript pro platný párovací kód (jinak null = odkaz neplatí). */
export async function stationInstallerFile(code: string, part: "exe" | "script"): Promise<Buffer | null> {
  const m = /^shp\.([0-9a-f-]{36})\.[A-Za-z0-9_-]{20,}$/.exec(code);
  if (!m) return null;
  const dev = await withTenant(m[1], (tx) => tx.intDevice.findFirst({ where: { tenantId: m[1], pairHash: sha(code), active: true } }));
  if (!dev?.pairExpires || dev.pairExpires.getTime() < Date.now()) return null;
  return part === "exe" ? stationSetupExe() : stationSetupScript({ url: publicUrl(), code });
}

export interface StationDiagnostics {
  /** podle čeho Shanon počítač pozná: zapamatovaný v prohlížeči, uživatel počítače, nepozná */
  source: "browser" | "user" | "none";
  /** zapamatovaný počítač prohlížeče v Shanonu není (smazané / neaktivní zařízení) */
  staleBrowser: boolean;
  /** kolik aktivních počítačů má uživatel jako Uživatel počítače */
  userDevices: number;
  device: { id: string; name: string; code: string; hostName: string; paired: boolean; online: boolean; lastSeenAt: string | null; version: string } | null;
  printers: { id: string; label: string; printerName: string; paper: string; isDefault: boolean; present: boolean; state: string | null; stateLabel: string; queued: number | null; stateAt: string | null }[];
  /** verze programu stanice v Shanonu (stanice starší než tahle se aktualizuje sama, 1.0.0 jen přeinstalací) */
  agentVersion: string;
  /** kam by teď šel tisk z tohoto prohlížeče */
  receipt: string | null;
  documents: string | null;
}

/** Nastavení → Diagnostika tohoto počítače: pozná Shanon prohlížeč, běží stanice, jaké tiskárny, kam se tiskne. */
export async function stationDiagnostics(ctx: Ctx, browserStationId: string | null): Promise<StationDiagnostics> {
  return inTenant(ctx, async (s) => {
    const api = s.sys().api();
    const active = await api.find("int.device", { active: true }, { take: 500 });
    const mine = active.filter((d) => d.userId === ctx.userId);
    const fromBrowser = browserStationId ? active.find((d) => d.id === browserStationId) : undefined;
    const dev = fromBrowser ?? (mine.length === 1 ? mine[0] : undefined);
    const source = fromBrowser ? "browser" : dev ? "user" : "none";
    const printers = dev ? await api.find("int.devicePrinter", { deviceId: dev.id }, { take: 100, orderBy: { label: "asc" } }) : [];
    const target = async (docType: string) => {
      const t = await resolvePrintTarget(api, docType, { stationId: dev ? String(dev.id) : null, userId: ctx.userId }).catch(() => null);
      return t ? `${t.printer.label} · ${t.device.name}` : null;
    };
    const seen = dev?.lastSeenAt ? new Date(String(dev.lastSeenAt)).getTime() : 0;
    return {
      source,
      staleBrowser: !!browserStationId && !fromBrowser,
      userDevices: mine.length,
      device: dev
        ? {
            id: String(dev.id),
            name: String(dev.name ?? ""),
            code: String(dev.code ?? ""),
            hostName: String(dev.hostName ?? ""),
            paired: !!dev.paired,
            online: !!seen && Date.now() - seen < ONLINE_MS,
            lastSeenAt: dev.lastSeenAt ? new Date(String(dev.lastSeenAt)).toISOString() : null,
            version: String(dev.agentVersion ?? ""),
          }
        : null,
      printers: printers.map((x) => ({
        id: String(x.id),
        label: String(x.label ?? x.printerName),
        printerName: String(x.printerName ?? ""),
        paper: String(x.paper ?? "a4"),
        isDefault: !!x.isDefault,
        present: x.present !== false,
        state: x.state ? String(x.state) : null,
        stateLabel: x.state ? resolveLabel(labelTable, `@INT:PS${String(x.state)[0].toUpperCase()}${String(x.state).slice(1)}`, ctx.lang ?? "cs") : "",
        queued: x.queued === null || x.queued === undefined ? null : Number(x.queued),
        stateAt: x.stateAt ? new Date(String(x.stateAt)).toISOString() : null,
      })),
      agentVersion: stationAgentVersion(),
      receipt: await target("pos.receipt"),
      // ostatní doklady: pravidlo „*“ (vzorový doklad bez vlastního pravidla)
      documents: await target("ar.invoice"),
    };
  });
}

/** Žádá Shanon od stanice nové hlášení tiskáren? (odpověď na dotaz úloh nese `hello: true`) */
export async function helloWanted(st: Station): Promise<boolean> {
  return inTenant(st.ctx, async (s) => !!(await s.sys().api().get("int.device", st.deviceId))?.helloWanted);
}

/** Diagnostika → Obnovit stav: stanice hned pošle tiskárny a jejich stav (stanice 1.1+). */
export async function stationRefresh(ctx: Ctx, deviceId: string): Promise<void> {
  await inTenant(ctx, async (s) => {
    const api = s.sys().api();
    if (!(await api.get("int.device", deviceId))) throw new UserError("@SYS:NotFound");
    await api.update("int.device", deviceId, { helloWanted: true });
  });
  wakeStation(deviceId, 200);
}

/** Verze programu stanice v Shanonu (z src/station/stanice.ps1) – starší stanice se samy aktualizují. */
export function stationAgentVersion(): string {
  try {
    const src = readFileSync(join(process.cwd(), "src", "station", "stanice.ps1"), "utf8");
    return /\$Version = '([^']+)'/.exec(src)?.[1] ?? "";
  } catch {
    return "";
  }
}

/** Program stanice pro samoaktualizaci (UTF-8 s BOM, CRLF – jako při instalaci, bez párovacího kódu). */
export function stationAgentFile(): Buffer {
  const src = readFileSync(join(process.cwd(), "src", "station", "stanice.ps1"), "utf8").replace(/\r?\n/g, "\r\n");
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(src, "utf8")]);
}
