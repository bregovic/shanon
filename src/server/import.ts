/**
 * Obecný import do libovolného číselníku (CSV, XML, Excel).
 *
 * - Sloupce se spárují s poli objektu podle názvu pole, popisku (cs i en)
 *   nebo aliasů (`FieldDef.aliases`) — bez ohledu na diakritiku a velikost.
 * - Odkazy se dohledají podle kódu cílového záznamu (titleField) nebo názvu,
 *   výčty podle hodnoty i popisku, čísla v českém zápisu (1 234,50 Kč).
 * - Existující záznam (podle unikátního klíče, např. čísla položky) se
 *   aktualizuje; prázdná buňka hodnotu nemění.
 * - Vše v jedné transakci přes datovou službu (oprávnění, validace, události).
 *   Při jediné chybě se neuloží nic a vrátí se seznam chyb po řádcích;
 *   „Zkontrolovat“ projde vše stejně a na konci transakci vrátí.
 */
import "server-only";
import ExcelJS from "exceljs";
import { XMLParser } from "fast-xml-parser";
import type { PrismaClient } from "@/generated/prisma/client";
import { UserError, type RecordData } from "@/core/module";
import type { FieldDef, ObjectDef } from "@/core/object";
import { coerce } from "@/core/validate";
import { fillLabel, resolveLabel, type Lang } from "@/core/labels";
import { labelTable, registry } from "@/registry";
import { can } from "@/core/security";
import { getObject, inTenant, type Ctx, type Session } from "./data";
import { imageMime, safeFileName } from "./docuref";
import { defaultStorage, storageFor } from "./storage";

export const IMPORT_MAX_ROWS = 5000;

export interface ImportTable {
  headers: string[];
  rows: string[][];
}

export interface ImportColumn {
  header: string;
  field: string | null;
  label: string | null;
  /** mapped = importuje se, computed = pole počítá systém, ignored = neznámý sloupec */
  status: "mapped" | "computed" | "ignored";
}

export interface ImportReport {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  columns: ImportColumn[];
  /** povinná pole, pro která v souboru chybí sloupec */
  missing: string[];
  errors: { row: number; column: string | null; message: string }[];
  /** neblokující: záznam se uloží (např. bez obrázku, který nebyl mezi soubory) */
  warnings: { row: number; column: string | null; message: string }[];
  applied: boolean;
}

// ---------------------------------------------------------------------------
// Čtení souboru
// ---------------------------------------------------------------------------

/** UTF-8 (i s BOM), jinak Windows-1250 — tak ukládá CSV český Excel. */
export function decodeText(buf: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1250").decode(buf);
  }
}

export function parseCsv(text: string): ImportTable {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const delim = [";", "\t", ","].reduce((best, d) => (count(d) > count(best) ? d : best), ";");
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell === "") q = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    out.push(row);
  }
  const [headers = [], ...rows] = out;
  return { headers: headers.map((h) => h.trim()), rows };
}

/**
 * XML: záznamy = první opakující se prvek (<polozky><polozka>…</polozka>…),
 * hodnoty z podřízených prvků i atributů.
 */
export function parseXml(text: string): ImportTable {
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", parseTagValue: false, trimValues: true }).parse(text);
  const isRec = (v: unknown) => v !== null && typeof v === "object" && !Array.isArray(v);
  const flat = (o: RecordData) => Object.entries(o).filter(([k, v]) => k !== "#text" && (typeof v !== "object" || v === null));
  const find = (node: unknown): RecordData[] | null => {
    if (Array.isArray(node) && node.some(isRec)) return node.filter(isRec) as RecordData[];
    if (isRec(node)) {
      for (const v of Object.values(node as RecordData)) {
        const r = find(v);
        if (r) return r;
      }
      // jediný záznam (bez opakování)
      const vals = Object.values(node as RecordData);
      if (vals.length && vals.every((v) => typeof v !== "object" || v === null) && Object.keys(node as RecordData).some((k) => k !== "?xml")) return [node as RecordData];
    }
    return null;
  };
  const top = Object.fromEntries(Object.entries(doc as RecordData).filter(([k]) => k !== "?xml"));
  const recs = find(top) ?? [];
  const headers: string[] = [];
  for (const r of recs) for (const [k] of flat(r)) if (!headers.includes(k)) headers.push(k);
  const rows = recs.map((r) => headers.map((h) => (r[h] === undefined || r[h] === null ? "" : String(r[h]))));
  return { headers, rows };
}

