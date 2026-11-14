/**
 * Založení subjektu z veřejného registru: české IČO (nebo DIČ CZ + 8 číslic)
 * z ARES, zahraniční DIČ z VIES (registr plátců DPH v EU). Obě služby jdou
 * přes napojení v Integraci (log, vypnutí). Volitelně hned dodavatel a odběratel.
 */
import { UserError, type DataApi, type RecordData } from "@/core/module";
import { withService } from "@/modules/int/services";
import { aresByIco } from "./ares";

export interface RegistryHit {
  source: "ares" | "vies";
  name: string;
  regNo: string | null;
  vatId: string | null;
  person: boolean;
  street: string | null;
  /** ARES: ulice a čísla zvlášť (údaje organizace) */
  streetName?: string | null;
  houseNo?: string | null;
  orientNo?: string | null;
  city: string | null;
  zipCode: string | null;
  country: string;
  /** subjekt se stejným IČO / DIČ už v adresáři je */
  existingId: string | null;
}

const VIES = "https://ec.europa.eu/taxation_customs/vies/rest-api/ms";

/** VIES: platnost DIČ v EU, název a adresa (pokud je stát zveřejňuje). */
export async function viesLookup(cc: string, num: string, data?: DataApi): Promise<RecordData | null> {
  const call = async () => {
    const res = await fetch(`${VIES}/${cc}/vat/${encodeURIComponent(num)}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new UserError("@GAB:ViesUnavailable", { status: String(res.status) });
    const d = (await res.json()) as RecordData;
    if (d.userError && !["VALID", "INVALID"].includes(String(d.userError))) throw new UserError("@GAB:ViesUnavailable", { status: String(d.userError) });
    return d.isValid ? d : null;
  };
  return data ? withService(data, "vies", "vies.vat", call, (r) => (r ? `${cc}${num} ${r.name ?? ""}` : `${cc}${num}: neplatné`)) : call();
}

/** Rozpozná vstup a najde subjekt v ARES nebo VIES. */
export async function lookupRegistry(data: DataApi, query: string, target: "subject" | "company" = "subject"): Promise<RegistryHit | null> {
  const q = query.replace(/\s+/g, "").toUpperCase();
  const ico = /^\d{1,8}$/.test(q) ? q : /^CZ\d{8}$/.test(q) ? q.slice(2) : null;
  let hit: Omit<RegistryHit, "existingId"> | null = null;
  if (ico) {
    const a = await aresByIco(ico, data);
    if (a) hit = { source: "ares", name: a.name, regNo: a.ico, vatId: a.vatId, person: a.person, street: a.street, streetName: a.streetName, houseNo: a.houseNo, orientNo: a.orientNo, city: a.city, zipCode: a.zipCode, country: a.country };
  } else {
    const m = /^([A-Z]{2})([0-9A-Z+*.]{2,14})$/.exec(q);
    if (!m) throw new UserError("@GAB:LookupFormat");
    const cc = m[1] === "GR" ? "EL" : m[1];
    const v = await viesLookup(cc, m[2], data);
    if (v) {
      const lines = String(v.address ?? "")
        .split(/\n|,/)
        .map((x) => x.trim())
        .filter((x) => x && x !== "---");
      // poslední řádek bývá název státu (Slovensko) — bez číslic ho přeskočit
      if (lines.length > 1 && !/\d/.test(lines[lines.length - 1])) lines.pop();
      const last = lines.pop() ?? "";
      const zc = /^(\S*\d\S*)\s+(.+)$/.exec(last);
      const name = String(v.name ?? "").trim();
      hit = {
        source: "vies",
        name: name && name !== "---" ? name : `${m[1]}${m[2]}`,
        regNo: null,
        vatId: `${m[1]}${m[2]}`,
        person: false,
        street: lines.join(", ") || null,
        city: zc ? zc[2] : last || null,
        zipCode: zc ? zc[1] : null,
        country: m[1] === "EL" ? "GR" : m[1],
      };
    }
  }
  if (!hit) return null;
  // duplicita: v adresáři (subjekt), nebo mezi firmami (`target: "company"`)
  const obj = target === "company" ? "sys.company" : "gab.subject";
  let byReg: RecordData | undefined;
  let byVat: RecordData | undefined;
  try {
    [byReg] = hit.regNo ? await data.find(obj, { regNo: hit.regNo }, { take: 1 }) : [];
    [byVat] = !byReg && hit.vatId ? await data.find(obj, { vatId: hit.vatId }, { take: 1 }) : [];
  } catch {
    /* adresář není zapnutý */
  }
  return { ...hit, existingId: ((byReg ?? byVat)?.id as string) ?? null };
}

/** Dodavatel / odběratel subjektu (výchozí skupina, číslo z řady). */
export async function createPartner(data: DataApi, subjectId: string, objectId: "ap.vendor" | "ar.customer"): Promise<RecordData> {
  if ((await data.find(objectId, { subjectId }, { take: 1 })).length) throw new UserError("@GAB:PartnerExists");
  const [group] = await data.find(objectId === "ap.vendor" ? "ap.group" : "ar.group", {}, { take: 1 });
  if (!group) throw new UserError("@GAB:NoPartnerGroup");
  return data.create(objectId, { subjectId, groupId: group.id });
}

/** Údaje subjektu a sídlo z nálezu registru (aktualizace existujícího subjektu). */
async function updateSubjectFromHit(data: DataApi, id: string, hit: RegistryHit) {
  await data.update("gab.subject", id, { name: hit.name.slice(0, 120), type: hit.person ? "person" : "organization", regNo: hit.regNo, vatId: hit.vatId, country: hit.country });
  if (hit.city || hit.street) {
    const [addr] = await data.find("gab.address", { subjectId: id, kind: "registered" }, { take: 1 });
    const values = { subjectId: id, kind: "registered", street: hit.street, city: hit.city, zipCode: hit.zipCode, country: hit.country };
    if (addr) await data.update("gab.address", String(addr.id), values);
    else await data.create("gab.address", values);
  }
}

/**
 * Založí subjekt z nálezu v registru (a sídlo), případně dodavatele a odběratele.
 * Subjekt už v adresáři je → údaje se z registru aktualizují (a doplní účty z registru DPH).
 */
export async function createFromRegistry(data: DataApi, query: string, opts: { vendor?: boolean; customer?: boolean }): Promise<string> {
  const hit = await lookupRegistry(data, query);
  if (!hit) throw new UserError("@GAB:AresNotFound", { query });
  if (hit.existingId) {
    await updateSubjectFromHit(data, hit.existingId, hit);
    if (hit.vatId && /^CZ/i.test(String(hit.vatId))) {
      const { checkSubjectVat } = await import("./vat-registry");
      await checkSubjectVat(data, hit.existingId).catch(() => null);
    }
    if (opts.vendor && !(await data.find("ap.vendor", { subjectId: hit.existingId }, { take: 1 })).length) await createPartner(data, hit.existingId, "ap.vendor");
    if (opts.customer && !(await data.find("ar.customer", { subjectId: hit.existingId }, { take: 1 })).length) await createPartner(data, hit.existingId, "ar.customer");
    return hit.existingId;
  }
  const s = await data.create("gab.subject", {
    name: hit.name.slice(0, 120),
    type: hit.person ? "person" : "organization",
    regNo: hit.regNo,
    vatId: hit.vatId,
    country: hit.country,
  });
  if (hit.city || hit.street) {
    await data.create("gab.address", { subjectId: s.id, kind: "registered", street: hit.street, city: hit.city, zipCode: hit.zipCode, country: hit.country });
  }
  // plátce DPH: spolehlivost a zveřejněné účty
  if (hit.vatId && /^CZ/i.test(String(hit.vatId))) {
    const { checkSubjectVat } = await import("./vat-registry");
    await checkSubjectVat(data, String(s.id)).catch(() => null);
  }
  if (opts.vendor) await createPartner(data, String(s.id), "ap.vendor");
  if (opts.customer) await createPartner(data, String(s.id), "ar.customer");
  return String(s.id);
}
