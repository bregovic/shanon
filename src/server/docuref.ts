/**
 * DocuRef — poznámky a soubory k libovolnému záznamu libovolného objektu.
 * Práva se odvozují od záznamu: vidět přílohy = číst záznam, přidat či
 * smazat = upravovat záznam. Vše v transakci tenanta (RLS).
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { UserError } from "@/core/module";
import { can } from "@/core/security";
import { getObject, inTenant, setImageField, type Ctx, type Session } from "./data";
import { resolveLabel } from "@/core/labels";
import { labelTable, registry } from "@/registry";
import { defaultStorage, storageFor } from "./storage";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface DocuRefItem {
  id: string;
  /** pdf = tiskový výstup dokladu (vzniká při otevření, nikde se neukládá) */
  kind: "note" | "file" | "pdf";
  /** odkaz na soubor (pdf); jinak /api/files/<id> */
  href?: string;
  /** příloha dokladu, ze kterého záznam vznikl (jen ke čtení): „Faktura dodavatele FP26001“ */
  source?: { objectId: string; recordId: string; title: string };
  name: string;
  note: string | null;
  mime: string | null;
  size: number | null;
  createdAt: string;
  createdBy: string | null;
}

/** Ověří záznam (existuje, je v tenantovi/firmě) a právo na něj. */
async function checkRecord(ctx: Ctx, objectId: string, recordId: string, need: "read" | "write", client?: PrismaClient) {
  const def = getObject(objectId);
  if (!can(ctx.perms, def.id, need)) throw new UserError("@SYS:NoAccess");
  const rec = await inTenant(ctx, (s) => s.sys().get(objectId, recordId), client);
  if (!rec) throw new UserError("@SYS:NotFound");
}

/** Bezpečný název souboru (bez cest a řídicích znaků). */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "soubor";
  const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]/g, "_").trim();
  return (cleaned || "soubor").slice(0, 200);
}

interface Linked {
  objectId: string;
  recordId: string;
  title: string;
}

/**
 * Doklady, ze kterých záznam vznikl (obecně podle polí): `sourceObject` + `sourceId` (daňová transakce, účetní
 * doklad → faktura) a odkaz na účetní doklad (řádek hlavní knihy, položka salda → doklad → faktura). Do hloubky 3,
 * bez opakování a jen to, co uživatel smí číst. Přílohy se tak ukážou i na navázaných záznamech, uložené jednou.
 */
async function linkedSources(s: Session, ctx: Ctx, objectId: string, recordId: string): Promise<{ self: Linked | null; sources: Linked[] }> {
  const seen = new Set([`${objectId}:${recordId}`]);
  const sources: Linked[] = [];
  const title = (oid: string, rec: Record<string, unknown>) => {
    const def = getObject(oid);
    return `${resolveLabel(labelTable, def.label, ctx.lang ?? "cs")} ${String(rec[def.titleField] ?? "")}`.trim();
  };
  const start = await s.sys().get(objectId, recordId);
  if (!start) return { self: null, sources };
  let level: [string, Record<string, unknown>][] = [[objectId, start]];
  for (let depth = 0; depth < 3 && level.length; depth++) {
    const next: [string, Record<string, unknown>][] = [];
    for (const [oid, rec] of level) {
      const def = getObject(oid);
      // dál jen od záznamů, které přílohy zdroje přebírají (účetní záznamy); faktura, e-mail ani jiný doklad ne
      if (!def.attachmentsFromSource) continue;
      const parents: [string, string][] = [];
      if (rec.sourceObject && rec.sourceId && registry.objects.has(String(rec.sourceObject))) parents.push([String(rec.sourceObject), String(rec.sourceId)]);
      for (const [name, f] of Object.entries(def.fields)) if (f.edt.kind === "ref" && f.edt.refObject === "gl.voucher" && rec[name]) parents.push(["gl.voucher", String(rec[name])]);
      for (const [pObj, pId] of parents) {
        const key = `${pObj}:${pId}`;
        if (seen.has(key) || !ctx.modules.has(pObj.split(".")[0]) || !can(ctx.perms, pObj, "read")) continue;
        seen.add(key);
        const p = await s.sys().get(pObj, pId).catch(() => null);
        if (!p) continue;
        sources.push({ objectId: pObj, recordId: pId, title: title(pObj, p) });
        next.push([pObj, p]);
      }
    }
    level = next;
  }
  return { self: { objectId, recordId, title: title(objectId, start) }, sources };
}