export async function parseXlsx(buf: Buffer): Promise<ImportTable> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  const out: string[][] = [];
  ws?.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let i = 1; i <= ws.columnCount; i++) {
      const v = row.getCell(i).value;
      cells.push(
        v === null || v === undefined
          ? ""
          : v instanceof Date
            ? v.toISOString().slice(0, 10)
            : typeof v === "object" && "result" in v
              ? String(v.result ?? "")
              : typeof v === "object" && "text" in v
                ? String(v.text)
                : String(v),
      );
    }
    out.push(cells);
  });
  const [headers = [], ...rows] = out;
  return { headers: headers.map((h) => h.trim()), rows };
}

export async function readTable(name: string, buf: Buffer): Promise<ImportTable> {
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b) return parseXlsx(buf); // ZIP = .xlsx
  const text = decodeText(buf);
  return /^\s*</.test(text) || /\.xml$/i.test(name) ? parseXml(text) : parseCsv(text);
}

// ---------------------------------------------------------------------------
// Párování sloupců a převod hodnot
// ---------------------------------------------------------------------------

export const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const fieldLabel = (f: FieldDef, lang: Lang) => resolveLabel(labelTable, f.label ?? f.edt.label, lang);

/** Sloupec → pole. Přednost má název pole, pak popisky, pak aliasy. */
export function mapColumns(def: ObjectDef, headers: string[], lang: Lang): ImportColumn[] {
  const keys = new Map<string, string>();
  const add = (k: string, field: string) => {
    const n = norm(k);
    if (n && !keys.has(n)) keys.set(n, field);
  };
  const fields = Object.entries(def.fields);
  for (const [n] of fields) add(n, n);
  for (const [n, f] of fields) for (const l of ["cs", "en"] as Lang[]) add(fieldLabel(f, l), n);
  for (const [n, f] of fields) for (const a of f.aliases ?? []) add(a, n);
  const used = new Set<string>();
  return headers.map((header) => {
    const field = keys.get(norm(header)) ?? null;
    if (!field || used.has(field)) return { header, field: null, label: null, status: "ignored" as const };
    used.add(field);
    const f = def.fields[field];
    // obrázek je jen pro čtení ve formuláři, ale import ho nastaví ze souboru
    return { header, field, label: fieldLabel(f, lang), status: f.readOnly && !f.image ? ("computed" as const) : ("mapped" as const) };
  });
}

const BOOL_TRUE = new Set(["ano", "a", "yes", "y", "true", "1", "x", "pravda"]);
const BOOL_FALSE = new Set(["ne", "n", "no", "false", "0", "nepravda"]);

/** Hodnota z buňky → tvar, který přijme datová služba. Vrací [hodnota, chyba]. */
export function cellValue(f: FieldDef, raw: string, lang: Lang): [unknown, string | null] {
  const v = raw.trim();
  switch (f.edt.kind) {
    case "decimal":
    case "int": {
      let s = v.replace(/[\s ]/g, "").replace(/(kč|czk|eur|€|%)$/i, "");
      if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
      return [s.replace(",", "."), null];
    }
    case "date": {
      const m = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/.exec(v);
      return [m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : v, null];
    }
    case "bool": {
      const n = norm(v);
      if (BOOL_TRUE.has(n)) return [true, null];
      if (BOOL_FALSE.has(n)) return [false, null];
      return [v, "@SYS:InvalidValue"];
    }
    case "enum": {
      const e = registry.enums.get(f.edt.enumId!)!;
      const hit = e.values.find((x) => norm(x.value) === norm(v) || (["cs", "en"] as Lang[]).some((l) => norm(resolveLabel(labelTable, x.label, l)) === norm(v)));
      return hit ? [hit.value, null] : [v, "@SYS:InvalidValue"];
    }
    default:
      void lang;
      return [v, null];
  }
}

// ---------------------------------------------------------------------------
// Běh importu
// ---------------------------------------------------------------------------

class Rollback extends Error {
  constructor(public report: ImportReport) {
    super("rollback");
  }
}

/** Soubory obrázků k importu: cesta (jak ji zná uživatel) → obsah. */
export type ImageSource = (path: string) => { name: string; data: Buffer } | null;

const normPath = (p: string) => p.trim().replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase();

