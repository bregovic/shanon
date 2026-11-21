/**
 * Přiznání k DPH (DPHDP3) a kontrolní hlášení (DPHKH1) z daňových transakcí.
 *
 * Zdroj je tax.trans (vzniká zaúčtováním faktur) za období podle DUZP.
 * Kam která transakce patří, určuje její daňový kód — řádek přiznání
 * (`reportLine`) a sazba; nic není napsané natvrdo podle kódu.
 *
 * Pasti formátu EPO (ověřené v DMS na validátoru portálu):
 *  - Věta D přiznání: `trans` = A (jsou údaje v oddíle C, tj. řádky přiznání), N jen u prázdného přiznání —
 *    „N“ s vyplněnými částkami EPO odmítne („zaškrtnuto, že neexistují údaje pro C. ODDÍL“).
 *  - Věta D přiznání: druh daně `k_uladis="DPH"` (ne `k_uladb` — EPO ho odmítne fatální chybou);
 *    věta D hlášení (DPHKH1) má jiné atributy (`khdph_forma`).
 *  - `pomer` (krácení nároku) patří jen k přijatým plněním (B.2), ne k A.4.
 *  - Jednotlivě (A.4 / B.2) jen doklady od 10 000 Kč včetně DPH s DIČ
 *    partnera; zbytek souhrnně v A.5 / B.3 bez DIČ a čísla dokladu.
 *  - Kód úřadu a pracoviště jsou čísla z číselníku, ne ID datové schránky.
 *  - V přiznání celé koruny, v hlášení haléře.
 *  - Věta C hlášení = základy po sazbách navazující na řádky přiznání
 *    (obrat23/obrat5 = A.4+A.5, pln23/pln5 = B.2+B.3).
 */
import { fromCents, toCents } from "@/core/money";
import { UserError, type DataApi, type DownloadFile, type ObjectHandlers, type RecordData } from "@/core/module";

export const KH_LIMIT_CENTS = BigInt(1_000_000); // 10 000 Kč

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Rozsah období a jeho kód ("2026-11", "2026-Q4"). */
export function periodRange(r: RecordData) {
  const y = Number(r.year);
  const m = r.month ? Number(r.month) : null;
  const q = r.quarter ? Number(r.quarter) : null;
  if (!y || (m === null) === (q === null) || (m !== null && (m < 1 || m > 12)) || (q !== null && (q < 1 || q > 4))) {
    throw new UserError("@TAX:PeriodRequired", {}, { month: "@TAX:PeriodRequired" });
  }
  const fromM = m ?? (q! - 1) * 3 + 1;
  const toM = m ?? q! * 3;
  return {
    code: m ? `${y}-${pad(m)}` : `${y}-Q${q}`,
    from: `${y}-${pad(fromM)}-01`,
    to: `${y}-${pad(toM)}-${pad(lastDay(y, toM))}`,
    year: y,
    month: m,
    quarter: q,
  };
}

/** Sazba v KH: 1 = základní (21 %), 2 = snížená (12 %), 3 = ostatní. */
const slotOf = (rate: unknown): 1 | 2 | 3 => (Number(rate) >= 20 ? 1 : Number(rate) >= 11 ? 2 : 3);

type Slots = Record<1 | 2 | 3, { base: bigint; tax: bigint }>;
const emptySlots = (): Slots => ({ 1: { base: BigInt(0), tax: BigInt(0) }, 2: { base: BigInt(0), tax: BigInt(0) }, 3: { base: BigInt(0), tax: BigInt(0) } });

export interface KhDoc {
  dic: string;
  num: string;
  date: string;
  slots: Slots;
}

/** Doklad v oddílu A.1 / A.2 / B.1 kontrolního hlášení. */
export interface KhSpecialDoc extends KhDoc {
  /** kód předmětu plnění (A.1, B.1) */
  kod: string;
  /** stát DIČ zahraniční osoby (A.2) */
  country: string;
}

export interface VatComputation {
  period: ReturnType<typeof periodRange>;
  /** řádky přiznání v haléřích */
  rows: { out21: [bigint, bigint]; out12: [bigint, bigint]; in21: [bigint, bigint]; in12: [bigint, bigint] };
  /** všechny řádky přiznání (číslo řádku → základ, daň) */
  lines: Map<string, [bigint, bigint]>;
  taxOut: bigint;
  deduction: bigint;
  a1: KhSpecialDoc[];
  a2: KhSpecialDoc[];
  a4: KhDoc[];
  a5: Slots;
  b1: KhSpecialDoc[];
  b2: KhDoc[];
  b3: Slots;
  warnings: string[];
}

