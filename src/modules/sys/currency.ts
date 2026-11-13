/**
 * Měny a kurzy. Kurz = kolik Kč stojí `amount` jednotek měny (kurzovní
 * lístek ČNB). Přepočet vždy přes celé haléře (src/core/money.ts).
 */
import { toScaled } from "@/core/money";
import { UserError, type JobDef, type DataApi, type ObjectHandlers, type RecordData } from "@/core/module";

const CNB_URL = "https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt";

export interface CnbRate {
  code: string;
  amount: number;
  rate: string;
}

/** Rozebere denní kurzovní lístek ČNB (text). Vrací skutečné datum lístku. */
export function parseCnb(text: string): { date: string; rates: CnbRate[] } {
  const lines = text.trim().split(/\r?\n/);
  const m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(lines[0] ?? "");
  if (!m) throw new Error("Neplatný kurzovní lístek ČNB");
  const rates: CnbRate[] = [];
  for (const l of lines.slice(2)) {
    const [, , amount, code, rate] = l.split("|");
    if (code && rate) rates.push({ code: code.trim(), amount: Number(amount), rate: rate.trim().replace(",", ".") });
  }
  return { date: `${m[3]}-${m[2]}-${m[1]}`, rates };
}

export async function fetchCnb(date: string): Promise<{ date: string; rates: CnbRate[] }> {
  const [y, mo, d] = date.split("-");
  const res = await fetch(`${CNB_URL}?date=${d}.${mo}.${y}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new UserError("@SYS:CnbFailed");
  return parseCnb(await res.text());
}

/** Uloží kurzy ČNB k datu pro všechny měny tenanta (jen chybějící). Vrací počet. */
export async function loadCnbRates(data: DataApi, date: string): Promise<number> {
  let sheet;
  try {
    sheet = await fetchCnb(date);
  } catch (e) {
    if (e instanceof UserError) throw e;
    throw new UserError("@SYS:CnbFailed");
  }
  let n = 0;
  for (const cur of await data.find("sys.currency", {})) {
    const r = sheet.rates.find((x) => x.code === cur.code);
    if (!r) continue;
    if ((await data.find("sys.exchangeRate", { currencyId: cur.id, date: sheet.date, base: "CZK", source: "cnb" }, { take: 1 })).length) continue;
    await data.create("sys.exchangeRate", { currencyId: cur.id, date: sheet.date, amount: r.amount, rate: r.rate, base: "CZK", source: "cnb" });
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// ECB — referenční kurzy vůči EUR (eurofxref); kurz vůči jiné měně přepočtem
// ---------------------------------------------------------------------------

const ECB_DAILY = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const ECB_90D = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml";

/** Kurzovní lístky ECB: datum → (měna → kolik jednotek za 1 EUR). */
export function parseEcb(xml: string): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const day of xml.matchAll(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>([\s\S]*?)<\/Cube>/g)) {
    const m = new Map<string, number>([["EUR", 1]]);
    for (const r of day[2].matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) m.set(r[1], Number(r[2]));
    out.set(day[1], m);
  }
  return out;
}

/** Kurzy ECB k datu (poslední lístek nejvýš k tomu datu) vyjádřené vůči `base`. */
export async function fetchEcb(date: string, base: string): Promise<{ date: string; rates: CnbRate[] }> {
  const today = new Date().toISOString().slice(0, 10);
  let res: Response;
  try {
    res = await fetch(date >= today ? ECB_DAILY : ECB_90D, { signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new UserError("@SYS:EcbFailed");
  }
  if (!res.ok) throw new UserError("@SYS:EcbFailed");
  const days = [...parseEcb(await res.text())].filter(([d]) => d <= date).sort(([a], [b]) => (a < b ? 1 : -1));
  if (!days.length) throw new UserError("@SYS:EcbFailed");
  const [d, perEur] = days[0];
  const b = perEur.get(base);
  if (!b) throw new UserError("@SYS:EcbFailed");
  // 1 X = (base za EUR) / (X za EUR) jednotek base; 6 desetinných míst
  const rates = [...perEur].filter(([c]) => c !== base).map(([code, x]) => ({ code, amount: 1, rate: (b / x).toFixed(6) }));
  return { date: d, rates };
}

/** Uloží kurzy ECB vůči `base` pro měny tenanta (jen chybějící). Vrací počet. */
export async function loadEcbRates(data: DataApi, date: string, base: string): Promise<number> {
  const sheet = await fetchEcb(date, base);
  let n = 0;
  for (const cur of await data.find("sys.currency", {})) {
    const r = sheet.rates.find((x) => x.code === cur.code);
    if (!r) continue;
    if ((await data.find("sys.exchangeRate", { currencyId: cur.id, date: sheet.date, base, source: "ecb" }, { take: 1 })).length) continue;
    await data.create("sys.exchangeRate", { currencyId: cur.id, date: sheet.date, amount: r.amount, rate: r.rate, base, source: "ecb" });
    n++;
  }
  return n;
}

/** Celočíselné dělení se zaokrouhlením half-up (symetricky). */
function divRound(n: bigint, d: bigint): bigint {
  const neg = n < BigInt(0);
  const a = neg ? -n : n;
  const r = (a * BigInt(2) + d) / (BigInt(2) * d);
  return neg ? -r : r;
}

/** Přepočet částky v měně na účetní měnu v haléřích: částka × kurz / množství. */
export function convertCents(amountCur: unknown, rate: unknown, rateAmount: number): bigint {
  const raw = toScaled(amountCur, 2) * toScaled(rate, 6); // haléře × kurz (6 míst)
  return divRound(raw, BigInt(rateAmount || 1) * BigInt(10) ** BigInt(6));
}

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export interface RateConfig {
  /** kód účetní měny, vůči které je kurz (výchozí CZK) */
  base?: string;
  /** upřednostněný zdroj; ruční kurz má vždy přednost */
  source?: "cnb" | "ecb";
  /** nejstarší použitelný kurz ve dnech (výchozí 7) */
  maxAgeDays?: number;
}

/**
 * Kurz měny k datu vůči účetní měně: ruční kurz, jinak ze zvoleného zdroje,
 * nejvýš `maxAgeDays` dní starý. Když chybí, zkusí ho ze zdroje načíst.
 */
export async function rateFor(
  data: DataApi,
  currencyId: string,
  date: string,
  cfg: RateConfig = {},
): Promise<{ code: string; rate: string; amount: number }> {
  const cur = await data.get("sys.currency", currencyId);
  if (!cur) throw new UserError("@SYS:InvalidValue");
  const base = cfg.base ?? "CZK";
  const source = cfg.source ?? (base === "CZK" ? "cnb" : "ecb");
  const range = { lte: date, gte: addDays(date, -(cfg.maxAgeDays ?? 7)) };
  const pick = async (src: string) => (await data.find("sys.exchangeRate", { currencyId, base, source: src, date: range }, { take: 1, orderBy: { date: "desc" } }))[0];
  const find = async () => (await pick("manual")) ?? (await pick(source));
  let r: RecordData | undefined = await find();
  if (!r) {
    await (source === "cnb" && base === "CZK" ? loadCnbRates(data, date) : loadEcbRates(data, date, base)).catch(() => 0);
    r = await find();
  }
  if (!r) throw new UserError("@SYS:MissingRate", { cur: String(cur.code), date });
  return { code: String(cur.code), rate: String(r.rate), amount: Number(r.amount) };
}

export const sysHandlers: Record<string, ObjectHandlers> = {
  "sys.currency": {
    actions: {
      async cnb(ctx) {
        await loadCnbRates(ctx.data, new Date().toISOString().slice(0, 10));
      },
      async ecb(ctx) {
        // vůči účetní měně aktuální firmy
        const company = ctx.companyId ? await ctx.data.get("sys.company", ctx.companyId) : null;
        await loadEcbRates(ctx.data, new Date().toISOString().slice(0, 10), String(company?.currency ?? "CZK"));
      },
    },
  },
};

/** Dávkové úlohy kurzů: ČNB (vůči CZK) a ECB (vůči účetní měně firmy). */
export const rateJobs: JobDef[] = [
  {
    id: "sys.ratesCnb",
    label: "@SYS:JobRatesCnb",
    default: { recurrence: "days", every: 1, at: "14:45" },
    async run(ctx) {
      return ctx.t("@SYS:RatesLoaded", { n: String(await loadCnbRates(ctx.data, todayPrague())) });
    },
  },
  {
    id: "sys.ratesEcb",
    label: "@SYS:JobRatesEcb",
    default: { recurrence: "days", every: 1, at: "16:30", active: false },
    async run(ctx) {
      const company = ctx.companyId ? await ctx.data.get("sys.company", ctx.companyId) : null;
      return ctx.t("@SYS:RatesLoaded", { n: String(await loadEcbRates(ctx.data, todayPrague(), String(company?.currency ?? "CZK"))) });
    },
  },
];

function todayPrague() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague" }).format(new Date());
}