/** Obrázky nahrané v prohlížeči (složka): spárování podle konce cesty, jinak podle názvu souboru. */
export function imagesFromUploads(files: { path: string; data: Buffer }[]): ImageSource {
  const list = files.map((f) => ({ key: normPath(f.path), name: f.path.split(/[\\/]/).pop()!, data: f.data }));
  return (raw) => {
    const p = normPath(raw);
    const hit =
      list.find((f) => f.key === p || f.key.endsWith(`/${p}`) || p.endsWith(`/${f.key}`)) ??
      (() => {
        const base = p.split("/").pop();
        const same = list.filter((f) => f.key.split("/").pop() === base);
        return same.length === 1 ? same[0] : undefined;
      })();
    return hit ? { name: hit.name, data: hit.data } : null;
  };
}

export async function importRecords(
  ctx: Ctx,
  objectId: string,
  table: ImportTable,
  opts: { dryRun: boolean; lang: Lang; images?: ImageSource },
  client?: PrismaClient,
): Promise<ImportReport> {
  const def = getObject(objectId);
  if (def.systemOnly || !can(ctx.perms, def.id, "write") || !ctx.modules.has(def.id.split(".")[0])) throw new UserError("@SYS:NoAccess");
  const t = (ref: string, p?: Record<string, string>) => fillLabel(resolveLabel(labelTable, ref, opts.lang), p);
  const rows = table.rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length > IMPORT_MAX_ROWS) throw new UserError("@SYS:ImportTooMany", { max: String(IMPORT_MAX_ROWS) });

  const columns = mapColumns(def, table.headers, opts.lang);
  const mapped = columns.map((c, i) => ({ ...c, i })).filter((c) => c.status === "mapped");
  if (!mapped.length) throw new UserError("@SYS:ImportNoColumns");
  const has = new Set(mapped.map((c) => c.field));
  // klíč pro aktualizaci: první unikátní kombinace, kterou soubor obsahuje
  const key = def.unique?.find((u) => u.every((f) => has.has(f))) ?? null;
  const missing = Object.entries(def.fields)
    .filter(([n, f]) => f.mandatory && !f.readOnly && f.default === undefined && def.numberSeq?.field !== n && !has.has(n))
    .map(([, f]) => fieldLabel(f, opts.lang));

  const report: ImportReport = { total: rows.length, created: 0, updated: 0, skipped: table.rows.length - rows.length, columns, missing, errors: [], warnings: [], applied: false };
  const err = (row: number, column: string | null, message: string) => {
    if (report.errors.length < 200) report.errors.push({ row, column, message });
  };
  // první datový řádek = řádek 2 souboru (pod hlavičkou)
  const lineNo = (i: number) => table.rows.indexOf(rows[i]) + 2;

  try {
    await inTenant(
      ctx,
      async (s) => {
        // odkazy: kód / název cílového záznamu → id (načte se jednou na objekt)
        const lookups = new Map<string, Map<string, string | null>>();
        const lookup = async (target: string) => {
          if (lookups.has(target)) return lookups.get(target)!;
          const tdef = getObject(target);
          const m = new Map<string, string | null>();
          const put = (k: unknown, id: string) => {
            const n = norm(String(k ?? ""));
            if (!n) return;
            m.set(n, m.has(n) && m.get(n) !== id ? null : id); // null = nejednoznačné
          };
          const rows = await s.sys().find(target, {}, 20000);
          // záznam bez vlastního názvu (dodavatel, odběratel) i podle názvu odkazu (subjektu)
          const refField = tdef.list.find((f) => tdef.fields[f]?.edt.kind === "ref");
          if (refField && !("name" in tdef.fields)) await s.attachRefTitles(tdef, rows);
          for (const r of rows) {
            put(r[tdef.titleField], String(r.id));
            if ("name" in tdef.fields && tdef.titleField !== "name") put(r.name, String(r.id));
            else if (refField) put((r._titles as Record<string, string> | undefined)?.[refField], String(r.id));
          }
          lookups.set(target, m);
          return m;
        };

        for (let i = 0; i < rows.length; i++) {
          const cells = rows[i];
          const values: RecordData = {};
          const images: { field: string; file: { name: string; data: Buffer } }[] = [];
          let bad = false;
          for (const c of mapped) {
            const raw = (cells[c.i] ?? "").trim();
            if (raw === "") continue;
            const f = def.fields[c.field!];
            if (f.image) {
              // chybějící nebo vadný obrázek záznam neblokuje — uloží se bez něj
              const file = opts.images?.(raw) ?? null;
              const mime = file ? imageMime(file.data) : null;
              const warn = (message: string) => report.warnings.length < 200 && report.warnings.push({ row: lineNo(i), column: c.header, message });
              if (!file) warn(t("@SYS:ImageNotFound", { path: raw }));
              else if (!mime) warn(`${t("@SYS:ImageInvalid")} (${raw})`);
              else images.push({ field: c.field!, file });
              continue;
            }
            if (f.edt.kind === "ref") {
              const map = await lookup(f.edt.refObject!);
              // účet zadaný syntetikou (604) = 604000
              const id = map.get(norm(raw)) ?? (f.edt.refObject === "gl.account" && /^\d{3}$/.test(raw) ? map.get(`${raw}000`) : undefined);
              if (!id) {
                err(lineNo(i), c.header, t(id === null ? "@SYS:ImportAmbiguous" : "@SYS:ImportNotFound", { value: raw }));
                bad = true;
              } else values[c.field!] = id;
              continue;
            }
            const [v, e] = cellValue(f, raw, opts.lang);
            if (e) {
              err(lineNo(i), c.header, `${t(e)} (${raw})`);
              bad = true;
            } else values[c.field!] = v;
          }
          if (bad) continue;

          let existingId: string | null = null;
          if (key && key.every((k) => values[k] !== undefined)) {
            const where: RecordData = {};
            for (const k of key) where[k] = coerce(def.fields[k].edt, values[k], registry)[0];
            existingId = ((await s.sys().find(objectId, where, 1))[0]?.id as string) ?? null;
          }
          await s.tx.$executeRawUnsafe("SAVEPOINT shanon_import_row");
          try {
            const saved = await s.save(objectId, existingId, values);
            for (const im of images) await storeImage(s, objectId, String(saved.id), im.field, saved[im.field] as string | null, im.file);
            await s.tx.$executeRawUnsafe("RELEASE SAVEPOINT shanon_import_row");
            if (existingId) report.updated++;
            else report.created++;
          } catch (e) {
            await s.tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT shanon_import_row");
            if (!(e instanceof UserError)) throw e;
            const fields = Object.entries(e.fields ?? {});
            if (!fields.length) err(lineNo(i), null, t(e.label, e.params));
            for (const [name, msg] of fields) {
              const col = columns.find((c) => c.field === name)?.header ?? (def.fields[name] ? fieldLabel(def.fields[name], opts.lang) : name);
              err(lineNo(i), col, t(msg));
            }
          }
        }
        if (report.errors.length || opts.dryRun) throw new Rollback(report);
      },
      client,
    );
    report.applied = true;
    return report;
  } catch (e) {
    if (e instanceof Rollback) return e.report;
    throw e;
  }
}

