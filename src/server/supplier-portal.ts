/**
 * Dodavatelský portál — veřejná část (bez přihlášení).
 *
 * Odkaz /portal/<tenant>/<klíč> → nastavení `int.portal` (zapnuté, klíč sedí). Soubory se po kontrole
 * (druh podle obsahu, velikost, počet, limity za hodinu z adresy a za den) uloží jako Doklady ke
 * zpracování (`int.document`, zdroj portál) s přílohou v úložišti tenanta. Vytěžení dělá dávka
 * (Vytěžit automaticky), zalistování vždy schvaluje člověk. Každý pokus jde do protokolu.
 */
import "server-only";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { UserError, type RecordData } from "@/core/module";
import { ADMIN } from "@/core/security";
import { dependencyClosure } from "@/core/module";
import { registry } from "@/registry";
import { notify } from "@/modules/sys/notify";
import { sniffPortalFile, PORTAL_CAPS } from "@/modules/int/portal";
import { prisma, withTenant } from "./db";
import { inTenant, type Ctx } from "./data";
import { addFile } from "./docuref";
import { getT } from "./i18n";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

export type PortalKind = "invoice" | "advance" | "order" | "other";
const TARGET: Record<PortalKind, string> = { invoice: "apInvoice", advance: "apAdvance", order: "apOrder", other: "auto" };

export interface PortalInfo {
  companyName: string;
  title: string;
  intro: string;
  kinds: { value: PortalKind; label: string }[];
  requireRegNo: boolean;
  maxFileMb: number;
  maxFiles: number;
}

interface Loaded {
  ctx: Ctx;
  portal: RecordData;
  companyName: string;
}

async function load(tenantId: string, token: string, client: PrismaClient): Promise<Loaded | null> {
  if (!UUID.test(tenantId) || !TOKEN.test(token)) return null;
  const tenant = await client.sysTenant.findUnique({ where: { id: tenantId }, include: { modules: true, users: { where: { role: "admin" }, take: 1 } } });
  if (!tenant || !tenant.modules.some((m) => m.moduleId === "int")) return null;
  const found = await withTenant(
    tenantId,
    async (tx) => {
      const p = await (tx as unknown as { intPortal: { findFirst(a: unknown): Promise<Record<string, unknown> | null> } }).intPortal.findFirst({ where: { tenantId, token, active: true } });
      if (!p) return null;
      const c = await tx.sysCompany.findFirst({ where: { id: String(p.companyId), tenantId } });
      return c ? { p, company: c } : null;
    },
    client,
  );
  if (!found) return null;
  const modules = new Set([...dependencyClosure(registry, ["sys", ...tenant.modules.map((m) => m.moduleId)])].filter((x) => registry.modules.has(x)));
  const ctx: Ctx = {
    tenantId,
    companyId: String(found.p.companyId),
    userId: String(found.p.createdBy ?? tenant.users[0]?.id ?? tenantId),
    userName: "Dodavatelský portál",
    role: "admin",
    perms: ADMIN,
    modules,
    extensions: new Set(),
    lang: "cs",
  };
  const portal = await inTenant(ctx, (s) => s.sys().api().get("int.portal", String(found.p.id)), client);
  return portal ? { ctx, portal, companyName: found.company.name } : null;
}

const kindsOf = (p: RecordData): PortalKind[] =>
  (["invoice", "advance", "order", "other"] as const).filter((k) => p[`allow${k[0].toUpperCase()}${k.slice(1)}`] !== false);

/** Údaje pro veřejnou stránku (null = odkaz neplatí). */
export async function portalInfo(tenantId: string, token: string, client: PrismaClient = prisma): Promise<PortalInfo | null> {
  const l = await load(tenantId, token, client);
  if (!l) return null;
  const t = await getT("cs", tenantId);
  const labels: Record<PortalKind, string> = { invoice: t("@AP:Invoice"), advance: t("@AP:Advance"), order: t("@AP:Order"), other: t("@INT:OtherDoc") };
  return {
    companyName: l.companyName,
    title: String(l.portal.title ?? "") || l.companyName,
    intro: String(l.portal.intro ?? ""),
    kinds: kindsOf(l.portal).map((value) => ({ value, label: labels[value] })),
    requireRegNo: l.portal.requireRegNo !== false,
    maxFileMb: Math.min(PORTAL_CAPS.maxFileMb, Number(l.portal.maxFileMb ?? 10)),
    maxFiles: Math.min(PORTAL_CAPS.maxFiles, Number(l.portal.maxFiles ?? 5)),
  };
}

export interface PortalInput {
  kind: string;
  regNo: string;
  name: string;
  email: string;
  note: string;
  files: { name: string; type: string; data: Buffer }[];
}
export interface PortalResult {
  ok: boolean;
  error?: string;
  files: { name: string; ok: boolean; docNum?: string; error?: string }[];
}

