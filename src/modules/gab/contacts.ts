/**
 * Kontakty subjektu (jako elektronické adresy v AX): druh (e-mail, telefon, mobil, web, fax, jiné), účel a příznak
 * Hlavní. Hlavní e-mail / telefon se propisuje do subjektu (`gab.subject.email` / `phone` – z něj berou adresu doklady,
 * pošta a portály) a naopak: e-mail nebo telefon zadaný na subjektu (ručně, importem, z portálu) založí kontakt.
 */
import { UserError, type DataApi, type ObjectHandlers, type RecordData, type ValidationErrors } from "@/core/module";

/** Skupina druhu pro pole subjektu: e-mail → email, telefon / mobil → phone. */
const groupOf = (kind: unknown): "email" | "phone" | null => (kind === "email" ? "email" : kind === "phone" || kind === "mobile" ? "phone" : null);
const kindsOf = (g: "email" | "phone") => (g === "email" ? ["email"] : ["phone", "mobile"]);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalize(kind: unknown, v: unknown): string {
  const s = String(v ?? "").trim();
  if (kind === "email") return s.toLowerCase();
  if (kind === "phone" || kind === "mobile" || kind === "fax") return s.replace(/\s+/g, " ");
  return s;
}

/** Hodnota pole subjektu z hlavního kontaktu skupiny (jinak prvního), nebo null. */
async function syncSubject(data: DataApi, subjectId: string, g: "email" | "phone") {
  const list = await data.find("gab.contact", { subjectId, kind: { in: kindsOf(g) } }, { take: 50, orderBy: { createdAt: "asc" } });
  const main = list.find((c) => c.isPrimary) ?? list[0] ?? null;
  const subj = await data.get("gab.subject", subjectId);
  if (!subj) return;
  const v = main ? String(main.value) : null;
  if ((subj[g] ?? null) !== v) await data.update("gab.subject", subjectId, { [g]: v });
}

/** Kontakt pro e-mail / telefon subjektu, když ještě není (subjekt z importu, portálu, ARES). */
export async function ensureSubjectContacts(data: DataApi, subj: RecordData) {
  for (const g of ["email", "phone"] as const) {
    const v = normalize(g, subj[g]);
    if (!v) continue;
    const list = await data.find("gab.contact", { subjectId: subj.id, kind: { in: kindsOf(g) } }, { take: 50 });
    if (list.some((c) => normalize(c.kind, c.value) === v)) continue;
    await data.create("gab.contact", { subjectId: subj.id, kind: g, value: v, purpose: "business", isPrimary: true });
  }
}

/**
 * Výchozí nastavení: subjekty s e-mailem / telefonem bez kontaktu ho dostanou (jednorázově, další běh nic
 * nenajde). Hromadně: kontakty jednou za běh, ne za subjekt.
 */
export async function contactSetup(data: DataApi) {
  const subjects = (await data.find("gab.subject", {}, { take: 50000 })).filter((x) => x.email || x.phone);
  if (!subjects.length) return;
  const have = new Map<string, Set<string>>();
  for (const c of await data.find("gab.contact", {}, { take: 100000 })) {
    const k = String(c.subjectId);
    if (!have.has(k)) have.set(k, new Set());
    have.get(k)!.add(`${groupOf(c.kind)}|${normalize(c.kind, c.value)}`);
  }
  for (const subj of subjects)
    for (const g of ["email", "phone"] as const) {
      const v = normalize(g, subj[g]);
      if (!v || have.get(String(subj.id))?.has(`${g}|${v}`)) continue;
      if (g === "email" && !EMAIL.test(v)) continue;
      if (g === "phone" && v.replace(/\D/g, "").length < 6) continue;
      await data.create("gab.contact", { subjectId: subj.id, kind: g, value: v, purpose: "business", isPrimary: true });
    }
}

export const contactHandlers: Record<string, ObjectHandlers> = {
  "gab.contact": {
    async beforeSave(_ctx, d): Promise<ValidationErrors | void> {
      d.value = normalize(d.kind, d.value);
      if (!d.value) return { value: "@SYS:Required" };
      if (d.kind === "email" && !EMAIL.test(String(d.value))) return { value: "@SYS:InvalidEmail" };
      if ((d.kind === "phone" || d.kind === "mobile" || d.kind === "fax") && String(d.value).replace(/\D/g, "").length < 6) return { value: "@SYS:InvalidValue" };
    },
    async afterSave(ctx, d) {
      const g = groupOf(d.kind);
      // jeden hlavní kontakt ve skupině (e-mail; telefon + mobil)
      if (d.isPrimary && g)
        for (const c of await ctx.data.find("gab.contact", { subjectId: d.subjectId, kind: { in: kindsOf(g) }, isPrimary: true }, { take: 50 }))
          if (c.id !== d.id) await ctx.data.update("gab.contact", String(c.id), { isPrimary: false });
      for (const x of ["email", "phone"] as const) await syncSubject(ctx.data, String(d.subjectId), x);
    },
    async afterDelete(ctx, d) {
      const g = groupOf(d.kind);
      if (g) await syncSubject(ctx.data, String(d.subjectId), g);
    },
  },
  "gab.subject": {
    async afterSave(ctx, d) {
      try {
        await ensureSubjectContacts(ctx.data, d);
      } catch (e) {
        if (!(e instanceof UserError)) throw e; // neplatný starší údaj kontakt nezaloží
      }
    },
  },
};
