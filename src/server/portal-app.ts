/**
 * Aplikace Portál — agendy přihlášeného (podle firmy a druhu přístupu) a podání dokladů.
 *
 * Podání = Doklad ke zpracování (`int.document`, zdroj „app“) s přílohou, odesílatelem z ověřené identity
 * a poznámkou; účtenka zaměstnance nese `employeeId` (zalistuje se na jeho dodavatele s profilem ZAM).
 * Firmu a agendu ověřuje server vždy znovu (identita z relace, nastavení portálu firmy). Limity a protokol
 * jako u veřejného portálu (`int.portalUpload`). Vytěžení se spustí hned po přijetí (na pozadí), jinak dávka.
 */
import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { UserError, type RecordData } from "@/core/module";
import { ADMIN } from "@/core/security";
import { PORTAL_CAPS, sniffPortalFile } from "@/modules/int/portal";
import { inTenant, type Ctx } from "./data";
import { prisma } from "./db";
import { addFile } from "./docuref";
import { getT } from "./i18n";
import { companyModules } from "./modules";
import type { PortalCompany, PortalIdentity } from "./portal-auth";

/** Agenda Portálu: doklady dodavatele (podle povolených druhů portálu) a zaměstnance. */
export type PortalAgenda = "invoice" | "advance" | "order" | "other" | "receipt" | "companyDoc";
const TARGET: Record<PortalAgenda, string> = { invoice: "apInvoice", advance: "apAdvance", order: "apOrder", other: "auto", receipt: "apInvoice", companyDoc: "auto" };

export interface PortalAgendaInfo {
  id: PortalAgenda;
  label: string;
  hint: string;
}

async function companyCtx(identity: PortalIdentity, c: PortalCompany, client: PrismaClient): Promise<Ctx> {
  const tenant = await client.sysTenant.findUniqueOrThrow({ where: { id: identity.tenantId }, include: { modules: true, users: { where: { role: "admin" }, take: 1 } } });
  return {
    tenantId: identity.tenantId,
    companyId: c.companyId,
    userId: String(tenant.users[0]?.id ?? identity.tenantId),
    userName: `Portál · ${c.name || identity.login}`,
    role: "admin",
    perms: ADMIN,
    modules: await companyModules(identity.tenantId, c.companyId, tenant.modules.map((m) => m.moduleId), client),
    extensions: new Set(),
    lang: "cs",
  };
}

/** Agendy firmy pro přihlášeného (dodavatel: druhy povolené portálem; zaměstnanec: účtenka + doklad pro firmu). */
export async function portalAgendas(identity: PortalIdentity, companyId: string, client: PrismaClient = prisma): Promise<{ agendas: PortalAgendaInfo[]; maxFileMb: number; maxFiles: number } | null> {
  const c = identity.companies.find((x) => x.companyId === companyId);
  if (!c) return null;
  const ctx = await companyCtx(identity, c, client);
  const portal = await inTenant(ctx, (s) => s.sys().api().get("int.portal", c.portalId), client);
  if (!portal) return null;
  const t = await getT("cs", identity.tenantId);
  const ids: PortalAgenda[] =
    identity.kind === "employee" ? ["receipt", "companyDoc"] : (["invoice", "advance", "order", "other"] as const).filter((k) => portal[`allow${k[0].toUpperCase()}${k.slice(1)}`] !== false);
  const key = (k: string) => k[0].toUpperCase() + k.slice(1);
  return {
    agendas: ids.map((id) => ({ id, label: t(`@INT:Agenda${key(id)}`), hint: t(`@INT:Agenda${key(id)}Hint`) })),
    maxFileMb: Math.min(PORTAL_CAPS.maxFileMb, Number(portal.maxFileMb ?? 10)),
    maxFiles: Math.min(PORTAL_CAPS.maxFiles, Number(portal.maxFiles ?? 5)),
  };
}

export interface PortalSubmitResult {
  ok: boolean;
  error?: string;
  files: { name: string; ok: boolean; docNum?: string; error?: string }[];
}

