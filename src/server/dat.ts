/**
 * Společná data (DAT) — skrytá firma organizace s výchozí konfigurací pro firmy.
 *
 * - jedna na tenanta (`sys_company.dat`), v přepínači firem jen pro superuživatele (Správa systému → Společná data)
 * - parametry modulů (`ObjectDef.datTemplate`): firma, která modul zapíná a parametry ještě nemá, je převezme (kopie)
 * - běžné číselníky (`ObjectDef.datLayer`: jednotky, platební podmínky a metody, formáty výpisů, tiskové sestavy):
 *   firma má vlastní kopie (rychlé čtení, vazby dokladů vždy na vlastní záznam). Nový záznam v DAT se doplní všem
 *   firmám s modulem, které kód ještě nemají; změna v DAT se propíše do kopií, které firma neupravila (`datLocal`).
 *   Upravená kopie = vlastní záznam firmy s předností, DAT ho už nepřepíše.
 * - odkazy na data jednotlivých firem (bankovní účet, dodavatel FÚ…) se nekopírují, jen na společné záznamy (měny)
 *
 * Bez importu `./data` za běhu (data.ts tento soubor volá) — jiné firmy přes `Session.forCompany`.
 */
import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { UserError, type RecordData } from "@/core/module";
import type { ObjectDef } from "@/core/object";
import { registry } from "@/registry";
import { prisma } from "./db";
import type { Session } from "./data";
import { enableCompanyModules } from "./modules";

/** Firma DAT tenanta (založí ji, když chybí; moduly = moduly tenanta, bez výchozího nastavení). */
export async function ensureDat(tenantId: string, client: PrismaClient = prisma): Promise<string> {
  const have = await client.sysCompany.findFirst({ where: { tenantId, dat: true }, select: { id: true } });
  const mods = (await client.sysTenantModule.findMany({ where: { tenantId }, select: { moduleId: true } })).map((m) => m.moduleId);
  if (have) {
    await enableCompanyModules(tenantId, have.id, mods, client);
    return have.id;
  }
  const code = (await client.sysCompany.findFirst({ where: { tenantId, code: "DAT" }, select: { id: true } })) ? "DAT-SPOL" : "DAT";
  const c = await client.sysCompany.create({ data: { tenantId, code, name: "Společná data", currency: "CZK", country: "CZ", vatPayer: true, virtual: true, dat: true } });
  await enableCompanyModules(tenantId, c.id, mods, client);
  return c.id;
}

/** Id firmy DAT (null = tenant DAT nemá). */
export async function datCompanyId(s: Session): Promise<string | null> {
  return (await s.tx.sysCompany.findFirst({ where: { tenantId: s.ctx.tenantId, dat: true }, select: { id: true } }))?.id ?? null;
}

const objectsOf = (moduleIds: Iterable<string>) => [...moduleIds].flatMap((m) => registry.modules.get(m)?.objects ?? []);
const moduleOf = (objectId: string) => [...registry.modules.values()].find((m) => m.objects.some((o) => o.id === objectId))?.id ?? null;
/** Vlastní řádky číselníku (formát výpisu → pole), které se kopírují s ním. */
const ownedLines = (def: ObjectDef) => (def.lines ?? []).filter((l) => l.owned !== false).map((l) => ({ def: registry.objects.get(l.object)!, field: l.field }));
const keyField = (def: ObjectDef) => def.unique?.[0]?.[0] ?? "code";

/** Hodnoty k převzetí: bez systémových polí a odkazů na data jednotlivých firem. */
function templateValues(def: ObjectDef, rec: RecordData, skip: string[] = []): RecordData {
  const out: RecordData = {};
  for (const [name, f] of Object.entries(def.fields)) {
    const v = rec[name];
    if (v === null || v === undefined || f.readOnly || f.secret || skip.includes(name)) continue;
    if (f.edt.kind === "ref") {
      const target = f.edt.refObject ? registry.objects.get(f.edt.refObject) : undefined;
      if (!target || target.scope !== "tenant") continue;
    }
    out[name] = v;
  }
  return out;
}

