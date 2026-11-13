/**
 * Obecná datová služba — jediný kód, který čte a zapisuje data objektů.
 * Žádný modul nemá vlastní CRUD; vše jde přes definice objektů.
 *
 * Každá operace:
 *  - běží v transakci tenanta (RLS, src/server/db.ts)
 *  - ověří zapnutý modul a firmu
 *  - převede a ověří hodnoty podle typů polí
 *  - ověří, že odkazy míří na záznamy téhož tenanta/firmy
 *  - spustí události core a zapnutých rozšíření
 *  - hlídá souběžné úpravy (version) a zapisuje audit
 */
import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";
import type { FieldDef, ObjectDef } from "@/core/object";
import { delegateName } from "@/core/object";
import {
  UserError,
  type ActionFile,
  type DataApi,
  type DownloadFile,
  type EventContext,
  type ObjectHandlers,
  type RecordData,
  type ValidationErrors,
} from "@/core/module";
import { coerce, missingMandatory, normalizeRecord } from "@/core/validate";
import { labelTable, registry } from "@/registry";
import { fillLabel, resolveLabel } from "@/core/labels";
import type { Lang } from "@/core/labels";
import { can, type Level, type Perms } from "@/core/security";
import { prisma, withTenant, type Tx } from "./db";
import { fieldWhere, orderByFor } from "./filter-where";
import { setupCompany } from "./setup";
import { storageFor } from "./storage";
import { SECRET_MASK, isEncrypted, sealSecret } from "./secrets";

export interface Ctx {
  tenantId: string;
  userId: string;
  companyId: string | null;
  role: string;
  /** oprávnění uživatele (src/core/security.ts) */
  perms: Perms;
  modules: Set<string>;
  extensions: Set<string>;
  /** jazyk uživatele (výchozí čeština) */
  lang?: Lang;
}

export interface ListParams {
  q?: string;
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  /** přesná shoda na polích (např. řádky dokladu: { voucherId }) */
  filter?: RecordData;
  /** filtry sloupců gridu, syntaxe viz src/core/filter.ts */
  filters?: Record<string, string>;
  lang?: Lang;
  /** jen pro serverový kód (export) — větší stránky než povolí grid */
  maxPageSize?: number;
  /** součty číselných sloupců gridu za celý výběr (ne jen stránku) */
  totals?: boolean;
}

