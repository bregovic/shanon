/**
 * Virtuální společnosti — pravidla a osamostatnění firmy (jádro datové
 * služby, volá ho Session.save / Session.action).
 *
 * - založení virtuální společnosti vytvoří skrytou nosnou firmu (sys.company.virtual)
 * - firmu i číselník lze přidat jen, když firma nemá v číselníku vlastní data
 *   a nesdílí ho už v jiné virtuální společnosti
 * - Osamostatnit: sdílená data se zkopírují do firmy, její doklady a číselníky
 *   se přepojí na kopie, firma z virtuální společnosti vypadne
 */
import { UserError, type RecordData } from "@/core/module";
import type { ObjectDef } from "@/core/object";
import { registry } from "@/registry";
import type { Session } from "./data";
import { getObject } from "./data";

type Delegate = {
  count(a: unknown): Promise<number>;
  findMany(a: unknown): Promise<RecordData[]>;
  create(a: unknown): Promise<RecordData>;
  updateMany(a: unknown): Promise<{ count: number }>;
};
const model = (s: Session, def: ObjectDef) => (s.tx as unknown as Record<string, Delegate>)[def.table.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())];

async function companyLabel(s: Session, id: string) {
  const c = await s.tx.sysCompany.findFirst({ where: { id }, select: { code: true } });
  return c?.code ?? id;
}

/** Vlastní záznamy firmy v objektu (ne sdílené). */
const ownRows = (s: Session, objectId: string, companyId: string) => model(s, getObject(objectId)).count({ where: { tenantId: s.ctx.tenantId, companyId } });

async function assertShareable(s: Session, virtualCompanyId: string, companyIds: string[], objectIds: string[]) {
  const t = (ref: string, p: Record<string, string>) => ({ ref, p });
  for (const companyId of companyIds) {
    for (const objectId of objectIds) {
      // jiná virtuální společnost, kde firma sdílí stejný číselník
      const other = await s.tx.sysVirtualShare.findFirst({
        where: { tenantId: s.ctx.tenantId, objectId, virtualCompanyId: { not: virtualCompanyId }, virtualCompany: { sysVirtualMember_virtualCompany: { some: { memberCompanyId: companyId } } } },
      });
      if (other) {
        const e = t("@SYS:ShareConflict", { company: await companyLabel(s, companyId), object: getObject(objectId).labelPlural });
        throw new UserError(e.ref, e.p);
      }
      if ((await ownRows(s, objectId, companyId)) > 0) throw new UserError("@SYS:ShareHasData", { company: await companyLabel(s, companyId), object: getObject(objectId).labelPlural });
    }
  }
}

/** Kontroly a doplnění při ukládání virtuální společnosti, člena a sdíleného číselníku. */
export async function virtualBeforeSave(s: Session, objectId: string, d: RecordData, isNew: boolean): Promise<void> {
  if (objectId === "sys.virtualCompany" && isNew) {
    // skrytá nosná firma pro sdílená data
    const holder = await s.tx.sysCompany.create({
      data: { tenantId: s.ctx.tenantId, code: `V-${String(d.code)}`.slice(0, 20), name: String(d.name ?? d.code).slice(0, 120), currency: "CZK", country: "CZ", vatPayer: false, virtual: true },
    });
    d.holderCompanyId = holder.id;
  }
  if (objectId === "sys.virtualMember") {
    const c = await s.tx.sysCompany.findFirst({ where: { id: String(d.memberCompanyId), tenantId: s.ctx.tenantId } });
    if (!c || c.virtual) throw new UserError("@SYS:VirtualNotMember");
    const shares = await s.tx.sysVirtualShare.findMany({ where: { tenantId: s.ctx.tenantId, virtualCompanyId: String(d.virtualCompanyId) }, select: { objectId: true } });
    await assertShareable(s, String(d.virtualCompanyId), [String(d.memberCompanyId)], shares.map((x) => x.objectId));
  }
  if (objectId === "sys.virtualShare") {
    if (!registry.objects.get(String(d.objectId))?.shareable) throw new UserError("@SYS:InvalidValue");
    const members = await s.tx.sysVirtualMember.findMany({ where: { tenantId: s.ctx.tenantId, virtualCompanyId: String(d.virtualCompanyId) }, select: { memberCompanyId: true } });
    await assertShareable(s, String(d.virtualCompanyId), members.map((m) => m.memberCompanyId), [String(d.objectId)]);
  }
}

/** Pořadí kopírování: odkazovaný číselník před tím, kdo na něj odkazuje (subjekt → adresa). */
function ordered(objectIds: string[]): string[] {
  const out: string[] = [];
  const visit = (id: string, seen: Set<string>) => {
    if (out.includes(id) || seen.has(id)) return;
    seen.add(id);
    for (const f of Object.values(getObject(id).fields)) if (f.edt.kind === "ref" && objectIds.includes(f.edt.refObject!) && f.edt.refObject !== id) visit(f.edt.refObject!, seen);
    out.push(id);
  };
  for (const id of objectIds) visit(id, new Set());
  return out;
}

/**
 * Osamostatnit firmu: kopie sdílených dat do firmy, přepojení odkazů všech
 * jejích záznamů na kopie, odebrání z virtuální společnosti.
 */
export async function detachMember(s: Session, member: RecordData): Promise<void> {
  const tenantId = s.ctx.tenantId;
  const companyId = String(member.memberCompanyId);
  const vc = await s.tx.sysVirtualCompany.findFirst({ where: { id: String(member.virtualCompanyId), tenantId } });
  if (!vc?.holderCompanyId) throw new UserError("@SYS:NotFound");
  const shares = (await s.tx.sysVirtualShare.findMany({ where: { tenantId, virtualCompanyId: vc.id }, select: { objectId: true } })).map((x) => x.objectId);
  const objs = ordered(shares.filter((id) => registry.objects.has(id)));
  const idMap = new Map<string, Map<string, string>>(); // objekt → staré id → nové id
  const sys = new Set(["id", "tenantId", "companyId", "createdAt", "updatedAt", "version"]);
  for (const objectId of objs) {
    const def = getObject(objectId);
    const m = new Map<string, string>();
    idMap.set(objectId, m);
    for (const row of await model(s, def).findMany({ where: { tenantId, companyId: vc.holderCompanyId } })) {
      const data: RecordData = {};
      for (const [k, v] of Object.entries(row)) if (!sys.has(k)) data[k] = v;
      // odkazy uvnitř kopírovaných číselníků na jejich kopie
      for (const [name, f] of Object.entries(def.fields)) {
        const target = f.edt.kind === "ref" ? idMap.get(f.edt.refObject!) : null;
        if (target && data[name]) data[name] = target.get(String(data[name])) ?? data[name];
      }
      const copy = await model(s, def).create({ data: { ...data, tenantId, companyId } });
      m.set(String(row.id), String(copy.id));
    }
  }
  // přepojit odkazy všech záznamů firmy (doklady, číselníky) na kopie
  for (const def of registry.objects.values()) {
    if (def.scope !== "company" || objs.includes(def.id)) continue;
    for (const [name, f] of Object.entries(def.fields)) {
      const map = f.edt.kind === "ref" ? idMap.get(f.edt.refObject!) : null;
      if (!map?.size) continue;
      for (const [from, to] of map) await model(s, def).updateMany({ where: { tenantId, companyId, [name]: from }, data: { [name]: to } });
    }
  }
  await s.tx.sysVirtualMember.deleteMany({ where: { id: String(member.id), tenantId } });
}