/** Řádky přiznání, které Shanon umí (daň na výstupu 1–13, plnění bez daně 20–26, nárok 40–47, 50). */
export const OUTPUT_LINES = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13"];
export const SUPPLY_LINES = ["20", "21", "22", "23", "24", "25", "26"];
export const DEDUCT_LINES = ["40", "41", "42", "43", "44", "45", "47"];
const KNOWN = new Set([...OUTPUT_LINES, ...SUPPLY_LINES, ...DEDUCT_LINES, "50"]);

/** Výpočet z daňových transakcí období (podle DUZP). `t` přeloží varování. */
/** Rozhodné datum transakce pro přiznání a KH: datum vykázání (nárok v jiném období), jinak DUZP. */
export const reportDateOf = (t: RecordData) => (t.reportDate ?? t.taxDate) as unknown;

/** Daňové transakce, které patří do období (podle data vykázání, jinak DUZP). */
export async function taxTransInPeriod(data: DataApi, from: string, to: string): Promise<RecordData[]> {
  const range = { gte: from, lte: to };
  const [byTaxDate, byReport] = await Promise.all([
    data.find("tax.trans", { taxDate: range, reportDate: null }, { take: 100000, orderBy: { taxDate: "asc" } }),
    data.find("tax.trans", { reportDate: range }, { take: 100000, orderBy: { taxDate: "asc" } }),
  ]);
  return [...byTaxDate, ...byReport];
}