export interface ListResult {
  rows: RecordData[];
  total: number;
  page: number;
  pageSize: number;
  /** pole → součet (text, 2 desetinná místa), jen když se o něj žádalo */
  totals?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Pomocné
// ---------------------------------------------------------------------------

interface Delegate {
  findFirst(args: unknown): Promise<RecordData | null>;
  findMany(args: unknown): Promise<RecordData[]>;
  count(args: unknown): Promise<number>;
  create(args: unknown): Promise<RecordData>;
  updateMany(args: unknown): Promise<{ count: number }>;
  deleteMany(args: unknown): Promise<{ count: number }>;
  aggregate(args: unknown): Promise<{ _sum?: Record<string, Prisma.Decimal | null> }>;
}

const delegate = (tx: Tx, def: ObjectDef) => (tx as unknown as Record<string, Delegate>)[delegateName(def.table)];

export function getObject(objectId: string): ObjectDef {
  const def = registry.objects.get(objectId);
  if (!def) throw new UserError("@SYS:InvalidValue");
  return def;
}

/** Pole objektu doplněná zapnutými rozšířeními (ukládají se do ext). */
export function extFields(ctx: Pick<Ctx, "extensions">, objectId: string): Record<string, FieldDef> {
  const out: Record<string, FieldDef> = {};
  for (const id of ctx.extensions) {
    Object.assign(out, registry.extensions.get(id)?.fields?.[objectId] ?? {});
  }
  return out;
}

function handlersFor(ctx: Ctx, objectId: string): ObjectHandlers[] {
  const list = [...(registry.coreHandlers.get(objectId) ?? [])];
  for (const id of ctx.extensions) {
    const h = registry.extensions.get(id)?.handlers?.[objectId];
    if (h) list.push(h);
  }
  return list;
}

/**
 * Zapnutý modul, vybraná firma a oprávnění uživatele. Systémové operace
 * (logika modulů přes DataApi — např. účtování dokladu) oprávnění nekontrolují,
 * kontroluje se operace uživatele, která je spustila.
 */
function assertAccess(ctx: Ctx, def: ObjectDef, need: Exclude<Level, "none">, system: boolean) {
  const mod = def.id.split(".")[0];
  if (!ctx.modules.has(mod)) throw new UserError("@SYS:InvalidValue");
  if (def.scope === "company" && !ctx.companyId) throw new UserError("@SYS:NoCompany");
  if (!system && !can(ctx.perms, def.id, need)) throw new UserError("@SYS:NoAccess");
}

const scopeWhere = (ctx: Ctx, def: ObjectDef): RecordData =>
  def.scope === "company" ? { tenantId: ctx.tenantId, companyId: ctx.companyId } : { tenantId: ctx.tenantId };

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Tajné údaje navenek (UI, export, historie) jen jako maska. */
export function maskSecrets(def: ObjectDef, row: RecordData): RecordData {
  const out = { ...row };
  for (const [name, f] of Object.entries(def.fields)) if (f.secret) out[name] = row[name] ? SECRET_MASK : null;
  return out;
}

/** Prisma → prosté hodnoty (Decimal → text, datum → YYYY-MM-DD). */
function serialize(def: ObjectDef, row: RecordData): RecordData {
  const out: RecordData = {
    id: row.id,
    version: row.version,
    ext: row.ext ?? {},
    createdAt: (row.createdAt as Date | undefined)?.toISOString(),
    updatedAt: (row.updatedAt as Date | undefined)?.toISOString(),
  };
  if (def.scope === "company") out.companyId = row.companyId;
  for (const [name, f] of Object.entries(def.fields)) {
    const v = row[name];
    if (v === null || v === undefined) out[name] = null;
    else if (f.edt.kind === "decimal") out[name] = (v as Prisma.Decimal).toFixed(f.edt.scale ?? 2);
    else if (f.edt.kind === "date") out[name] = isoDate(v as Date);
    else if (f.edt.kind === "datetime") out[name] = (v as Date).toISOString();
    else out[name] = v;
  }
  return out;
}

/** prosté hodnoty → Prisma */
const RANGE_OPS = ["gt", "gte", "lt", "lte"] as const;

function toDb(def: ObjectDef, data: RecordData): RecordData {
  const out: RecordData = {};
  for (const [name, f] of Object.entries(def.fields)) {
    if (!(name in data)) continue;
    const v = data[name];
    const conv = (x: unknown) => (x !== null && f.edt.kind === "date" ? new Date(`${x}T00:00:00Z`) : x);
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      // rozsah pro DataApi.find: { gte: "2026-01-01", lte: "2026-12-31" }
      const r: RecordData = {};
      for (const op of RANGE_OPS) if (op in (v as RecordData)) r[op] = conv((v as RecordData)[op]);
      out[name] = r;
    } else out[name] = conv(v);
  }
  return out;
}

