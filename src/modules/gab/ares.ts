/**
 * ARES (Administrativní registr ekonomických subjektů, ares.gov.cz) — veřejná
 * služba bez přihlášení. Dohledá subjekt podle IČO (nebo jednoznačně podle
 * názvu) a doplní obchodní jméno, DIČ, právní formu a adresu sídla.
 */
import { UserError, type DataApi, type ObjectHandlers, type RecordData } from "@/core/module";

const API = "https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty";

export interface AresSubject {
  ico: string;
  name: string;
  vatId: string | null;
  /** fyzická osoba (podnikatel) */
  person: boolean;
  street: string | null;
  city: string | null;
  zipCode: string | null;
  country: string;
  closed: boolean;
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
    city: (s.nazevObce as string) ?? null,
    zipCode: psc ? `${psc.slice(0, 3)} ${psc.slice(3)}` : null,
    country: String(s.kodStatu ?? "CZ"),
    closed: !!d.datumZaniku,
  };
}

export async function aresByIco(ico: string): Promise<AresSubject | null> {
  const clean = ico.replace(/\s/g, "").padStart(8, "0");
  if (!/^\d{8}$/.test(clean)) throw new UserError("@SYS:InvalidRegNo");
  const res = await fetch(`${API}/${clean}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new UserError("@GAB:AresUnavailable", { status: String(res.status) });
  return toSubject((await res.json()) as RecordData);
}

export async function aresSearch(name: string, limit = 10): Promise<{ total: number; items: AresSubject[] }> {
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

/** Doplní subjekt a jeho adresu sídla z ARES (podle IČO, jinak jednoznačně podle názvu). */
export async function fillFromAres(data: DataApi, subjectId: string) {
  const subj = await data.get("gab.subject", subjectId);
  if (!subj) throw new UserError("@SYS:NotFound");
  let a: AresSubject | null;
  if (subj.regNo) {
    a = await aresByIco(String(subj.regNo));
    if (!a) throw new UserError("@GAB:AresNotFound", { query: String(subj.regNo) });
  } else {
    const r = await aresSearch(String(subj.name), 2);
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
  return a;
}

export const aresHandlers: Record<string, ObjectHandlers> = {
  "gab.subject": {
    actions: {
      async ares(ctx, subj) {
        await fillFromAres(ctx.data, String(subj.id));
      },
    },
  },
};