/**
 * Obrázek záznamu v transakci importu: stejný soubor (název a velikost) se
 * znovu neukládá, jinak nová příloha a stará se smaže.
 */
async function storeImage(s: Session, objectId: string, recordId: string, field: string, current: string | null, file: { name: string; data: Buffer }) {
  const tenantId = s.ctx.tenantId;
  const name = safeFileName(file.name);
  if (current) {
    const old = await s.tx.sysDocuRef.findFirst({ where: { id: current, tenantId } });
    if (old && old.name === name && old.size === file.data.length) return;
    if (old) {
      if (old.storageKey) await storageFor(old.storage).remove(s.tx, tenantId, old.storageKey);
      await s.tx.sysDocuRef.delete({ where: { id: old.id } });
    }
  }
  const storage = defaultStorage();
  const key = await storage.put(s.tx, tenantId, file.data);
  const ref = await s.tx.sysDocuRef.create({
    data: { tenantId, objectId, recordId, kind: "file", name, mime: imageMime(file.data)!, size: file.data.length, storage: storage.id, storageKey: key, createdBy: s.ctx.userId },
  });
  await s.save(objectId, recordId, { [field]: ref.id }, { system: true });
}

/** Šablona CSV: hlavička z popisků polí, která lze importovat. */
export function importTemplate(def: ObjectDef, lang: Lang, hidden: string[] = []): string {
  const cols = Object.entries(def.fields).filter(([n, f]) => (!f.readOnly || f.image) && !hidden.includes(n));
  const cell = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return "﻿" + cols.map(([, f]) => cell(fieldLabel(f, lang))).join(";") + "\r\n";
}