const toItem = (r: { id: string; kind: string; name: string; note: string | null; mime: string | null; size: number | null; createdAt: Date; createdBy: string | null }, source?: Linked): DocuRefItem => ({
  id: r.id,
  kind: r.kind as "note" | "file",
  name: r.name,
  note: r.note,
  mime: r.mime,
  size: r.size,
  createdAt: r.createdAt.toISOString(),
  createdBy: r.createdBy,
  ...(source ? { source } : {}),
});

/** Tiskový výstup tisknutelného dokladu (vydaná faktura, záloha, účtenka) jako příloha — vzniká při otevření. */
function pdfItem(doc: Linked, ctx: Ctx, printable: Set<string>, source?: Linked): DocuRefItem | null {
  if (!printable.has(doc.objectId) || !ctx.modules.has(doc.objectId.split(".")[0]) || !can(ctx.perms, doc.objectId, "read")) return null;
  return {
    id: `pdf:${doc.objectId}:${doc.recordId}`,
    kind: "pdf",
    href: `/api/pdf/${doc.objectId}/${doc.recordId}`,
    name: `${doc.title}.pdf`,
    note: null,
    mime: "application/pdf",
    size: null,
    createdAt: new Date(0).toISOString(),
    createdBy: null,
    ...(source ? { source } : {}),
  };
}

/** Přílohy záznamu: vlastní, PDF dokladu a přílohy dokladů, ze kterých záznam vznikl (bez duplicit). */
export async function listDocuRefs(ctx: Ctx, objectId: string, recordId: string, client?: PrismaClient): Promise<DocuRefItem[]> {
  await checkRecord(ctx, objectId, recordId, "read", client);
  return inTenant(
    ctx,
    async (s) => {
      const { self, sources } = await linkedSources(s, ctx, objectId, recordId);
      const keys = [{ objectId, recordId }, ...sources.map((x) => ({ objectId: x.objectId, recordId: x.recordId }))];
      const rows = await s.tx.sysDocuRef.findMany({ where: { tenantId: ctx.tenantId, OR: keys }, orderBy: { createdAt: "desc" } });
      const byKey = new Map(sources.map((x) => [`${x.objectId}:${x.recordId}`, x]));
      // tisknutelné doklady (ModuleDef.printables) — bez importu print.ts (smyčka data → … → docuref)
      const printable = new Set([...registry.modules.values()].flatMap((m) => (m.printables ?? []).map((x) => x.id)));
      const out: DocuRefItem[] = [];
      const pdfSelf = self && pdfItem(self, ctx, printable);
      if (pdfSelf) out.push(pdfSelf);
      for (const r of rows) out.push(toItem(r, byKey.get(`${r.objectId}:${r.recordId}`)));
      for (const src of sources) {
        const p = pdfItem(src, ctx, printable, src);
        if (p) out.push(p);
      }
      // stejný soubor dvěma cestami jen jednou
      return [...new Map(out.map((i) => [i.id, i])).values()];
    },
    client,
  );
}

export async function countDocuRefs(ctx: Ctx, objectId: string, recordId: string, client?: PrismaClient): Promise<number> {
  if (!can(ctx.perms, objectId, "read")) return 0;
  try {
    return (await listDocuRefs(ctx, objectId, recordId, client)).length;
  } catch {
    return 0;
  }
}

export async function addNote(ctx: Ctx, objectId: string, recordId: string, name: string, note: string, client?: PrismaClient) {
  await checkRecord(ctx, objectId, recordId, "write", client);
  if (!note.trim()) throw new UserError("@SYS:Required", {}, { note: "@SYS:Required" });
  await inTenant(
    ctx,
    async (s) => {
      const r = await s.tx.sysDocuRef.create({
        data: {
          tenantId: ctx.tenantId,
          objectId,
          recordId,
          kind: "note",
          name: (name.trim() || note.trim().split("\n")[0]).slice(0, 120),
          note: note.trim(),
          createdBy: ctx.userId,
        },
      });
      await s.audit(objectId, recordId, "docuref", null, { [`docuref:${r.id}`]: r.name });
    },
    client,
  );
}

