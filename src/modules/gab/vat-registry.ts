/**
 * Registr plátců DPH (Finanční správa, rozhraní CRPDPH — veřejné, bez klíče):
 * spolehlivost plátce a zveřejněné bankovní účty. Volá se přes datovou
 * službu „dphreg“ (Integrace) — log, vypnutí, test.
 *
 * Výsledek se ukládá k subjektu adresáře (Spolehlivost DPH, Ověřeno, FÚ)
 * a zveřejněné účty do jedné tabulky bankovních účtů subjektů (gab.bankAccount).
 */
import { UserError, type DataApi, type RecordData } from "@/core/module";
import { withService } from "@/modules/int/services";

const URL = "https://adisrws.mfcr.cz/dpr/axis2/services/rozhraniCRPDPH.rozhraniCRPDPHSOAP";

export interface VatPayerStatus {
  dic: string;
  reliability: "reliable" | "unreliable" | "notFound";
  taxOffice: string | null;
  accounts: { accountNum: string | null; iban: string | null; publishedAt: string | null }[];
}

/** DIČ bez předpony CZ (registr chce jen číslice). */
export const czDic = (vatId: unknown): string | null => {
  const m = /^(?:CZ)?(\d{8,10})$/i.exec(String(vatId ?? "").replace(/\s/g, ""));
  return m ? m[1] : null;
};

const attr = (tag: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? null;

/** Dotaz na až 100 DIČ najednou. */
export async function vatRegistryStatus(dics: string[], fetchImpl: typeof fetch = fetch): Promise<Map<string, VatPayerStatus>> {
  const list = [...new Set(dics)].slice(0, 100);
  const body =
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:roz="http://adis.mfcr.cz/rozhraniCRPDPH/"><soapenv:Header/><soapenv:Body>' +
    `<roz:StatusNespolehlivyPlatceRozsirenyRequest>${list.map((d) => `<roz:dic>${d}</roz:dic>`).join("")}</roz:StatusNespolehlivyPlatceRozsirenyRequest>` +
    "</soapenv:Body></soapenv:Envelope>";
  const res = await fetchImpl(URL, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: '"getStatusNespolehlivyPlatceRozsireny"' },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const xml = await res.text();
  if (!res.ok || !/statusCode="0"/.test(xml)) throw new UserError("@GAB:VatRegistryFailed", { reason: (/statusText="([^"]*)"/.exec(xml)?.[1] ?? `HTTP ${res.status}`).slice(0, 120) });
  const out = new Map<string, VatPayerStatus>();
  for (const m of xml.matchAll(/<statusPlatceDPH\b([^>]*?)(\/>|>([\s\S]*?)<\/statusPlatceDPH>)/g)) {
    const head = m[1];
    const dic = attr(head, "dic") ?? "";
    const flag = attr(head, "nespolehlivyPlatce");
    const accounts: VatPayerStatus["accounts"] = [];
    for (const u of (m[3] ?? "").matchAll(/<ucet\b([^>]*)>([\s\S]*?)<\/ucet>/g)) {
      const publishedAt = attr(u[1], "datumZverejneni");
      const std = /<standardniUcet\b([^>]*)\/?>/.exec(u[2]);
      const non = /<nestandardniUcet\b([^>]*)\/?>/.exec(u[2]);
      if (std) {
        const pre = attr(std[1], "predcisli");
        accounts.push({ accountNum: `${pre ? `${pre}-` : ""}${attr(std[1], "cislo")}/${attr(std[1], "kodBanky")}`, iban: null, publishedAt });
      } else if (non) accounts.push({ accountNum: null, iban: attr(non[1], "cislo"), publishedAt });
    }
    out.set(dic, { dic, reliability: flag === "ANO" ? "unreliable" : flag === "NE" ? "reliable" : "notFound", taxOffice: attr(head, "cisloFu"), accounts });
  }
  return out;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Výsledek registru k subjektu: spolehlivost a zveřejněné účty (ručně zadané účty zůstanou). */
export async function applyVatStatus(data: DataApi, subject: RecordData, st: VatPayerStatus | undefined) {
  await data.update("gab.subject", String(subject.id), {
    vatReliability: st?.reliability ?? "notFound",
    vatCheckedAt: today(),
    taxOffice: st?.taxOffice ?? null,
  });
  if (!st) return;
  const existing = await data.find("gab.bankAccount", { subjectId: subject.id }, { take: 500 });
  const key = (a: { accountNum?: unknown; iban?: unknown }) => String(a.accountNum || a.iban || "").replace(/\s/g, "").toUpperCase();
  const seen = new Set<string>();
  for (const a of st.accounts) {
    const k = key(a);
    if (!k) continue;
    seen.add(k);
    const have = existing.find((e) => key(e) === k);
    if (have) await data.update("gab.bankAccount", String(have.id), { published: true, publishedAt: a.publishedAt });
    else await data.create("gab.bankAccount", { subjectId: subject.id, accountNum: a.accountNum, iban: a.iban, published: true, publishedAt: a.publishedAt, source: "vatRegistry" });
  }
  // účet, který už v registru není, přestává být zveřejněný
  for (const e of existing) if (e.published && !seen.has(key(e))) await data.update("gab.bankAccount", String(e.id), { published: false });
}

/** Ověřit subjekt v registru plátců DPH (akce i po doplnění z ARES). */
export async function checkSubjectVat(data: DataApi, subjectId: string): Promise<VatPayerStatus | null> {
  const subj = await data.get("gab.subject", subjectId);
  if (!subj) throw new UserError("@SYS:NotFound");
  const dic = czDic(subj.vatId);
  if (!dic || (subj.country && subj.country !== "CZ")) throw new UserError("@GAB:VatRegistryNoDic");
  const map = await withService(data, "dphreg", "dphreg.status", () => vatRegistryStatus([dic]), (m) => `${dic}: ${m.get(dic)?.reliability ?? "notFound"}`);
  await applyVatStatus(data, subj, map.get(dic));
  return map.get(dic) ?? null;
}

/** Dávka: ověří subjekty s českým DIČ (nejdéle neověřené první), po stovkách. */
export async function checkAllSubjectsVat(data: DataApi, limit = 500): Promise<{ checked: number; unreliable: number }> {
  const all = (await data.find("gab.subject", {}, { take: 20000 })).filter((s) => czDic(s.vatId) && (!s.country || s.country === "CZ"));
  all.sort((a, b) => String(a.vatCheckedAt ?? "").localeCompare(String(b.vatCheckedAt ?? "")));
  const todo = all.slice(0, limit);
  let unreliable = 0;
  for (let i = 0; i < todo.length; i += 100) {
    const chunk = todo.slice(i, i + 100);
    const map = await withService(data, "dphreg", "dphreg.batch", () => vatRegistryStatus(chunk.map((s) => czDic(s.vatId)!)), (m) => `${m.size} DIČ`);
    for (const s of chunk) {
      const st = map.get(czDic(s.vatId)!);
      if (st?.reliability === "unreliable") unreliable++;
      await applyVatStatus(data, s, st);
    }
  }
  return { checked: todo.length, unreliable };
}