/** Přijetí dokladů z veřejné stránky. `ip` slouží jen k limitu (ukládá se otisk, ne adresa). */
export async function portalSubmit(tenantId: string, token: string, input: PortalInput, ip: string, client: PrismaClient = prisma): Promise<PortalResult | null> {
  const l = await load(tenantId, token, client);
  if (!l) return null;
  const t = await getT("cs", tenantId);
  const p = l.portal;
  const ipHash = createHash("sha256").update(`${tenantId}|${ip}`).digest("hex").slice(0, 32);
  const maxMb = Math.min(PORTAL_CAPS.maxFileMb, Number(p.maxFileMb ?? 10));
  const maxFiles = Math.min(PORTAL_CAPS.maxFiles, Number(p.maxFiles ?? 5));
  const name = input.name.trim().slice(0, 120);
  const regNo = input.regNo.replace(/\s/g, "").slice(0, 20);
  const email = input.email.trim().slice(0, 254);
  const note = input.note.trim().slice(0, 255);
  const kind = input.kind as PortalKind;

  return inTenant(
    l.ctx,
    async (s) => {
      const api = s.sys().api();
      const log = (status: "accepted" | "rejected", reason: string | null, file?: { name: string; size: number }, documentId?: string) =>
        api.create("int.portalUpload", {
          portalId: p.id,
          at: new Date().toISOString(),
          status,
          reason: reason?.slice(0, 255) ?? null,
          fileName: file?.name.slice(0, 255) ?? null,
          size: file?.size ?? null,
          ipHash,
          senderName: name || null,
          senderRegNo: regNo || null,
          documentId: documentId ?? null,
        });
      const reject = async (msg: string): Promise<PortalResult> => {
        await log("rejected", msg);
        return { ok: false, error: msg, files: [] };
      };

      // limity: pokusy z adresy za hodinu, přijaté doklady za den
      const hourAgo = new Date(Date.now() - 3600_000).toISOString();
      const dayAgo = new Date(Date.now() - 86400_000).toISOString();
      const fromIp = (await api.find("int.portalUpload", { portalId: p.id, ipHash, at: { gte: hourAgo } }, { take: 1000 })).length;
      if (fromIp >= Number(p.ipHourLimit ?? 10)) return { ok: false, error: t("@INT:PortalErrIpLimit"), files: [] }; // bez zápisu — zahlcení by plnilo protokol
      const today = (await api.find("int.portalUpload", { portalId: p.id, status: "accepted", at: { gte: dayAgo } }, { take: 5000 })).length;
      if (today + input.files.length > Number(p.dailyLimit ?? 100)) return reject(t("@INT:PortalErrDaily"));

      // údaje odesílatele
      if (!kindsOf(p).includes(kind)) return reject(t("@INT:PortalErrKind"));
      if (!name) return reject(t("@INT:PortalErrName"));
      if ((p.requireRegNo !== false || regNo) && !/^\d{8}$/.test(regNo)) return reject(t("@INT:PortalErrRegNo"));
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reject(t("@INT:PortalErrEmail"));
      if (!input.files.length) return reject(t("@SYS:Required"));
      if (input.files.length > maxFiles) return reject(t("@INT:PortalErrCount", { max: String(maxFiles) }));

      const out: PortalResult["files"] = [];
      for (const f of input.files) {
        const fname = f.name.replace(/[\\/]/g, "_").slice(0, 200) || "doklad";
        if (f.data.length > maxMb * 1024 * 1024) {
          const e = t("@INT:PortalErrSize", { max: String(maxMb) });
          await log("rejected", e, { name: fname, size: f.data.length });
          out.push({ name: fname, ok: false, error: e });
          continue;
        }
        const sniff = sniffPortalFile(fname, f.data);
        if (!sniff) {
          const e = t("@INT:PortalErrType");
          await log("rejected", e, { name: fname, size: f.data.length });
          out.push({ name: fname, ok: false, error: e });
          continue;
        }
        const doc = await api.create("int.document", {
          fileName: fname,
          target: TARGET[kind],
          source: "portal",
          portalId: p.id,
          senderName: name,
          senderRegNo: regNo || null,
          senderEmail: email || null,
          senderNote: note || null,
          // údaje od odesílatele jako výchozí; vytěžení je upřesní
          partnerName: name,
          regNo: /^\d{8}$/.test(regNo) ? regNo : null,
        });
        out.push({ name: fname, ok: true, docNum: String(doc.docNum ?? "") });
        await log("accepted", null, { name: fname, size: f.data.length }, String(doc.id));
        (f as { docId?: string }).docId = String(doc.id);
      }
      const accepted = out.filter((x) => x.ok).length;
      if (accepted)
        await notify(api, { kind: "info", title: "@INT:NotifyPortal", params: { name, count: String(accepted) }, href: "/int/document?filter.source=portal", key: `portal-${p.id}-${Date.now()}` });
      return { ok: accepted > 0, error: accepted ? undefined : out[0]?.error, files: out };
    },
    client,
  ).then(async (res) => {
    // soubory do úložiště mimo hlavní transakci (velké soubory, vlastní transakce úložiště)
    for (const f of input.files as ({ docId?: string } & PortalInput["files"][number])[]) {
      if (!f.docId) continue;
      try {
        await addFile(l.ctx, "int.document", f.docId, { name: f.name.replace(/[\\/]/g, "_").slice(0, 200), type: f.type || "application/octet-stream", data: f.data }, client);
      } catch (e) {
        if (!(e instanceof UserError)) throw e;
      }
    }
    return res;
  });
}
