/**
 * Přiznání k DPH (DPHDP3) a kontrolní hlášení (DPHKH1) z daňových transakcí.
 *
 * Zdroj je tax.trans (vzniká zaúčtováním faktur) za období podle DUZP.
 * Kam která transakce patří, určuje její daňový kód — řádek přiznání
 * (`reportLine`) a sazba; nic není napsané natvrdo podle kódu.
 *
 * Pasti formátu EPO (ověřené v DMS na validátoru portálu):
 *  - `k_uladb` je atribut věty D PŘIZNÁNÍ, v hlášení (DPHKH1) neexistuje.
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

export interface VatComputation {
  period: ReturnType<typeof periodRange>;
  /** řádky přiznání v haléřích */
  rows: { out21: [bigint, bigint]; out12: [bigint, bigint]; in21: [bigint, bigint]; in12: [bigint, bigint] };
  a4: KhDoc[];
  a5: Slots;
  b2: KhDoc[];
  b3: Slots;
  warnings: string[];
}

/** Výpočet z daňových transakcí období (podle DUZP). `t` přeloží varování. */
export async function computeVat(
  data: DataApi,
  ret: RecordData,
  t: (ref: string, params?: Record<string, string>) => string = (r) => r,
): Promise<VatComputation> {
  const warn = t;
  const period = periodRange(ret);
  const trans = await data.find("tax.trans", { taxDate: { gte: period.from, lte: period.to } }, { take: 100000, orderBy: { taxDate: "asc" } });
  const codes = new Map<string, RecordData>();
  for (const t of trans) {
    const id = String(t.taxCodeId);
    if (!codes.has(id)) codes.set(id, (await data.get("tax.taxCode", id))!);
  }

  const zero = BigInt(0);
  const rows = { out21: [zero, zero], out12: [zero, zero], in21: [zero, zero], in12: [zero, zero] } as VatComputation["rows"];
  const warnings = new Set<string>();
  // doklady pro KH: transakce jednoho dokladu (sourceId) dohromady
  const docs = new Map<string, { dir: string; dic: string; num: string; date: string; slots: Slots; gross: bigint; simplified: boolean }>();
  for (const t of trans) {
    const code = codes.get(String(t.taxCodeId))!;
    const base = toCents(t.base);
    const tax = toCents(t.tax);
    const line = String(code.reportLine ?? "");
    const target = { "1": "out21", "2": "out12", "40": "in21", "41": "in12" }[line] as keyof typeof rows | undefined;
    if (target) {
      rows[target][0] += base;
      rows[target][1] += tax;
    } else warnings.add(warn("@TAX:WarnLine", { code: String(code.code), line: line || "—" }));

    const key = `${t.direction}|${t.sourceId ?? t.id}`;
    const d = docs.get(key) ?? {
      dir: String(t.direction),
      dic: String(t.vatId ?? "").replace(/\s/g, "").toUpperCase(),
      num: String(t.documentNum ?? ""),
      date: String(t.taxDate),
      slots: emptySlots(),
      gross: zero,
      simplified: !!t.simplified,
    };
    const s = slotOf(code.rate);
    d.slots[s].base += base;
    d.slots[s].tax += tax;
    d.gross += base + tax;
    docs.set(key, d);
  }

  const a4: KhDoc[] = [];
  const b2: KhDoc[] = [];
  const a5 = emptySlots();
  const b3 = emptySlots();
  for (const d of docs.values()) {
    const out = d.dir === "output";
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
  return { period, rows, a4, a5, b2, b3, warnings: [...warnings] };
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

export function dp3Xml(c: VatComputation, subj: Subject): string {
  const { rows, period } = c;
  const taxOut = kc(rows.out21[1]) + kc(rows.out12[1]);
  const deduction = kc(rows.in21[1]) + kc(rows.in12[1]);
  const result = taxOut - deduction;
  return wrap("DPHDP3", "01.02", [
    `<VetaD ${attr({
      k_uladb: "B",
      dapdph_forma: "B",
      dokument: "DP3",
      mesic: period.month,
      ctvrt: period.quarter,
      rok: period.year,
      d_poddp: today(),
      typ_platce: "P",
      trans: "N",
    })}/>`,
    vetaP(subj),
    `<Veta1 ${attr({ obrat23: kc(rows.out21[0]), dan23: kc(rows.out21[1]), obrat5: kc(rows.out12[0]), dan5: kc(rows.out12[1]) })}/>`,
    `<Veta4 ${attr({
      pln23: kc(rows.in21[0]),
      odp_tuz23_nar: kc(rows.in21[1]),
      pln5: kc(rows.in12[0]),
      odp_tuz5_nar: kc(rows.in12[1]),
      odp_sum_nar: deduction,
    })}/>`,
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
  c.a4.forEach((d, i) =>
    vety.push(`<VetaA4 ${attr({ c_radku: i + 1, dic_odb: d.dic, c_evid_dd: d.num, dppd: czDate(d.date), ...slotAttrs(d.slots), kod_rezim_pl: "0", zdph_44: "N" })}/>`),
  );
  if (hasAny(c.a5)) vety.push(`<VetaA5 ${attr(slotAttrs(c.a5))}/>`);
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
  vety.push(
    `<VetaC ${attr({
      obrat23: c0(sumBase(c.a4, c.a5, 1)),
      obrat5: c0(sumBase(c.a4, c.a5, 2)),
      pln23: c0(sumBase(c.b2, c.b3, 1)),
      pln5: c0(sumBase(c.b2, c.b3, 2)),
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

export const vatReturnHandlers: Record<string, ObjectHandlers> = {
  "tax.parameters": {
    async beforeSave(ctx, data, isNew) {
      if (isNew && (await ctx.data.find("tax.parameters", {}, { take: 1 })).length) throw new UserError("@TAX:OneParameters");
      if (data.subjectType === "F" && (!data.firstName || !data.lastName)) return { firstName: "@SYS:Required" };
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
        const c = await computeVat(ctx.data, ret, ctx.t);
        const taxOut = c.rows.out21[1] + c.rows.out12[1];
        const deduction = c.rows.in21[1] + c.rows.in12[1];
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