export async function addFile(
  ctx: Ctx,
  objectId: string,
  recordId: string,
  file: { name: string; type: string; data: Buffer },
  client?: PrismaClient,
) {
  await checkRecord(ctx, objectId, recordId, "write", client);
  if (file.data.length === 0) throw new UserError("@SYS:Required");
  if (file.data.length > MAX_FILE_BYTES) throw new UserError("@SYS:FileTooLarge", { max: "10 MB" });
  const storage = defaultStorage();
  const name = safeFileName(file.name);
  await inTenant(
    ctx,
    async (s) => {
      const key = await storage.put(s.tx, ctx.tenantId, file.data);
      const r = await s.tx.sysDocuRef.create({
        data: {
          tenantId: ctx.tenantId,
          objectId,
          recordId,
          kind: "file",
          name,
          mime: (file.type || "application/octet-stream").slice(0, 120),
          size: file.data.length,
          storage: storage.id,
          storageKey: key,
          createdBy: ctx.userId,
        },
      });
      await s.audit(objectId, recordId, "docuref", null, { [`docuref:${r.id}`]: name });
    },
    client,
  );
}

const IMAGE_MAX_BYTES = 2 * 1024 * 1024;

/** Typ obrázku podle obsahu (ne podle přípony). */
export function imageMime(data: Buffer): string | null {
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (data.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif";
  return null;
}

/**
 * Obrázek záznamu: uloží soubor jako přílohu (DocuRef) a jeho id do pole;
 * předchozí obrázek smaže. `file = null` obrázek odebere.
 */
export async function setImage(
  ctx: Ctx,
  objectId: string,
  recordId: string,
  field: string,
  file: { name: string; data: Buffer } | null,
  client?: PrismaClient,
): Promise<string | null> {
  await checkRecord(ctx, objectId, recordId, "write", client);
  let id: string | null = null;
  if (file) {
    const mime = imageMime(file.data);
    if (!mime) throw new UserError("@SYS:ImageInvalid");
    if (file.data.length > IMAGE_MAX_BYTES) throw new UserError("@SYS:FileTooLarge", { max: "2 MB" });
    const storage = defaultStorage();
    id = await inTenant(
      ctx,
      async (s) => {
        const key = await storage.put(s.tx, ctx.tenantId, file.data);
        const r = await s.tx.sysDocuRef.create({
          data: { tenantId: ctx.tenantId, objectId, recordId, kind: "file", name: safeFileName(file.name), mime, size: file.data.length, storage: storage.id, storageKey: key, createdBy: ctx.userId },
        });
        return r.id;
      },
      client,
    );
  }
  const previous = await setImageField(ctx, objectId, recordId, field, id, client);
  if (previous && previous !== id) await deleteDocuRef(ctx, previous, client).catch(() => undefined);
  return id;
}

export async function deleteDocuRef(ctx: Ctx, id: string, client?: PrismaClient) {
  const ref = await inTenant(ctx, (s) => s.tx.sysDocuRef.findFirst({ where: { id, tenantId: ctx.tenantId } }), client);
  if (!ref) throw new UserError("@SYS:NotFound");
  await checkRecord(ctx, ref.objectId, ref.recordId, "write", client);
  await inTenant(
    ctx,
    async (s) => {
      if (ref.kind === "file" && ref.storageKey) await storageFor(ref.storage).remove(s.tx, ctx.tenantId, ref.storageKey);
      await s.tx.sysDocuRef.delete({ where: { id } });
      await s.audit(ref.objectId, ref.recordId, "docuref", { [`docuref:${ref.id}`]: ref.name }, null);
    },
    client,
  );
}

export async function readFile(ctx: Ctx, id: string, client?: PrismaClient) {
  const ref = await inTenant(ctx, (s) => s.tx.sysDocuRef.findFirst({ where: { id, tenantId: ctx.tenantId, kind: "file" } }), client);
  if (!ref || !ref.storageKey) throw new UserError("@SYS:NotFound");
  // obrázek zboží na dlaždici pokladny: pokladníkovi stačí právo na pokladnu
  if (!(ref.objectId === "inv.item" && can(ctx.perms, "pos.receipt", "write"))) await checkRecord(ctx, ref.objectId, ref.recordId, "read", client);
  const data = await inTenant(ctx, (s) => storageFor(ref.storage).get(s.tx, ctx.tenantId, ref.storageKey!), client);
  if (!data) throw new UserError("@SYS:NotFound");
  return { name: ref.name, mime: ref.mime ?? "application/octet-stream", data };
}
