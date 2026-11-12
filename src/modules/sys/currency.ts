/**
 * Měny a kurzy. Kurz = kolik Kč stojí `amount` jednotek měny (kurzovní
 * lístek ČNB). Přepočet vždy přes celé haléře (src/core/money.ts).
 */
import { toScaled } from "@/core/money";
import { UserError, type DataApi, type ObjectHandlers, type RecordData } from "@/core/module";

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
    if ((await data.find("sys.exchangeRate", { currencyId: cur.id, date: sheet.date }, { take: 1 })).length) continue;
    await data.create("sys.exchangeRate", { currencyId: cur.id, date: sheet.date, amount: r.amount, rate: r.rate });
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

/**
 * Kurz měny k datu: poslední zadaný kurz nejvýš 7 dní starý. Když chybí,
 * zkusí ho načíst z ČNB. Účetní měna firmy má kurz 1.
 */
export async function rateFor(
  data: DataApi,
  currencyId: string,
  date: string,
): Promise<{ code: string; rate: string; amount: number }> {
  const cur = await data.get("sys.currency", currencyId);
  if (!cur) throw new UserError("@SYS:InvalidValue");
  const find = async () =>
    (await data.find("sys.exchangeRate", { currencyId, date: { lte: date, gte: addDays(date, -7) } }, { take: 1, orderBy: { date: "desc" } }))[0];
  let r: RecordData | undefined = await find();
  if (!r) {
    await loadCnbRates(data, date).catch(() => 0);
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
    },
  },
};
