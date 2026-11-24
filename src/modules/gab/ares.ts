/**
 * ARES (Administrativní registr ekonomických subjektů, ares.gov.cz) — veřejná
 * služba bez přihlášení. Dohledá subjekt podle IČO (nebo jednoznačně podle
 * názvu) a doplní obchodní jméno, DIČ, právní formu a adresu sídla.
 */
import { checkSubjectVat, czDic } from "./vat-registry";
import { UserError, type DataApi, type RecordData } from "@/core/module";
import { withService } from "@/modules/int/services";

const API = "https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty";

export interface AresSubject {
  ico: string;
  name: string;
  vatId: string | null;
  /** fyzická osoba (podnikatel) */
  person: boolean;
  street: string | null;
  /** ulice (nebo část obce), číslo popisné a orientační zvlášť */
  streetName: string | null;
  houseNo: string | null;
  orientNo: string | null;
  city: string | null;
  zipCode: string | null;
  country: string;
  closed: boolean;
  /** spisová značka ve veřejném rejstříku („C 327865/MSPH“), když ji ARES uvádí */
  fileRef?: string | null;
}

/** Kódy právních forem fyzických osob (číselník ČSÚ 149). */
const PERSON_FORMS = new Set(["100", "101", "102", "103", "104", "105", "106", "107", "108"]);

function toSubject(d: RecordData): AresSubject {
  const s = (d.sidlo ?? {}) as RecordData;
  const num = [s.cisloDomovni, s.cisloOrientacni ? `${s.cisloOrientacni}${s.cisloOrientacniPismeno ?? ""}` : null].filter(Boolean).join("/");
  const streetName = (s.nazevUlice ?? s.nazevCastiObce ?? "") as string;
  const psc = s.psc ? String(s.psc).padStart(5, "0") : null;
  return {
    ico: String(d.ico),
    name: String(d.obchodniJmeno ?? ""),
    vatId: (d.dic as string) ?? null,
    person: PERSON_FORMS.has(String(d.pravniForma ?? "")),
    street: `${streetName} ${num}`.trim() || null,
    streetName: streetName || null,
    houseNo: s.cisloDomovni ? String(s.cisloDomovni) : null,
    orientNo: s.cisloOrientacni ? `${s.cisloOrientacni}${s.cisloOrientacniPismeno ?? ""}` : null,
    city: (s.nazevObce as string) ?? null,
    zipCode: psc ? `${psc.slice(0, 3)} ${psc.slice(3)}` : null,
    country: String(s.kodStatu ?? "CZ"),
    closed: !!d.datumZaniku,
    fileRef: (((d.dalsiUdaje ?? []) as RecordData[]).find((x) => x.spisovaZnacka)?.spisovaZnacka as string) ?? null,
  };
}

async function aresByIcoRaw(ico: string): Promise<AresSubject | null> {
  const clean = ico.replace(/\s/g, "").padStart(8, "0");
  if (!/^\d{8}$/.test(clean)) throw new UserError("@SYS:InvalidRegNo");
  const res = await fetch(`${API}/${clean}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new UserError("@GAB:AresUnavailable", { status: String(res.status) });
  return toSubject((await res.json()) as RecordData);
}

async function aresSearchRaw(name: string, limit = 10): Promise<{ total: number; items: AresSubject[] }> {
  const res = await fetch(`${API}/vyhledat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ obchodniJmeno: name, start: 0, pocet: limit }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new UserError("@GAB:AresUnavailable", { status: String(res.status) });
  const d = (await res.json()) as RecordData;
  return { total: Number(d.pocetCelkem ?? 0), items: ((d.ekonomickeSubjekty as RecordData[]) ?? []).map(toSubject) };
}

/** ARES podle IČO; s `data` přes napojení v Integraci (log, vypnutí). */
export function aresByIco(ico: string, data?: DataApi): Promise<AresSubject | null> {
  return data ? withService(data, "ares", "ares.ico", () => aresByIcoRaw(ico), (r) => (r ? `${r.ico} ${r.name}` : `${ico}: nenalezeno`)) : aresByIcoRaw(ico);
}

export function aresSearch(name: string, limit = 10, data?: DataApi): Promise<{ total: number; items: AresSubject[] }> {
  return data ? withService(data, "ares", "ares.search", () => aresSearchRaw(name, limit), (r) => `${name}: ${r.total}`) : aresSearchRaw(name, limit);
}

/** Činnosti subjektu podle CZ-NACE z Registru ekonomických subjektů (RES). */
export interface AresNace {
  /** převažující činnost („46900“) */
  main: string | null;
  /** všechny uvedené činnosti (i převažující) */
  codes: string[];
  /** kód → název z číselníku CZ-NACE */
  names: Map<string, string>;
}

const CODELIST = "https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ciselniky-nazevniky/vyhledat";
let naceNames: Promise<Map<string, string>> | null = null;