/** Podání dokladů z aplikace Portál. */
export async function portalAppSubmit(
  identity: PortalIdentity,
  input: { companyId: string; agenda: string; note: string; files: { name: string; type: string; data: Buffer }[] },
  client: PrismaClient = prisma,
): Promise<PortalSubmitResult> {
  const t = await getT("cs", identity.tenantId);
  const c = identity.companies.find((x) => x.companyId === input.companyId);
  if (!c) return { ok: false, error: t("@INT:AppNoCompany"), files: [] };
  const info = await portalAgendas(identity, c.companyId, client);
  const agenda = input.agenda as PortalAgenda;
  if (!info || !info.agendas.some((a) => a.id === agenda)) return { ok: false, error: t("@INT:PortalErrKind"), files: [] };
  if (!input.files.length) return { ok: false, error: t("@SYS:Required"), files: [] };
  if (input.files.length > info.maxFiles) return { ok: false, error: t("@INT:PortalErrCount", { max: String(info.maxFiles) }), files: [] };
  const ctx = await companyCtx(identity, c, client);
  const note = input.note.trim().slice(0, 255);
  const created: { id: string; file: (typeof input.files)[number]; name: string }[] = [];

  const res = await inTenant(
    ctx,
    async (s) => {
      const api = s.sys().api();
      const portal = (await api.get("int.portal", c.portalId))!;
      const dayAgo = new Date(Date.now() - 86400_000).toISOString();
      const today = (await api.find("int.portalUpload", { portalId: portal.id, status: "accepted", at: { gte: dayAgo } }, { take: 5000 })).length;
      if (today + input.files.length > Number(portal.dailyLimit ?? 100)) return { ok: false, error: t("@INT:PortalErrDaily"), files: [] } as PortalSubmitResult;
      const log = (status: "accepted" | "rejected", reason: string | null, f: { name: string; size: number }, documentId?: string) =>
        api.create("int.portalUpload", { portalId: portal.id, at: new Date().toISOString(), status, reason, fileName: f.name.slice(0, 255), size: f.size, senderName: c.name || identity.login, documentId: documentId ?? null });
      const out: PortalSubmitResult["files"] = [];
      for (const f of input.files) {
        const fname = f.name.replace(/[\\/]/g, "_").slice(0, 200) || "doklad";
        let err: string | null = null;
        if (f.data.length > info.maxFileMb * 1024 * 1024) err = t("@INT:PortalErrSize", { max: String(info.maxFileMb) });
        else if (!sniffPortalFile(fname, f.data)) err = t("@INT:PortalErrType");
        if (err) {
          await log("rejected", err, { name: fname, size: f.data.length });
          out.push({ name: fname, ok: false, error: err });
          continue;
        }
        const doc: RecordData = await api.create("int.document", {
          fileName: fname,
          target: TARGET[agenda],
          source: "app",
          portalId: portal.id,
          senderName: (c.name || identity.login).slice(0, 120),
          senderEmail: identity.kind === "vendor" ? identity.login : c.email,
          senderNote: note || null,
          employeeId: agenda === "receipt" ? c.refId : null,
        });
        await log("accepted", null, { name: fname, size: f.data.length }, String(doc.id));
        out.push({ name: fname, ok: true, docNum: String(doc.docNum ?? "") });
        created.push({ id: String(doc.id), file: f, name: fname });
      }
      const ok = out.some((x) => x.ok);
      return { ok, error: ok ? undefined : out[0]?.error, files: out };
    },
    client,
  );
  // soubory mimo hlavní transakci; vytěžení na pozadí (odpověď nečeká na síť)
  for (const x of created) {
    try {
      await addFile(ctx, "int.document", x.id, { name: x.name, type: x.file.type || "application/octet-stream", data: x.file.data }, client);
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
    }
  }
  if (created.length) {
    const { extractDocument } = await import("./doc-import");
    void (async () => {
      for (const x of created) await extractDocument(ctx, x.id, client).catch(() => undefined);
    })();
  }
  return res;
}

/** Akce „Poslat pozvánku do Portálu“ na kartě zaměstnance / kontaktu dodavatele (síť mimo transakci). */
export async function inviteToPortal(ctx: Ctx, objectId: "hr.employee" | "int.portalContact", id: string, client: PrismaClient = prisma): Promise<void> {
  const rec = await inTenant(ctx, (s) => s.sys().api().get(objectId, id), client);
  if (!rec) throw new UserError("@SYS:NotFound");
  const { sendPortalInvite } = await import("./portal-auth");
  if (objectId === "hr.employee") {
    if (!rec.portalAccess) throw new UserError("@HR:InviteNoAccess", { num: String(rec.personalNum) });
    if (!rec.email) throw new UserError("@HR:InviteNoEmail", { num: String(rec.personalNum) });
    await sendPortalInvite(ctx.tenantId, "employee", String(rec.personalNum), ctx.userName ?? "", client);
    await inTenant(ctx, (s) => s.sys().api().update(objectId, id, { portalInvitedAt: new Date().toISOString() }), client);
  } else {
    await sendPortalInvite(ctx.tenantId, "vendor", String(rec.email), ctx.userName ?? "", client);
    await inTenant(ctx, (s) => s.sys().api().update(objectId, id, { invitedAt: new Date().toISOString() }), client);
  }
}