/** Kopie záznamu DAT do firmy (s vlastními řádky); `copyId` = existující kopie k přepsání. */
async function writeCopy(target: Session, dat: Session, def: ObjectDef, src: RecordData, copyId: string | null) {
  const api = target.api();
  const values = { ...templateValues(def, src), datSourceId: String(src.id), datLocal: false };
  const copy = copyId ? await api.update(def.id, copyId, values) : await api.create(def.id, values);
  for (const l of ownedLines(def)) {
    if (copyId) for (const old of await api.find(l.def.id, { [l.field]: copyId }, { take: 5000 })) await api.remove(l.def.id, String(old.id));
    for (const row of await dat.api().find(l.def.id, { [l.field]: String(src.id) }, { take: 5000 })) {
      await api.create(l.def.id, { ...templateValues(l.def, row, [l.field]), [l.field]: String(copy.id) });
    }
  }
}

/**
 * Zapnutí modulů ve firmě (i nová firma): parametry a běžné číselníky z DAT — jen chybějící.
 * Volá se před výchozím nastavením modulů, které pak existující záznamy nepřepisuje.
 */
export async function copyDatTemplates(s: Session, moduleIds: Iterable<string>): Promise<number> {
  const companyId = s.ctx.companyId;
  if (!companyId) return 0;
  const datId = await datCompanyId(s);
  if (!datId || datId === companyId) return 0;
  const target = s.forCompany(companyId);
  const own = target.api();
  const dat = s.forCompany(datId);
  let n = 0;
  for (const def of objectsOf(moduleIds)) {
    // číselník sdílený ve virtuální společnosti: data jsou v nosné firmě, DAT se nepoužije
    if (s.ctx.shared?.[def.id]) continue;
    if (def.datTemplate) {
      const [tpl] = await dat.api().find(def.id, {}, { take: 1 }).catch(() => []);
      if (tpl && !(await own.find(def.id, {}, { take: 1 })).length) {
        await own.create(def.id, templateValues(def, tpl));
        n++;
      }
    }
    if (def.datLayer) {
      const key = keyField(def);
      const have = new Set((await own.find(def.id, {}, { take: 10000 })).map((r) => String(r[key])));
      for (const src of await dat.api().find(def.id, {}, { take: 10000 }).catch(() => [])) {
        if (have.has(String(src[key]))) continue;
        await writeCopy(target, dat, def, src, null);
        n++;
      }
    }
  }
  return n;
}

/**
 * Uložení číselníku v DAT → firmy s modulem: chybějící kód doplnit, neupravenou kopii přepsat.
 * Uložení řádku (pole formátu výpisu) propíše celý nadřazený číselník.
 */
export async function propagateDat(s: Session, def: ObjectDef, rec: RecordData): Promise<void> {
  const parent = def.datLayer ? { def, id: String(rec.id) } : datParentOf(def, rec);
  if (!parent) return;
  const datId = s.ctx.companyId;
  const mod = moduleOf(parent.def.id);
  if (!datId || !mod) return;
  const dat = s.forCompany(datId);
  const src = await dat.api().get(parent.def.id, parent.id);
  if (!src) return;
  const key = keyField(parent.def);
  const companies = await s.tx.sysCompany.findMany({ where: { tenantId: s.ctx.tenantId, virtual: false }, select: { id: true } });
  const withModule = new Set(
    (await s.tx.sysCompanyModule.findMany({ where: { tenantId: s.ctx.tenantId, moduleId: mod, companyId: { in: companies.map((c) => c.id) } }, select: { companyId: true } })).map((m) => m.companyId),
  );
  for (const c of companies) {
    if (!withModule.has(c.id)) continue;
    const target = s.forCompany(c.id);
    if (await target.isSharedVirtually(parent.def.id)) continue;
    const api = target.api();
    const [copy] = await api.find(parent.def.id, { datSourceId: parent.id }, { take: 1 });
    if (copy) {
      if (!copy.datLocal) await writeCopy(target, dat, parent.def, src, String(copy.id));
      continue;
    }
    // firma má vlastní záznam se stejným kódem → má přednost, nic se nedoplní
    if ((await api.find(parent.def.id, { [key]: src[key] }, { take: 1 })).length) continue;
    await writeCopy(target, dat, parent.def, src, null);
  }
}