export async function computeVat(
  data: DataApi,
  ret: RecordData,
  t: (ref: string, params?: Record<string, string>) => string = (r) => r,
): Promise<VatComputation> {
  const warn = t;
  const period = periodRange(ret);
  const trans = await taxTransInPeriod(data, period.from, period.to);
  const codes = new Map<string, RecordData>();
  for (const t of trans) {
    const id = String(t.taxCodeId);
    if (!codes.has(id)) codes.set(id, (await data.get("tax.taxCode", id))!);
  }

  const zero = BigInt(0);
  const lines = new Map<string, [bigint, bigint]>();
  const warnings = new Set<string>();
  // doklady pro KH: transakce jednoho dokladu (oddíl, směr, zdroj) dohromady
  type Doc = { sec: string; dir: string; dic: string; num: string; date: string; slots: Slots; gross: bigint; simplified: boolean; kod: string };
  const docs = new Map<string, Doc>();
  for (const t of trans) {
    const code = codes.get(String(t.taxCodeId))!;
    const base = toCents(t.base);
    const tax = toCents(t.tax);
    const line = String(t.reportLine ?? code.reportLine ?? "");
    if (line === "-") continue; // mimo přiznání (mimo předmět, nákup od neplátce)
    if (KNOWN.has(line)) {
      const v = lines.get(line) ?? [zero, zero];
      lines.set(line, [v[0] + base, v[1] + tax]);
    } else warnings.add(warn("@TAX:WarnLine", { code: String(code.code), line: line || "—" }));

    // oddíl KH: z transakce, jinak z kódu; starší kódy bez oddílu podle řádku (1, 2 → A; 40, 41 → B)
    let sec = String(t.khSection ?? code.khSection ?? "").toUpperCase();
    if (!sec && ["1", "2", "40", "41"].includes(line)) sec = t.direction === "output" ? "A4" : "B2";
    if (!sec || sec === "-") continue;
    if (sec === "A5") sec = "A4";
    if (sec === "B3") sec = "B2";
    const key = `${sec}|${t.direction}|${t.sourceId ?? t.id}`;
    const d = docs.get(key) ?? {
      sec,
      dir: String(t.direction),
      dic: String(t.vatId ?? "").replace(/\s/g, "").toUpperCase(),
      num: String(t.documentNum ?? ""),
      date: String(t.taxDate),
      slots: emptySlots(),
      gross: zero,
      simplified: !!t.simplified,
      kod: String(t.khItemCode ?? code.khItemCode ?? ""),
    };
    const s = slotOf(code.rate);
    d.slots[s].base += base;
    d.slots[s].tax += tax;
    d.gross += base + tax;
    docs.set(key, d);
  }

  const a1: KhSpecialDoc[] = [];
  const a2: KhSpecialDoc[] = [];
  const b1: KhSpecialDoc[] = [];
  const a4: KhDoc[] = [];
  const b2: KhDoc[] = [];
  const a5 = emptySlots();
  const b3 = emptySlots();
  for (const d of docs.values()) {
    if (d.sec === "A1" || d.sec === "B1") {
      if (!/^CZ\d{8,10}$/.test(d.dic)) warnings.add(warn("@TAX:WarnNoDic", { doc: d.num }));
      (d.sec === "A1" ? a1 : b1).push({ dic: d.dic.replace(/^CZ/, ""), num: d.num, date: d.date, slots: d.slots, kod: d.kod || "4", country: "CZ" });
      continue;
    }
    if (d.sec === "A2") {
      const m = /^([A-Z]{2})(.+)$/.exec(d.dic);
      if (!m) warnings.add(warn("@TAX:WarnForeign", { doc: d.num, dic: d.dic || "—" }));
      a2.push({ dic: m ? m[2] : d.dic, country: m ? m[1] : "", num: d.num, date: d.date, slots: d.slots, kod: "" });
      continue;
    }
    const out = d.sec.startsWith("A");
    const czDic = /^CZ\d{8,10}$/.test(d.dic);
    if (d.gross >= KH_LIMIT_CENTS && czDic && d.num) {
      (out ? a4 : b2).push({ dic: d.dic.replace(/^CZ/, ""), num: d.num, date: d.date, slots: d.slots });
      continue;
    }
    if (d.dic && !d.dic.startsWith("CZ")) warnings.add(warn("@TAX:WarnForeign", { doc: d.num, dic: d.dic }));
    // tržby z pokladny (souhrn účtenek) patří do A.5 i nad limit
    else if (d.gross >= KH_LIMIT_CENTS && !d.simplified) warnings.add(warn("@TAX:WarnNoDic", { doc: d.num }));
    const sum = out ? a5 : b3;
    for (const k of [1, 2, 3] as const) {
      sum[k].base += d.slots[k].base;
      sum[k].tax += d.slots[k].tax;
    }
  }

  // nezaúčtované faktury s DUZP v období (moduly nemusí být zapnuté)
  let drafts = 0;
  for (const obj of ["ar.invoice", "ap.invoice"]) {
    try {
      drafts += (await data.find(obj, { status: "draft", taxDate: { gte: period.from, lte: period.to } })).length;
    } catch {
      /* modul není zapnutý */
    }
  }
  if (drafts) warnings.add(warn("@TAX:WarnDraft", { n: String(drafts) }));
  const get = (l: string): [bigint, bigint] => lines.get(l) ?? [zero, zero];
  const rows = { out21: get("1"), out12: get("2"), in21: get("40"), in12: get("41") };
  const taxOut = OUTPUT_LINES.reduce((a, l) => a + get(l)[1], zero);
  const deduction = DEDUCT_LINES.reduce((a, l) => a + get(l)[1], zero);
  return { period, rows, lines, taxOut, deduction, a1, a2, a4, a5, b1, b2, b3, warnings: [...warnings] };
}

/** Celé koruny pro přiznání (half-up, symetricky). */
const kc = (cents: bigint) => {
  const neg = cents < BigInt(0);
  const a = neg ? -cents : cents;
  const r = (a + BigInt(50)) / BigInt(100);
  return Number(neg ? -r : r);
};

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const attr = (o: Record<string, string | number | null | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== 0)
    .map(([k, v]) => `${k}="${esc(String(v))}"`)
    .join(" ");
const czDate = (iso: string) => iso.split("-").reverse().join(".");
const amt = (c: bigint) => fromCents(c);

export interface Subject {
  company: RecordData;
  params: RecordData;
}