/** Číselník CZ-NACE z ARES (platné položky, česky) — jednou za běh serveru. */
function naceCodelist(): Promise<Map<string, string>> {
  naceNames ??= (async () => {
    const res = await fetch(CODELIST, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ kodCiselniku: "CzNace", zdrojCiselniku: "res" }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new UserError("@GAB:AresUnavailable", { status: String(res.status) });
    const d = (await res.json()) as { ciselniky?: { polozkyCiselniku?: { kod: string; nazev?: { kodJazyka: string; nazev: string }[]; platnostDo?: string }[] }[] };
    const today = new Date().toISOString().slice(0, 10);
    const map = new Map<string, string>();
    for (const p of d.ciselniky?.[0]?.polozkyCiselniku ?? []) {
      if (p.platnostDo && p.platnostDo < today) continue;
      const name = p.nazev?.find((n) => n.kodJazyka === "cs")?.nazev;
      if (name) map.set(p.kod, name);
    }
    return map;
  })().catch((e) => {
    naceNames = null; // výpadek: příště zkusit znovu
    throw e;
  });
  return naceNames;
}

async function aresNaceRaw(ico: string): Promise<AresNace | null> {
  const clean = ico.replace(/\s/g, "").padStart(8, "0");
  const res = await fetch(`${API}-res/${clean}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new UserError("@GAB:AresUnavailable", { status: String(res.status) });
  const d = (await res.json()) as { zaznamy?: RecordData[] };
  const rec = d.zaznamy?.find((z) => z.primarniZaznam) ?? d.zaznamy?.[0];
  if (!rec) return null;
  const main = (rec.czNacePrevazujici as string) || null;
  const codes = [...new Set([...(main ? [main] : []), ...((rec.czNace as string[]) ?? [])])];
  const names = await naceCodelist().catch(() => new Map<string, string>());
  return { main, codes, names };
}

/** CZ-NACE subjektu (RES); s `data` přes napojení ARES v Integraci. */
export function aresNace(ico: string, data?: DataApi): Promise<AresNace | null> {
  return data ? withService(data, "ares", "ares.nace", () => aresNaceRaw(ico), (r) => `${ico}: ${r?.main ?? "-"}`) : aresNaceRaw(ico);
}

/** Pole organizace z CZ-NACE: převažující kód, jeho název a ostatní činnosti po řádcích („28 Výroba strojů…“). */
export function naceFields(n: AresNace): { naceCode: string | null; naceName: string | null; naceOther: string | null } {
  const line = (c: string) => `${c} ${n.names.get(c) ?? ""}`.trim();
  const other = n.codes.filter((c) => c !== n.main);
  return {
    naceCode: n.main,
    naceName: n.main ? (n.names.get(n.main) ?? null) : null,
    naceOther: other.length ? other.map(line).join("\n") : null,
  };
}

/** Doplní subjekt a jeho adresu sídla z ARES (podle IČO, jinak jednoznačně podle názvu). */
export async function fillFromAres(data: DataApi, subjectId: string) {
  const subj = await data.get("gab.subject", subjectId);
  if (!subj) throw new UserError("@SYS:NotFound");
  let a: AresSubject | null;
  if (subj.regNo) {
    a = await aresByIco(String(subj.regNo), data);
    if (!a) throw new UserError("@GAB:AresNotFound", { query: String(subj.regNo) });
  } else {
    const r = await aresSearch(String(subj.name), 2, data);
    if (r.total !== 1) throw new UserError(r.total ? "@GAB:AresAmbiguous" : "@GAB:AresNotFound", { query: String(subj.name), n: String(r.total) });
    a = r.items[0];
  }
  await data.update("gab.subject", subjectId, {
    name: a.name,
    regNo: a.ico,
    vatId: a.vatId,
    type: a.person ? "person" : "organization",
    country: a.country,
  });
  if (a.city) {
    const [addr] = await data.find("gab.address", { subjectId, kind: "registered" }, { take: 1 });
    const values = { subjectId, kind: "registered", street: a.street, city: a.city, zipCode: a.zipCode, country: a.country };
    if (addr) await data.update("gab.address", String(addr.id), values);
    else await data.create("gab.address", values);
  }
  // plátce DPH: spolehlivost a zveřejněné účty (výpadek registru doplnění z ARES nezastaví)
  if (czDic(a.vatId)) await checkSubjectVat(data, subjectId).catch(() => null);
  return a;
}

/** Tituly před a za jménem (Bc., Ing., Ph.D., MBA…) — nepatří do jména ani příjmení. */
const TITLE = /^(bc|bca|ing|ing\. arch|mgr|mga|judr|mudr|mvdr|mddr|phdr|rndr|paeddr|thdr|thlic|doc|prof|dr|ph\.?d|csc|drsc|dis|mba|msc|bsc|ma|ba|llm|dba)\.?,?$/i;

/** Jméno fyzické osoby z rejstříku („Bc. Václav Král, MBA“) → jméno a příjmení bez titulů. */
export function splitPersonName(full: string): { firstName: string | null; lastName: string | null } {
  const words = full.split(/\s+/).map((w) => w.replace(/,$/, "")).filter((w) => w && !TITLE.test(w));
  return { firstName: words[0] ?? null, lastName: words.slice(1).join(" ") || null };
}