/** Řádek číselníku DAT (pole formátu výpisu) → nadřazený číselník. */
function datParentOf(def: ObjectDef, rec: RecordData): { def: ObjectDef; id: string } | null {
  for (const p of registry.objects.values()) {
    if (!p.datLayer) continue;
    const l = (p.lines ?? []).find((x) => x.object === def.id && x.owned !== false);
    if (l && rec[l.field]) return { def: p, id: String(rec[l.field]) };
  }
  return null;
}

/** Úprava kopie ve firmě (i jejího řádku) = vlastní záznam firmy, změny z DAT ho už nepřepíší. */
export async function markDatLocal(s: Session, def: ObjectDef, rec: RecordData): Promise<void> {
  const parent = def.datLayer ? { def, id: String(rec.id) } : datParentOf(def, rec);
  if (!parent) return;
  const row = await s.api().get(parent.def.id, parent.id);
  if (row?.datSourceId && !row.datLocal) await s.forCompany(String(s.ctx.companyId)).api().update(parent.def.id, parent.id, { datLocal: true });
}

/**
 * Naplnit Společná data z firmy (Organizace → firma → Naplnit DAT): parametry a běžné číselníky, které DAT ještě nemá,
 * se zkopírují do DAT a záznamy firmy se na ně napojí (další změny v DAT se do nich propíšou). Ostatní firmy se nemění.
 */
export async function fillDatFrom(s: Session, company: RecordData): Promise<{ count: number }> {
  if (company.virtual || company.dat) throw new UserError("@SYS:InvalidValue");
  const tenantId = s.ctx.tenantId;
  let datId = await datCompanyId(s);
  if (!datId) {
    const code = (await s.tx.sysCompany.findFirst({ where: { tenantId, code: "DAT" }, select: { id: true } })) ? "DAT-SPOL" : "DAT";
    datId = (await s.tx.sysCompany.create({ data: { tenantId, code, name: "Společná data", currency: "CZK", country: "CZ", vatPayer: true, virtual: true, dat: true } })).id;
  }
  const srcCompany = String(company.id);
  const mods = (await s.tx.sysCompanyModule.findMany({ where: { tenantId, companyId: srcCompany }, select: { moduleId: true } })).map((m) => m.moduleId);
  // DAT má aspoň moduly zdrojové firmy (formuláře parametrů a číselníků)
  await s.tx.sysCompanyModule.createMany({ data: mods.map((moduleId) => ({ tenantId, companyId: datId!, moduleId })), skipDuplicates: true });
  const src = s.forCompany(srcCompany);
  const dat = s.forCompany(datId);
  let count = 0;
  for (const def of objectsOf(mods)) {
    if (await src.isSharedVirtually(def.id)) continue;
    if (def.datTemplate) {
      const [p] = await src.api().find(def.id, {}, { take: 1 });
      if (p && !(await dat.api().find(def.id, {}, { take: 1 })).length) {
        await dat.api().create(def.id, templateValues(def, p));
        count++;
      }
    }
    if (def.datLayer) {
      const key = keyField(def);
      const have = new Set((await dat.api().find(def.id, {}, { take: 10000 })).map((r) => String(r[key])));
      for (const row of await src.api().find(def.id, {}, { take: 10000 })) {
        if (have.has(String(row[key]))) continue;
        const created = await dat.api().create(def.id, templateValues(def, row));
        for (const l of ownedLines(def))
          for (const line of await src.api().find(l.def.id, { [l.field]: String(row.id) }, { take: 5000 }))
            await dat.api().create(l.def.id, { ...templateValues(l.def, line, [l.field]), [l.field]: String(created.id) });
        // záznam firmy = neupravená kopie nového záznamu DAT
        await src.api().update(def.id, String(row.id), { datSourceId: String(created.id), datLocal: false });
        count++;
      }
    }
  }
  return { count };
}
