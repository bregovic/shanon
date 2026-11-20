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
import { applyExtraction } from "@/modules/int/documents";
import { writeLog } from "@/modules/int/drivers";
import { extractWithOpenAi } from "@/modules/int/ocr";
import { isdocFromFile, parseIsdoc } from "@/modules/prt/isdoc";
import { readFile } from "./docuref";
import { ADMIN } from "@/core/security";
import { notify } from "@/modules/sys/notify";
import { closeWorkItems, createWorkItem } from "@/modules/wf/work";
import { inTenant, type Ctx } from "./data";
import { fireWorkflowEvent } from "./workflow";

/** Zpracovávaný doklad, který visí déle než 10 minut (pád serveru), jde zpracovat znovu. */
const STALE_MS = 10 * 60_000;

async function pickConnection(ctx: Ctx, client?: PrismaClient) {
  return inTenant(
    ctx,
    async (s) => {
      const api = s.sys().api();
      // testovací napojení (TEST-OCR) má přednost; ostré bez klíče se přeskočí (jinak by zablokovalo vytěžování)
      const all = (await api.find("int.connection", { kind: "ocr", active: true }, { take: 20 })).sort(
        (a, b) => Number(!String(a.code).startsWith("TEST-")) - Number(!String(b.code).startsWith("TEST-")) || String(a.code).localeCompare(String(b.code)),
      );
      if (!all.length) throw new UserError("@INT:OcrNoConnection");
      const conns = all.filter((c) => c.driver === "openaiTest" || !!c.apiKey);
      if (!conns.length) throw new UserError("@INT:OcrNoKeyIn", { code: String(all[0].code) });
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

const fixKey = (id: string) => `int.document:${id}:fix`;

/** Úkol „vytěžení selhalo“ původci dokladu (chyba sítě / vytěžení — workflow se ještě nespustilo). */
async function failedTask(ctx: Ctx, id: string, client?: PrismaClient) {
  await inTenant(
    ctx,
    async (s) => {
      const api = s.sys().api();
      const doc = (await api.get("int.document", id))!;
      const t = s.sys().eventCtx("int.document").t;
      await createWorkItem(api, {
        kind: "fix",
        title: t("@INT:TaskFailed", { num: String(doc.docNum) }),
        description: (doc.message as string) ?? null,
        assignedTo: await s.sys().originator("int.document", doc),
        ref: { object: "int.document", id, title: [doc.docNum, doc.partnerName ?? doc.fileName].filter(Boolean).join(" · ") },
        sourceKey: fixKey(id),
      });
    },
    client,
  );
}

/**
 * Po vytěžení: událost „extracted“ spustí workflow dokladu (výchozí WF-DOKLADY: jistý doklad založí partnera
 * a zalistuje se, jinak úkol Doplnit údaje původci / vlastníkovi). Bez workflow doklad zůstane k ručnímu zpracování.
 */
async function settleDocument(ctx: Ctx, id: string, client?: PrismaClient): Promise<RecordData> {
  return inTenant(
    ctx,
    async (s) => {
      const api = s.sys().api();
      // úkoly z doby před workflow (Doplnit údaje / Zkontrolovat a zalistovat) nahradí kroky workflow
      await closeWorkItems(api, { sourceKey: fixKey(id) }, "done");
      await closeWorkItems(api, { sourceKey: `int.document:${id}:review` }, "done");
      await fireWorkflowEvent(s.sys(), "int.document", id, "extracted");
      return (await api.get("int.document", id))!;
    },
    client,
  );
}

/** Vytěžit jeden doklad (akce Vytěžit, nahrání, dávka) a předat ho workflow. */
export async function extractDocument(ctx: Ctx, id: string, client?: PrismaClient): Promise<RecordData> {
  await extractOnly(ctx, id, client).catch(async (e) => {
    // chyba vytěžení (ne zamčený / zpracovávaný doklad, ne vyčerpaný limit) → úkol původci
    const label = (e as UserError).label;
    if (!["@SYS:Locked", "@SYS:Conflict", "@SYS:NotFound", "@INT:OcrDailyLimit"].includes(label)) await failedTask(ctx, id, client).catch(() => undefined);
    throw e;
  });
  return settleDocument(ctx, id, client);
}

async function extractOnly(ctx: Ctx, id: string, client?: PrismaClient): Promise<RecordData> {
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
  const file = await readFile({ ...ctx, perms: ADMIN }, prep.ref, client);
  const c = prep.company;
  // ISDOC (.isdoc, .isdocx, PDF s vloženým ISDOC): údaje přímo z XML, bez vytěžování
  const isdoc = isdocFromFile(file.name, file.data);
  if (isdoc) {
    return inTenant(
      ctx,
      async (s) => {
        const api = s.sys().api();
        const doc = (await api.get("int.document", id))!;
        return applyExtraction(api, doc, parseIsdoc(isdoc), c, s.sys().eventCtx("int.document").t);
      },
      client,
    );
  }
  const conn = await pickConnection(ctx, client);
  await inTenant(ctx, (s) => s.sys().api().update("int.document", id, { status: "processing", connectionId: conn.id, message: null }), client);
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

/**
 * Dávka: vytěžit nové doklady a předat je workflow; vytěžené doklady bez běhu workflow (z doby před ním,
 * nebo workflow vzniklo později) mu předá taky.
 */
export async function processPendingDocuments(ctx: Ctx, client?: PrismaClient): Promise<string> {
  const ids = await inTenant(ctx, async (s) => (await s.sys().api().find("int.document", { status: "new" }, { take: 20, orderBy: { docNum: "asc" } })).map((d) => String(d.id)), client);
  let done = 0;
  let failed = 0;
  let listed = 0;
  let attention = 0;
  for (const id of ids) {
    try {
      // dodavatelský portál bez automatického vytěžení: čeká na ruční Vytěžit
      const before = await inTenant(ctx, (s) => s.sys().api().get("int.document", id), client);
      if (before?.source === "portal" && before.portalId) {
        const portal = await inTenant(ctx, (s) => s.sys().api().get("int.portal", String(before.portalId)), client);
        if (portal && portal.autoExtract === false) continue;
      }
      // vytěžení předá doklad workflow (zalistuje jistý doklad nebo založí úkol)
      const doc = await extractDocument(ctx, id, client);
      done++;
      if (doc.status === "attention") attention++;
      if (doc.status === "listed") listed++;
    } catch (e) {
      failed++;
      // vyčerpaný limit / chybějící napojení: dál nepokračovat
      const label = (e as UserError).label;
      if (label === "@INT:OcrDailyLimit" || label === "@INT:OcrNoConnection") break;
    }
  }
  // vytěžené, ale bez workflow
  const waiting = await inTenant(
    ctx,
    async (s) => {
      const api = s.sys().api();
      const docs = [...(await api.find("int.document", { status: "ready" }, { take: 50 })), ...(await api.find("int.document", { status: "attention" }, { take: 50 }))];
      if (!docs.length) return [];
      let runs: RecordData[] = [];
      try {
        runs = await api.find("wf.instance", { refObject: "int.document", refId: { in: docs.map((d) => String(d.id)) } }, { take: 1000 });
      } catch {
        return []; // Workflow vypnuté
      }
      const has = new Set(runs.map((r) => String(r.refId)));
      return docs.filter((d) => !has.has(String(d.id))).map((d) => String(d.id)).slice(0, 20);
    },
    client,
  );
  for (const id of waiting) {
    const doc = await settleDocument(ctx, id, client).catch(() => null);
    if (doc?.status === "listed") listed++;
    else if (doc?.status === "attention") attention++;
  }
  if (attention || failed)
    await inTenant(
      ctx,
      (s) =>
        notify(s.sys().api(), {
          kind: failed ? "error" : "warning",
          title: "@INT:NotifyDocs",
          params: { attention: String(attention), failed: String(failed) },
          href: "/int/document",
          key: `docs:${new Date().toISOString().slice(0, 13)}`,
          dedupeHours: 1,
        }),
      client,
    );
  return inTenant(ctx, async (s) => s.sys().eventCtx("int.document").t("@INT:DocsProcessed", { done: String(done), failed: String(failed), listed: String(listed) }), client);
}
