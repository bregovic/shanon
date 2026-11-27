/**
 * Epson Server Direct Print (tiskárna TM se sama ptá Shanonu): kasa / seznam účtenek uloží data ESC/POS do fronty
 * `int.netPrintJob` napojení (ovladač escposSdp); tiskárna každých pár vteřin pošle POST na tajnou adresu
 * `/api/station/sdp/sdp.<tenantId>.<náhodný>` (v DB jen otisk `int.connection.sdpHash`):
 *   ConnectionType=GetRequest  → PrintRequestInfo s čekajícími úlohami (ePOS-Print <command> v hex), nic = prázdná odpověď
 *   ConnectionType=SetResponse → ResponseFile s výsledkem každé úlohy (printjobid, success, code)
 * Žádné spojení prohlížeč → tiskárna: bez certifikátu tiskárny a povolení místní sítě v Chrome.
 */
import "server-only";
import { prisma, withTenant } from "./db";
import { companyModules } from "./modules";
import { inTenant, type Ctx } from "./data";
import { stationSha } from "./station-codes";
import { labelTable } from "@/registry";
import { resolveLabel } from "@/core/labels";
import type { DataApi, RecordData } from "@/core/module";
import { UserError } from "@/core/module";

const NS = "http://www.epson-pos.com/schemas/2011/03/epos-print";
/** odeslaná úloha bez výsledku od tiskárny → chyba (znovu se netiskne, ať nevyjde dvakrát) */
const SENT_TIMEOUT_MS = 3 * 60_000;
/** „tiskárna se ozvala“ zapisovat nejvýš jednou za minutu (dotaz chodí každých pár vteřin) */
const SEEN_EVERY_MS = 60_000;
/** největší data jedné úlohy (účtenka s logem ~20 kB) */
export const SDP_MAX_BYTES = 200_000;

/** id úlohy pro tiskárnu (printjobid: krátký alfanumerický) */
export const sdpJobKey = (id: string) => id.replace(/-/g, "").slice(0, 24);

/** Napojení podle tokenu v adrese; null = neplatný / vypnuté napojení. */
export async function sdpAuth(token: string) {
  const m = /^sdp\.([0-9a-f-]{36})\.[A-Za-z0-9_-]{20,}$/.exec(token ?? "");
  if (!m) return null;
  const tenantId = m[1];
  const conn = await withTenant(tenantId, (tx) => tx.intConnection.findFirst({ where: { tenantId, sdpHash: stationSha(token), active: true, driver: "escposSdp" } }));
  if (!conn) return null;
  const tenant = await prisma.sysTenant.findUnique({ where: { id: tenantId }, include: { modules: true } });
  if (!tenant) return null;
  const ctx: Ctx = {
    tenantId,
    companyId: conn.companyId,
    userId: conn.createdBy ?? conn.id,
    userName: `Tiskárna · ${conn.name}`,
    role: "api",
    perms: { admin: false, levels: {} },
    modules: await companyModules(tenantId, conn.companyId, tenant.modules.map((x) => x.moduleId)),
    extensions: new Set(),
    lang: "cs",
  };
  return { ctx, connectionId: conn.id, seenAt: conn.sdpSeenAt };
}

type Sdp = NonNullable<Awaited<ReturnType<typeof sdpAuth>>>;

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);

/** Tiskárna se ptá na tisk: čekající úlohy (nejstarší první) jako PrintRequestInfo, nic = "". */
export async function sdpGetRequest(sdp: Sdp): Promise<string> {
  return inTenant(sdp.ctx, async (s) => {
    const api = s.sys().api();
    const now = Date.now();
    if (!sdp.seenAt || now - new Date(sdp.seenAt).getTime() > SEEN_EVERY_MS)
      await api.update("int.connection", sdp.connectionId, { sdpSeenAt: new Date(now).toISOString() });
    // odeslané bez výsledku příliš dlouho → chyba (tiskárna je asi nevytiskla; znovu se neposílají)
    for (const j of await api.find("int.netPrintJob", { connectionId: sdp.connectionId, status: "sent" }, { take: 50 }))
      if (j.sentAt && now - new Date(String(j.sentAt)).getTime() > SENT_TIMEOUT_MS) await api.update("int.netPrintJob", String(j.id), { status: "error", message: resolveLabel(labelTable, "@INT:SdpNoResult", "cs") });
    const jobs = await api.find("int.netPrintJob", { connectionId: sdp.connectionId, status: "queued" }, { take: 5, orderBy: { createdAt: "asc" } });
    if (!jobs.length) return "";
    const parts: string[] = [];
    for (const j of jobs) {
      const hex = Buffer.from(String(j.data ?? ""), "base64").toString("hex");
      parts.push(
        `<ePOSPrint><Parameter><devid>local_printer</devid><timeout>10000</timeout><printjobid>${esc(String(j.jobKey))}</printjobid></Parameter><PrintData><epos-print xmlns="${NS}"><command>${hex}</command></epos-print></PrintData></ePOSPrint>`,
      );
      await api.update("int.netPrintJob", String(j.id), { status: "sent", sentAt: new Date(now).toISOString() });
    }
    return `<?xml version="1.0" encoding="utf-8"?><PrintRequestInfo Version="2.00">${parts.join("")}</PrintRequestInfo>`;
  });
}

/** Výsledek tisku od tiskárny (ResponseFile): úlohy Vytištěno / Chyba s kódem tiskárny. */
export async function sdpSetResponse(sdp: Sdp, xml: string): Promise<number> {
  const results = [...String(xml ?? "").matchAll(/<ePOSPrint>([\s\S]*?)<\/ePOSPrint>/g)].map((m) => ({
    key: /<printjobid>([^<]*)<\/printjobid>/.exec(m[1])?.[1] ?? "",
    ok: /<response[^>]*success="true"/.test(m[1]),
    code: /<response[^>]*code="([^"]*)"/.exec(m[1])?.[1] ?? "",
  }));
  if (!results.length) return 0;
  return inTenant(sdp.ctx, async (s) => {
    const api = s.sys().api();
    let n = 0;
    for (const r of results) {
      if (!r.key) continue;
      const [j] = await api.find("int.netPrintJob", { connectionId: sdp.connectionId, jobKey: r.key }, { take: 1 });
      if (!j) continue;
      await api.update("int.netPrintJob", String(j.id), { status: r.ok ? "done" : "error", doneAt: new Date().toISOString(), message: r.ok ? null : r.code || resolveLabel(labelTable, "@INT:SdpPrinterError", "cs") });
      n++;
    }
    return n;
  });
}

/** Úloha do fronty tiskárny (kasa, seznam účtenek, diagnostika). */
export async function queueSdpJob(api: DataApi, conn: RecordData, dataBase64: string, reference: string): Promise<RecordData> {
  if (conn.driver !== "escposSdp" || !conn.active) throw new UserError("@INT:SdpNoConn");
  const size = Math.floor((dataBase64.length * 3) / 4);
  if (!/^[A-Za-z0-9+/]+=*$/.test(dataBase64) || size > SDP_MAX_BYTES) throw new UserError("@INT:SdpBadData");
  const job = await api.create("int.netPrintJob", { connectionId: conn.id, reference: reference.slice(0, 255) || null, data: dataBase64, status: "queued" });
  await api.update("int.netPrintJob", String(job.id), { jobKey: sdpJobKey(String(job.id)) });
  return job;
}