function formatSeq(format: string, n: number, date: Date): string {
  return format
    .replace(/\{YYYY\}/g, String(date.getUTCFullYear()))
    .replace(/\{YY\}/g, String(date.getUTCFullYear()).slice(2))
    .replace(/\{(#+)\}/, (_, h: string) => String(n).padStart(h.length, "0"));
}

function prismaError(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") throw new UserError("@SYS:Duplicate");
    if (e.code === "P2003") throw new UserError("@SYS:InUse");
  }
  throw e;
}

// ---------------------------------------------------------------------------
// Operace v rámci transakce
// ---------------------------------------------------------------------------

class Session {
  constructor(
    public tx: Tx,
    public ctx: Ctx,
    /** systémová operace (bez kontroly oprávnění uživatele) */
    public system = false,
  ) {}

  /** stejná transakce, ale bez kontroly oprávnění — pro interní kroky */
  sys(): Session {
    return this.system ? this : new Session(this.tx, this.ctx, true);
  }

  eventCtx(objectId: string): EventContext {
    return {
      tenantId: this.ctx.tenantId,
      companyId: this.ctx.companyId,
      userId: this.ctx.userId,
      objectId,
      data: this.api(),
      t: (ref, params) => fillLabel(resolveLabel(labelTable, ref, this.ctx.lang ?? "cs"), params),
    };
  }

  api(): DataApi {
    const s = this.sys();
    return {
      get: (o, id) => s.get(o, id),
      find: (o, where, opts) => s.find(o, where, opts?.take, opts?.orderBy),
      create: (o, data) => s.save(o, null, data, { system: true }),
      update: (o, id, data) => s.save(o, id, data, { system: true }),
      nextNumber: (seq, date) => s.nextNumber(seq, date),
    };
  }

  async get(objectId: string, id: string): Promise<RecordData | null> {
    const def = getObject(objectId);
    assertAccess(this.ctx, def, "read", this.system);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const row = await delegate(this.tx, def).findFirst({ where: { id, ...scopeWhere(this.ctx, def) } });
    return row ? serialize(def, row) : null;
  }

  async find(objectId: string, where: RecordData, take = 1000, orderBy?: Record<string, "asc" | "desc">): Promise<RecordData[]> {
    const def = getObject(objectId);
    assertAccess(this.ctx, def, "read", this.system);
    const rows = await delegate(this.tx, def).findMany({
      where: { ...toDb(def, where), ...scopeWhere(this.ctx, def) },
      orderBy: [...Object.entries(orderBy ?? {}).filter(([f]) => f in def.fields).map(([f, d]) => ({ [f]: d })), { createdAt: "asc" }, { id: "asc" }],
      take,
    });
    return rows.map((r) => serialize(def, r));
  }

  async list(objectId: string, p: ListParams): Promise<ListResult> {
    const def = getObject(objectId);
    assertAccess(this.ctx, def, "read", this.system);
    const pageSize = Math.min(Math.max(p.pageSize ?? 50, 1), p.maxPageSize ?? 200);
    const page = Math.max(p.page ?? 1, 1);
    const where: RecordData = { ...scopeWhere(this.ctx, def) };
    for (const [k, v] of Object.entries(p.filter ?? {})) {
      if (k in def.fields) where[k] = v;
    }
    const and: RecordData[] = [];
    for (const [k, expr] of Object.entries(p.filters ?? {})) {
      const w = fieldWhere(def, k, String(expr ?? ""), p.lang ?? "cs");
      if (w) and.push(w);
    }
    if (and.length) where.AND = and;
    const q = p.q?.trim();
    if (q) {
      const or: RecordData[] = def.list
        .filter((f) => def.fields[f].edt.kind === "string" || def.fields[f].edt.kind === "text")
        .map((f) => ({ [f]: { contains: q, mode: "insensitive" } }));
      if (or.length) where.OR = or;
    }
    const sortField = p.sort && p.sort in def.fields ? p.sort : def.defaultSort?.field;
    const dir = p.dir === "desc" || p.dir === "asc" ? p.dir : (def.defaultSort?.dir ?? "asc");
    const sortBy = sortField ? orderByFor(def, sortField, dir) : null;
    const orderBy = [...(sortBy ? [sortBy] : []), { id: "asc" }];
    const d = delegate(this.tx, def);
    const [rows, total] = await Promise.all([
      d.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
      d.count({ where }),
    ]);
    // seznam jde do UI a exportu — tajné údaje jen jako maska
    const out = rows.map((r) => maskSecrets(def, serialize(def, r)));
    await this.attachRefTitles(def, out);
    let totals: Record<string, string> | undefined;
    const sumFields = def.list.filter((f) => def.fields[f]?.edt.kind === "decimal" && !def.fields[f].edt.noTotal);
    if (p.totals && sumFields.length) {
      const agg = await d.aggregate({ where, _sum: Object.fromEntries(sumFields.map((f) => [f, true])) });
      totals = Object.fromEntries(sumFields.map((f) => [f, (agg._sum?.[f] ?? new Prisma.Decimal(0)).toFixed(def.fields[f].edt.scale ?? 2)]));
    }
    return { rows: out, total, page, pageSize, totals };
  }

  /** k odkazům doplní text cílového záznamu: row._titles[pole] */
  async attachRefTitles(def: ObjectDef, rows: RecordData[]) {
    const refFields = Object.entries(def.fields).filter(([, f]) => f.edt.kind === "ref");
    for (const [name, f] of refFields) {
      const target = getObject(f.edt.refObject!);
      if (!this.ctx.modules.has(target.id.split(".")[0])) continue;
      const ids = [...new Set(rows.map((r) => r[name]).filter(Boolean))] as string[];
      if (!ids.length) continue;
      const found = await delegate(this.tx, target).findMany({
        where: { id: { in: ids }, ...scopeWhere(this.ctx, target) },
        select: { id: true, [target.titleField]: true },
      });
      const map = new Map(found.map((t) => [t.id, String(t[target.titleField] ?? "")]));
      for (const r of rows) {
        const titles = ((r._titles as RecordData) ??= {});
        if (r[name]) titles[name] = map.get(r[name] as string) ?? "";
      }
    }
  }

  /**
   * Další číslo řady. Pořadí hledání: konkrétní řada (id) → řada určená pro
   * objekt (Použití) → řada podle kódu (výchozí z definice objektu/modulu).
   */
  async nextNumber(seq: string | { id?: string; usedFor?: string; code?: string }, date = new Date()): Promise<string> {
    if (!this.ctx.companyId) throw new UserError("@SYS:NoCompany");
    const by = typeof seq === "string" ? { code: seq } : seq;
    const scope = Prisma.sql`tenant_id = ${this.ctx.tenantId}::uuid AND company_id = ${this.ctx.companyId}::uuid`;
    const take = async (cond: Prisma.Sql) =>
      // atomicky: UPDATE … RETURNING drží zámek řádku do konce transakce
      this.tx.$queryRaw<{ format: string; n: number }[]>`
        UPDATE sys_number_seq SET next_number = next_number + 1, version = version + 1, updated_at = now()
        WHERE ${scope} AND ${cond}
        RETURNING format, next_number - 1 AS n`;
    let rows: { format: string; n: number }[] = [];
    if (by.id) rows = await take(Prisma.sql`id = ${by.id}::uuid`);
    if (!rows.length && by.usedFor) rows = await take(Prisma.sql`used_for = ${by.usedFor}`);
    if (!rows.length && by.code) rows = await take(Prisma.sql`code = ${by.code}`);
    if (!rows.length) throw new UserError("@SYS:MissingSeq", { seq: by.code ?? by.usedFor ?? "" });
    return formatSeq(rows[0].format, Number(rows[0].n), date);
  }

  async save(
    objectId: string,
    id: string | null,
    input: RecordData,
    opts: { system?: boolean; version?: number } = {},
  ): Promise<RecordData> {
    const def = getObject(objectId);
    assertAccess(this.ctx, def, "write", this.system || !!opts.system);
    if (def.systemOnly && !opts.system) throw new UserError("@SYS:InvalidValue");

    const xf = extFields(this.ctx, objectId);
    const fieldsForInput = opts.system
      ? Object.fromEntries(Object.entries(def.fields).map(([k, f]) => [k, { ...f, readOnly: false }]))
      : def.fields;
    const { data, ext, errors } = normalizeRecord({ ...def, fields: fieldsForInput }, input, registry, xf);

    const existing = id ? await this.sys().get(objectId, id) : null;
    if (id && !existing) throw new UserError("@SYS:NotFound");
    if (existing && def.lockedWhen && !opts.system && existing[def.lockedWhen.field] === def.lockedWhen.equals)
      throw new UserError("@SYS:Locked");

    // tajné údaje: maska / prázdné = beze změny, jinak zašifrovat
    for (const [name, f] of Object.entries(def.fields)) {
      if (!f.secret || !(name in data)) continue;
      const v = data[name];
      if (v === null || v === "" || v === SECRET_MASK) delete data[name];
      else if (!isEncrypted(v)) data[name] = sealSecret(String(v));
    }
    const isNew = !existing;
    const merged: RecordData = { ...(existing ?? {}), ...data, ext: { ...((existing?.ext as RecordData) ?? {}), ...ext } };

    if (isNew) {
      for (const [name, f] of Object.entries(def.fields)) {
        if (merged[name] === undefined && f.default !== undefined) {
          const def0 = f.default === "$today" ? new Date().toISOString().slice(0, 10) : f.default;
          const [v] = coerce(f.edt, def0, registry);
          merged[name] = v;
        }
      }
      if (def.numberSeq && !merged[def.numberSeq.field]) {
        merged[def.numberSeq.field] = await this.nextNumber({ usedFor: def.id, code: def.numberSeq.seq });
      }
      Object.assign(errors, missingMandatory(def, merged));
    } else {
      for (const [name, f] of Object.entries(def.fields)) {
        if (f.mandatory && name in data && (merged[name] === null || merged[name] === "")) errors[name] = "@SYS:Required";
      }
    }

    // odkazy musí mířit na záznam téhož tenanta (a firmy) — FK to neohlídá
    for (const [name, f] of Object.entries(def.fields)) {
      if (f.edt.kind !== "ref" || !(name in data) || !merged[name] || errors[name]) continue;
      const target = await this.sys().get(f.edt.refObject!, String(merged[name]));
      if (!target) errors[name] = "@SYS:InvalidValue";
    }

    const ectx = this.eventCtx(objectId);
    for (const h of handlersFor(this.ctx, objectId)) {
      const res = await h.beforeSave?.(ectx, merged, isNew);
      if (res) Object.assign(errors, res);
    }
    if (Object.keys(errors).length) throw new UserError("@SYS:FixErrors", {}, errors);

    const d = delegate(this.tx, def);
    const values = toDb(def, merged);
    let saved: RecordData;
    try {
      if (isNew) {
        saved = await d.create({
          data: {
            ...values,
            ext: merged.ext,
            tenantId: this.ctx.tenantId,
            ...(def.scope === "company" ? { companyId: this.ctx.companyId } : {}),
            createdBy: this.ctx.userId,
            updatedBy: this.ctx.userId,
          },
        });
      } else {
        const version = opts.version ?? (existing!.version as number);
        const res = await d.updateMany({
          where: { id, version, ...scopeWhere(this.ctx, def) },
          data: { ...values, ext: merged.ext, updatedBy: this.ctx.userId, version: { increment: 1 } },
        });
        if (res.count === 0) throw new UserError("@SYS:Conflict");
        saved = (await d.findFirst({ where: { id, ...scopeWhere(this.ctx, def) } }))!;
      }
    } catch (e) {
      if (e instanceof UserError) throw e;
      prismaError(e);
    }
    const result = serialize(def, saved);
    await this.audit(objectId, String(result.id), isNew ? "create" : "update", existing && maskSecrets(def, existing), maskSecrets(def, result));
    for (const h of handlersFor(this.ctx, objectId)) await h.afterSave?.(ectx, result, isNew);
    // nová firma dostane výchozí nastavení zapnutých modulů (číselné řady, účty…)
    if (isNew && def.id === "sys.company") {
      await setupCompany(new Session(this.tx, { ...this.ctx, companyId: String(result.id) }, true).api(), this.ctx.modules);
    }
    return result;
  }

  async remove(objectId: string, id: string): Promise<void> {
    const def = getObject(objectId);
    assertAccess(this.ctx, def, "delete", this.system);
    if (def.systemOnly) throw new UserError("@SYS:InvalidValue");
    const existing = await this.sys().get(objectId, id);
    if (!existing) throw new UserError("@SYS:NotFound");
    if (def.lockedWhen && existing[def.lockedWhen.field] === def.lockedWhen.equals) throw new UserError("@SYS:Locked");
    const ectx = this.eventCtx(objectId);
    for (const h of handlersFor(this.ctx, objectId)) {
      const err = await h.beforeDelete?.(ectx, existing);
      if (err) throw new UserError(err);
    }
    // řádky dokladu se mažou s ním
    for (const l of def.lines ?? []) {
      const lineDef = getObject(l.object);
      if (lineDef.systemOnly || l.owned === false) continue;
      // řádky patří dokladu — stačí právo smazat doklad
      const sys = this.sys();
      for (const line of await sys.find(l.object, { [l.field]: id })) await sys.remove(l.object, String(line.id));
    }
    try {
      await delegate(this.tx, def).deleteMany({ where: { id, ...scopeWhere(this.ctx, def) } });
    } catch (e) {
      prismaError(e);
    }
    // přílohy (DocuRef) patří záznamu — smazat i s obsahem souborů
    const refs = await this.tx.sysDocuRef.findMany({ where: { tenantId: this.ctx.tenantId, objectId, recordId: id } });
    for (const r of refs) if (r.storageKey) await storageFor(r.storage).remove(this.tx, this.ctx.tenantId, r.storageKey);
    if (refs.length) await this.tx.sysDocuRef.deleteMany({ where: { id: { in: refs.map((r) => r.id) } } });
    await this.audit(objectId, id, "delete", maskSecrets(def, existing), null);
    for (const h of handlersFor(this.ctx, objectId)) await h.afterDelete?.(ectx, existing);
  }

  async action(objectId: string, id: string, actionId: string, file?: ActionFile): Promise<void> {
    const def = getObject(objectId);
    assertAccess(this.ctx, def, "write", this.system);
    const a = def.actions?.find((x) => x.id === actionId);
    if (!a) throw new UserError("@SYS:InvalidValue");
    const record = await this.sys().get(objectId, id);
    if (!record) throw new UserError("@SYS:NotFound");
    if (a.when && record[a.when.field] !== a.when.equals) throw new UserError("@SYS:Locked");
    const fn = handlersFor(this.ctx, objectId).find((h) => h.actions?.[actionId])?.actions?.[actionId];
    if (!fn) throw new UserError("@SYS:InvalidValue");
    if (a.upload && !file) throw new UserError("@SYS:Required");
    await fn(this.eventCtx(objectId), record, file);
  }

  /** Akce se souborem ke stažení — stačí právo číst záznam. */
  async download(objectId: string, id: string, actionId: string): Promise<DownloadFile> {
    const def = getObject(objectId);
    assertAccess(this.ctx, def, "read", this.system);
    const a = def.actions?.find((x) => x.id === actionId && x.download);
    if (!a) throw new UserError("@SYS:InvalidValue");
    const record = await this.sys().get(objectId, id);
    if (!record) throw new UserError("@SYS:NotFound");
    const fn = handlersFor(this.ctx, objectId).find((h) => h.downloads?.[actionId])?.downloads?.[actionId];
    if (!fn) throw new UserError("@SYS:InvalidValue");
    return fn(this.eventCtx(objectId), record);
  }

  async audit(objectId: string, recordId: string, action: string, before: RecordData | null, after: RecordData | null) {
    const changes: RecordData = {};
    const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
    for (const k of keys) {
      if (["version", "updatedAt", "createdAt", "_titles"].includes(k)) continue;
      const a = JSON.stringify(before?.[k] ?? null);
      const b = JSON.stringify(after?.[k] ?? null);
      if (a !== b) changes[k] = [before?.[k] ?? null, after?.[k] ?? null];
    }
    await this.tx.sysAudit.create({
      data: { tenantId: this.ctx.tenantId, objectId, recordId, action, userId: this.ctx.userId, changes: changes as Prisma.InputJsonValue },
    });
  }
}

// ---------------------------------------------------------------------------
// Veřejné API (volají server actions a stránky)
// ---------------------------------------------------------------------------

export function inTenant<T>(ctx: Ctx, fn: (s: Session) => Promise<T>, client?: PrismaClient): Promise<T> {
  return withTenant(ctx.tenantId, (tx) => fn(new Session(tx, ctx)), client ?? prisma);
}

export const listRecords = (ctx: Ctx, objectId: string, p: ListParams, client?: PrismaClient) =>
  inTenant(ctx, (s) => s.list(objectId, p), client);

export const getRecord = (ctx: Ctx, objectId: string, id: string, client?: PrismaClient) =>
  inTenant(
    ctx,
    async (s) => {
      const r = await s.get(objectId, id);
      if (r) await s.attachRefTitles(getObject(objectId), [r]);
      return r && maskSecrets(getObject(objectId), r);
    },
    client,
  );

export const saveRecord = (
  ctx: Ctx,
  objectId: string,
  id: string | null,
  input: RecordData,
  version?: number,
  client?: PrismaClient,
) => inTenant(ctx, async (s) => maskSecrets(getObject(objectId), await s.save(objectId, id, input, { version })), client);

export const deleteRecord = (ctx: Ctx, objectId: string, id: string, client?: PrismaClient) =>
  inTenant(ctx, (s) => s.remove(objectId, id), client);

export const downloadFile = (ctx: Ctx, objectId: string, id: string, actionId: string, client?: PrismaClient) =>
  inTenant(ctx, (s) => s.download(objectId, id, actionId), client);

export const runAction = (ctx: Ctx, objectId: string, id: string, actionId: string, client?: PrismaClient, file?: ActionFile) =>
  inTenant(ctx, (s) => s.action(objectId, id, actionId, file), client);

/** Možnosti pro výběr odkazu (combobox ve formuláři). */
export const refOptions = (ctx: Ctx, objectId: string, q: string, client?: PrismaClient) =>
  inTenant(
    ctx,
    async (s) => {
      const def = getObject(objectId);
      const res = await s.list(objectId, { q, pageSize: 30 });
      // druhý textový sloupec gridu jako upřesnění (u účtu název, u střediska název…)
      const sub = def.list.find((f) => f !== def.titleField && def.fields[f].edt.kind === "string");
      return res.rows.map((r) => ({
        id: String(r.id),
        title: String(r[def.titleField] ?? ""),
        subtitle: sub ? String(r[sub] ?? "") : "",
      }));
    },
    client,
  );

export type { ValidationErrors };