/** Věta P — údaje o plátci (stejná pro přiznání i hlášení). */
function vetaP({ company, params: p }: Subject) {
  const po = p.subjectType !== "F";
  return `<VetaP ${attr({
    c_ufo: String(p.taxOfficeCode ?? ""),
    c_pracufo: (p.taxOfficeBranch as string) ?? null,
    dic: String(company.vatId ?? "").replace(/^CZ/i, ""),
    typ_ds: po ? "P" : "F",
    zkrobchjm: po ? String(company.name ?? "") : null,
    jmeno: po ? null : (p.firstName as string),
    prijmeni: po ? null : (p.lastName as string),
    ulice: p.street as string,
    c_pop: p.houseNo as string,
    c_orient: p.orientNo as string,
    naz_obce: p.city as string,
    psc: String(p.zipCode ?? "").replace(/\s/g, ""),
    stat: company.country === "CZ" || !company.country ? "ČESKÁ REPUBLIKA" : String(company.country),
    c_telef: p.phone as string,
    email: p.email as string,
    id_dats: p.dataBoxId as string,
    sest_jmeno: p.preparerFirstName as string,
    sest_prijmeni: p.preparerLastName as string,
  })}/>`;
}

const today = () => czDate(new Date().toISOString().slice(0, 10));
const wrap = (name: string, version: string, vety: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<Pisemnost nazevSW="Shanon" verzeSW="1.0">\n  <${name} verzePis="${version}">\n` +
  vety
    // věta bez jediného údaje se nevypisuje (prázdný element validátor EPO nebere)
    .filter((v) => !/^<Veta\w+ \/>$/.test(v))
    .map((v) => `    ${v}`)
    .join("\n") +
  `\n  </${name}>\n</Pisemnost>\n`;

/** Atributy vět DPHDP3 pro řádek přiznání: [základ, daň] (daň chybí u plnění bez daně). */
const DP3_ATTRS: Record<string, [string, string | null]> = {
  "1": ["obrat23", "dan23"],
  "2": ["obrat5", "dan5"],
  "3": ["p_zb23", "dan_pzb23"],
  "4": ["p_zb5", "dan_pzb5"],
  "5": ["p_sl23_e", "dan_psl23_e"],
  "6": ["p_sl5_e", "dan_psl5_e"],
  "7": ["dov_zb23", "dan_dzb23"],
  "8": ["dov_zb5", "dan_dzb5"],
  "9": ["p_dop_nrg", "dan_pdop_nrg"],
  "10": ["rez_pren23", "dan_rpren23"],
  "11": ["rez_pren5", "dan_rpren5"],
  "12": ["p_sl23_z", "dan_psl23_z"],
  "13": ["p_sl5_z", "dan_psl5_z"],
  "20": ["dod_zb", null],
  "21": ["pln_sluzby", null],
  "22": ["pln_vyvoz", null],
  "23": ["dod_dop_nrg", null],
  "24": ["pln_zaslani", null],
  "25": ["pln_rez_pren", null],
  "26": ["pln_ost", null],
  "40": ["pln23", "odp_tuz23_nar"],
  "41": ["pln5", "odp_tuz5_nar"],
  "42": ["dov_cu", "odp_cu_nar"],
  "43": ["nar_zdp23", "od_zdp23"],
  "44": ["nar_zdp5", "od_zdp5"],
  "45": ["", "odp_rez_nar"],
  "47": ["nar_maj", "od_maj"],
  "50": ["plnosv_kf", null],
};

function vetaAttrs(c: VatComputation, lines: string[]) {
  const out: Record<string, number | null> = {};
  for (const l of lines) {
    const v = c.lines.get(l);
    const [b, t] = DP3_ATTRS[l];
    if (!v) continue;
    if (b) out[b] = kc(v[0]);
    if (t) out[t] = kc(v[1]);
  }
  return out;
}

export function dp3Xml(c: VatComputation, subj: Subject): string {
  const { period } = c;
  const taxOut = OUTPUT_LINES.reduce((a, l) => a + kc(c.lines.get(l)?.[1] ?? BigInt(0)), 0);
  const deduction = DEDUCT_LINES.reduce((a, l) => a + kc(c.lines.get(l)?.[1] ?? BigInt(0)), 0);
  const result = taxOut - deduction;
  return wrap("DPHDP3", "01.02", [
    `<VetaD ${attr({
      k_uladis: "DPH",
      dapdph_forma: "B",
      dokument: "DP3",
      mesic: period.month,
      ctvrt: period.quarter,
      rok: period.year,
      d_poddp: today(),
      typ_platce: "P",
      // „Neexistují-li údaje pro C. ODDÍL, proškrtněte“: A = daňová povinnost vznikla (jsou údaje), N = prázdné přiznání
      trans: [...c.lines.values()].some(([b, t]) => b !== BigInt(0) || t !== BigInt(0)) ? "A" : "N",
    })}/>`,
    vetaP(subj),
    `<Veta1 ${attr(vetaAttrs(c, OUTPUT_LINES))}/>`,
    `<Veta2 ${attr(vetaAttrs(c, SUPPLY_LINES))}/>`,
    `<Veta4 ${attr({ ...vetaAttrs(c, DEDUCT_LINES), odp_sum_nar: deduction })}/>`,
    `<Veta5 ${attr(vetaAttrs(c, ["50"]))}/>`,
    `<Veta6 ${attr({ dan_zocelk: taxOut, odp_zocelk: deduction, dano_da: result > 0 ? result : null, dano_no: result < 0 ? -result : null })}/>`,
  ]);
}

const slotAttrs = (s: Slots) => ({
  zakl_dane1: s[1].base ? amt(s[1].base) : null,
  dan1: s[1].tax ? amt(s[1].tax) : null,
  zakl_dane2: s[2].base ? amt(s[2].base) : null,
  dan2: s[2].tax ? amt(s[2].tax) : null,
  zakl_dane3: s[3].base ? amt(s[3].base) : null,
  dan3: s[3].tax ? amt(s[3].tax) : null,
});
const hasAny = (s: Slots) => [1, 2, 3].some((k) => s[k as 1].base !== BigInt(0) || s[k as 1].tax !== BigInt(0));

export function khXml(c: VatComputation, subj: Subject): string {
  const vety: string[] = [
    `<VetaD ${attr({ khdph_forma: "B", dokument: "KH1", mesic: c.period.month, ctvrt: c.period.quarter, rok: c.period.year, d_poddp: today() })}/>`,
    vetaP(subj),
  ];
  // A.1 přenesená povinnost – dodavatel (jen základ), A.2 přijatá plnění od zahraniční osoby
  c.a1.forEach((d, i) => {
    const base = d.slots[1].base + d.slots[2].base + d.slots[3].base;
    vety.push(`<VetaA1 ${attr({ c_radku: i + 1, dic_odb: d.dic, c_evid_dd: d.num, duzp: czDate(d.date), zakl_dane1: amt(base), kod_pred_pl: d.kod })}/>`);
  });
  c.a2.forEach((d, i) => vety.push(`<VetaA2 ${attr({ c_radku: i + 1, k_stat: d.country, vatid_dod: d.dic, c_evid_dd: d.num, dppd: czDate(d.date), ...slotAttrs(d.slots) })}/>`));
  c.a4.forEach((d, i) =>
    vety.push(`<VetaA4 ${attr({ c_radku: i + 1, dic_odb: d.dic, c_evid_dd: d.num, dppd: czDate(d.date), ...slotAttrs(d.slots), kod_rezim_pl: "0", zdph_44: "N" })}/>`),
  );
  if (hasAny(c.a5)) vety.push(`<VetaA5 ${attr(slotAttrs(c.a5))}/>`);
  // B.1 přenesená povinnost – odběratel
  c.b1.forEach((d, i) => vety.push(`<VetaB1 ${attr({ c_radku: i + 1, dic_dod: d.dic, c_evid_dd: d.num, duzp: czDate(d.date), ...slotAttrs(d.slots), kod_pred_pl: d.kod })}/>`));
  c.b2.forEach((d, i) =>
    vety.push(`<VetaB2 ${attr({ c_radku: i + 1, dic_dod: d.dic, c_evid_dd: d.num, dppd: czDate(d.date), ...slotAttrs(d.slots), pomer: "N", zdph_44: "N" })}/>`),
  );
  if (hasAny(c.b3)) vety.push(`<VetaB3 ${attr(slotAttrs(c.b3))}/>`);
  // věta C: základy po sazbách = řádky 1, 2, 40, 41 přiznání
  const sumBase = (docs: KhDoc[], s: Slots, k: 1 | 2) => {
    const v = docs.reduce((a, d) => a + d.slots[k].base, BigInt(0)) + s[k].base;
    return v === BigInt(0) ? null : v; // nulové sazby se jako v ostatních větách vynechávají
  };
  const c0 = (v: bigint | null) => (v === null ? null : amt(v));
  const nz = (v: bigint) => (v === BigInt(0) ? null : v);
  vety.push(
    `<VetaC ${attr({
      obrat23: c0(sumBase(c.a4, c.a5, 1)),
      obrat5: c0(sumBase(c.a4, c.a5, 2)),
      pln23: c0(sumBase(c.b2, c.b3, 1)),
      pln5: c0(sumBase(c.b2, c.b3, 2)),
      // přenesená povinnost a plnění ze zahraničí (návaznost na ř. 10, 11, 25 a A.2)
      rez_pren23: c0(sumBase(c.b1, emptySlots(), 1)),
      rez_pren5: c0(sumBase(c.b1, emptySlots(), 2)),
      pln_rez_pren: c0(nz(c.a1.reduce((a, d) => a + d.slots[1].base + d.slots[2].base + d.slots[3].base, BigInt(0)))),
      celk_zd_a2: c0(nz(c.a2.reduce((a, d) => a + d.slots[1].base + d.slots[2].base + d.slots[3].base, BigInt(0)))),
    })}/>`,
  );
  return wrap("DPHKH1", "03.01", vety);
}

async function subject(data: DataApi, companyId: string | null): Promise<Subject> {
  const company = companyId ? await data.get("sys.company", companyId) : null;
  const [params] = await data.find("tax.parameters", {}, { take: 1 });
  if (!company || !params) throw new UserError("@TAX:MissingParameters");
  return { company, params };
}

/** Je DUZP v období podaného přiznání nebo kontrolního hlášení? (měsíc, případně čtvrtletí) */
export async function filedPeriodOf(data: DataApi, date: unknown): Promise<string | null> {
  const d = (date instanceof Date ? date.toISOString() : String(date ?? "")).slice(0, 10);
  if (!/^\d{4}-\d{2}/.test(d)) return null;
  const year = Number(d.slice(0, 4));
  const month = Number(d.slice(5, 7));
  const filed = await data.find("tax.return", { year, status: "filed" }, { take: 100 });
  const hit = filed.find((r) => (r.kind === "dp3" || r.kind === "kh") && (Number(r.month) === month || (!r.month && Number(r.quarter) === Math.ceil(month / 3))));
  return hit ? `${String(month).padStart(2, "0")}/${year}` : null;
}

const ymd = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? "")).slice(0, 10);

export const vatReturnHandlers: Record<string, ObjectHandlers> = {
  // oprava daňové transakce (DUZP, DIČ, číslo dokladu) jen mimo podané období — původní i nové DUZP
  "tax.trans": {
    actions: {
      /**
       * Nárok v jiném období: jen přijatá plnění s kódem, který to dovoluje, dopředu nejvýš 3 roky od DUZP;
       * původní ani nové období nesmí mít podané přiznání / KH.
       */
      async changeReportDate(ctx, t, _file, input) {
        const date = String(input?.date ?? "");
        if (t.direction !== "input") throw new UserError("@TAX:DeferOutput");
        const code = await ctx.data.get("tax.taxCode", String(t.taxCodeId));
        if (!code?.deferrable) throw new UserError("@TAX:DeferNotAllowed", { code: String(code?.code ?? "") });
        const duzp = ymd(t.taxDate);
        if (date < duzp) throw new UserError("@TAX:DeferBefore", { date: duzp });
        const limit = `${Number(duzp.slice(0, 4)) + 3}${duzp.slice(4)}`;
        if (date > limit) throw new UserError("@TAX:DeferTooLate", { date: limit });
        for (const d of [reportDateOf(t), date]) {
          const period = await filedPeriodOf(ctx.data, d);
          if (period) throw new UserError("@TAX:TransFiled", { period });
        }
        // stejné jako DUZP = zpět na vykázání podle DUZP
        await ctx.data.update("tax.trans", String(t.id), { reportDate: date === duzp ? null : date });
      },
    },
    async beforeSave(ctx, d, isNew) {
      if (isNew || !d.id) return;
      const before = await ctx.data.get("tax.trans", String(d.id));
      if (!before) return;
      const day = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? "")).slice(0, 10);
      const changed = day(before.taxDate) !== day(d.taxDate) || (before.vatId ?? null) !== (d.vatId ?? null) || (before.documentNum ?? null) !== (d.documentNum ?? null);
      if (!changed) return;
      for (const date of [reportDateOf(before), reportDateOf(d)]) {
        const period = await filedPeriodOf(ctx.data, date);
        if (period) throw new UserError("@TAX:TransFiled", { period });
      }
      if (d.vatId) d.vatId = String(d.vatId).replace(/\s/g, "").toUpperCase();
    },
  },
  "tax.parameters": {
    async beforeSave(ctx, data, isNew) {
      if (isNew && (await ctx.data.find("tax.parameters", {}, { take: 1 })).length) throw new UserError("@TAX:OneParameters");
      if (data.subjectType === "F" && (!data.firstName || !data.lastName)) return { firstName: "@SYS:Required" };
    },
    // dodavatel Finanční úřad bez účtovacího profilu dostane profil FU (závazek DPH na 343900), je-li založený
    async afterSave(ctx, data) {
      if (!data.taxOfficeVendorId || !ctx.modules?.has("ap")) return;
      const fu = await ctx.data.get("ap.vendor", String(data.taxOfficeVendorId));
      if (!fu || fu.postingProfileId) return;
      const [prof] = await ctx.data.find("ap.postingProfile", { code: "FU" }, { take: 1 });
      if (prof) await ctx.data.update("ap.vendor", String(fu.id), { postingProfileId: prof.id });
    },
  },
  "tax.return": {
    beforeSave(_ctx, data) {
      const p = periodRange(data);
      data.period = p.code;
      if (p.month) data.quarter = null;
    },
    actions: {
      async calculate(ctx, ret) {
        if (ret.kind === "incomeTax") throw new UserError("@TAX:IncomeTaxSoon");
        const c = await computeVat(ctx.data, ret, ctx.t);
        const taxOut = c.taxOut;
        const deduction = c.deduction;
        // přehled všech řádků přiznání (i těch mimo 1, 2, 40, 41)
        const overview = [...c.lines.entries()]
          .sort((x, y) => Number(x[0]) - Number(y[0]))
          .map(([l, [b, tx]]) => `ř. ${l}: ${ctx.t("@TAX:Base")} ${fromCents(b)}${tx !== BigInt(0) ? ` · ${ctx.t("@TAX:Tax")} ${fromCents(tx)}` : ""}`)
          .join("\n");
        const company = ctx.companyId ? await ctx.data.get("sys.company", ctx.companyId) : null;
        const params = (await ctx.data.find("tax.parameters", {}, { take: 1 }))[0];
        const warnings = [...c.warnings];
        if (!params) warnings.unshift(ctx.t("@TAX:MissingParameters"));
        if (!company?.vatId) warnings.unshift(ctx.t("@TAX:WarnCompanyDic"));
        await ctx.data.update("tax.return", String(ret.id), {
          computedAt: new Date().toISOString().slice(0, 10),
          out21Base: fromCents(c.rows.out21[0]),
          out21Tax: fromCents(c.rows.out21[1]),
          out12Base: fromCents(c.rows.out12[0]),
          out12Tax: fromCents(c.rows.out12[1]),
          in21Base: fromCents(c.rows.in21[0]),
          in21Tax: fromCents(c.rows.in21[1]),
          in12Base: fromCents(c.rows.in12[0]),
          in12Tax: fromCents(c.rows.in12[1]),
          taxOut: fromCents(taxOut),
          deduction: fromCents(deduction),
          result: fromCents(taxOut - deduction),
          a4Count: c.a4.length,
          b2Count: c.b2.length,
          lineSummary: overview || null,
          warnings: warnings.map((w) => `• ${w}`).join("\n") || null,
        });
      },
      async file(ctx, ret) {
        if (!ret.computedAt) throw new UserError("@TAX:NotComputed");
        await ctx.data.update("tax.return", String(ret.id), { status: "filed" });
      },
    },
    downloads: {
      async xml(ctx, ret): Promise<DownloadFile> {
        if (ret.kind !== "dp3" && ret.kind !== "kh") throw new UserError("@TAX:NoXmlForKind");
        const c = await computeVat(ctx.data, ret);
        const subj = await subject(ctx.data, ctx.companyId);
        const dp3 = ret.kind === "dp3";
        return {
          name: `${dp3 ? "DPHDP3" : "DPHKH1"}-${c.period.code}.xml`,
          mime: "application/xml; charset=utf-8",
          data: dp3 ? dp3Xml(c, subj) : khXml(c, subj),
        };
      },
    },
  },
};
