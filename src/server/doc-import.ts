/**
 * Vytěžování dokladů — orchestrace mimo databázovou transakci.
 *
 * Volání OpenAI trvá desítky sekund, transakce smí trvat nejvýš 20 s, proto
 * po krocích: (1) transakce: doklad, napojení, limit, soubor → Zpracovává se;
 * (2) síť bez transakce; (3) transakce: výsledek do mezitabulky + kontrola,
 * zápis do int.log. Chyba → stav Chyba s hláškou (a záznam v int.log).
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { UserError, type RecordData } from "@/core/module";
import { applyExtraction, listDocument } from "@/modules/int/documents";
import { writeLog } from "@/modules/int/drivers";
import { extractWithOpenAi } from "@/modules/int/ocr";
import { addFile, readFile } from "./docuref";
import { ADMIN } from "@/core/security";
import { inTenant, type Ctx } from "./data";

/** Zpracovávaný doklad, který visí déle než 10 minut (pád serveru), jde zpracovat znovu. */
const STALE_MS = 10 * 60_000;

async function pickConnection(ctx: Ctx, client?: PrismaClient) {
  return inTenant(
    ctx,
    async (s) => {
      const api = s.sys().api();
      const conns = (await api.find("int.connection", { kind: "ocr", active: true }, { take: 20 })).sort((a, b) => String(a.code).localeCompare(String(b.code)));
      if (!conns.length) throw new UserError("@INT:OcrNoConnection");
      // první s volným denním limitem
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      for (const c of conns) {
        const used = await s.tx.intLog.count({ where: { tenantId: ctx.tenantId, companyId: ctx.companyId!, connectionId: String(c.id), operation: "ocr.extract", createdAt: { gte: since } } });
        if (used < Number(c.dailyLimit ?? 50)) return c;
      }
      const c = conns[0];
      throw new UserError("@INT:OcrDailyLimit", { code: String(c.code), limit: String(c.dailyLimit ?? 50) });
    },
    client,
  );
}

/** Vytěžit jeden doklad (akce Vytěžit, nahrání, dávka). */
export async function extractDocument(ctx: Ctx, id: string, client?: PrismaClient): Promise<RecordData> {
  // (1) připravit
  const prep = await inTenant(
    ctx,
    async (s) => {
      const api = s.sys().api();
      const doc = await api.get("int.document", id);
      if (!doc) throw new UserError("@SYS:NotFound");
      if (doc.status === "listed" || doc.status === "rejected") throw new UserError("@SYS:Locked");
      if (doc.status === "processing" && Date.now() - new Date(String(doc.updatedAt)).getTime() < STALE_MS) throw new UserError("@SYS:Conflict");
      const ref = await s.tx.sysDocuRef.findFirst({ where: { tenantId: ctx.tenantId, objectId: "int.document", recordId: id, kind: "file" }, orderBy: { createdAt: "asc" } });
      if (!ref) throw new UserError("@INT:OcrNoFile");
      const company = ctx.companyId ? await api.get("sys.company", ctx.companyId) : null;
      return { ref: ref.id, company };
    },
    client,
  );
  const conn = await pickConnection(ctx, client);
  await inTenant(ctx, (s) => s.sys().api().update("int.document", id, { status: "processing", connectionId: conn.id, message: null }), client);
  const file = await readFile({ ...ctx, perms: ADMIN }, prep.ref, client);
  const c = prep.company;
  const context = `Naše firma (příjemce nákupních a vystavitel prodejních dokladů): ${c?.name ?? "?"}, IČO ${c?.regNo ?? "-"}, DIČ ${c?.vatId ?? "-"}.`;

  // (2) síť
  try {
    const r = await extractWithOpenAi(conn, { name: file.name, mime: file.mime, data: file.data }, context);
    // (3) výsledek
    return await inTenant(
      ctx,
      async (s) => {
        const api = s.sys().api();
        await writeLog(api, conn, "ocr.extract", "ok", { reference: file.name, externalId: r.responseId, message: `${r.result.docType} ${r.result.docNumber ?? ""}`.trim(), detail: `tokens in ${r.inTokens} / out ${r.outTokens}` });
        const doc = (await api.get("int.document", id))!;
        return applyExtraction(api, doc, r.result, c, s.sys().eventCtx("int.document").t);
      },
      client,
    );
  } catch (e) {
    await inTenant(
      ctx,
      async (s) => {
        const api = s.sys().api();
        const t = s.sys().eventCtx("int.document").t;
        const msg = e instanceof UserError ? t(e.label, e.params) : e instanceof Error ? e.message : String(e);
        await writeLog(api, conn, "ocr.extract", "error", { reference: file.name, message: msg });
        await api.update("int.document", id, { status: "error", message: msg.slice(0, 255) });
      },
      client,
    );
    throw e;
  }
}

/** Zalistovat doklad do agendy a přiložit k výsledku původní soubor. */
export async function listDocumentWithFile(ctx: Ctx, id: string, client?: PrismaClient): Promise<{ object: string; id: string; title: string }> {
  const res = await inTenant(
    ctx,
    async (s) => {
      const api = s.sys().api();
      const doc = await api.get("int.document", id);
      if (!doc) throw new UserError("@SYS:NotFound");
      return listDocument(api, doc, s.sys().eventCtx("int.document").t);
    },
    client,
  );
  const refs = await inTenant(ctx, (s) => s.tx.sysDocuRef.findMany({ where: { tenantId: ctx.tenantId, objectId: "int.document", recordId: id, kind: "file" } }), client);
  const sysCtx = { ...ctx, perms: ADMIN };
  for (const r of refs) {
    const f = await readFile(sysCtx, r.id, client);
    await addFile(sysCtx, res.object, res.id, { name: f.name, type: f.mime, data: f.data }, client);
  }
  return res;
}

/** Dávka: vytěžit nové doklady, připravené zalistovat (má-li napojení Zalistovat automaticky). */
export async function processPendingDocuments(ctx: Ctx, client?: PrismaClient): Promise<string> {
  const ids = await inTenant(ctx, async (s) => (await s.sys().api().find("int.document", { status: "new" }, { take: 20, orderBy: { docNum: "asc" } })).map((d) => String(d.id)), client);
  let done = 0;
  let failed = 0;
  let listed = 0;
  for (const id of ids) {
    try {
      const doc = await extractDocument(ctx, id, client);
      done++;
      const conn = doc.connectionId ? await inTenant(ctx, (s) => s.sys().api().get("int.connection", String(doc.connectionId)), client) : null;
      if (doc.status === "ready" && conn?.autoList) {
        await listDocumentWithFile(ctx, id, client);
        listed++;
      }
    } catch (e) {
      failed++;
      // vyčerpaný limit / chybějící napojení: dál nepokračovat
      const label = (e as UserError).label;
      if (label === "@INT:OcrDailyLimit" || label === "@INT:OcrNoConnection") break;
    }
  }
  return inTenant(ctx, async (s) => s.sys().eventCtx("int.document").t("@INT:DocsProcessed", { done: String(done), failed: String(failed), listed: String(listed) }), client);
}
