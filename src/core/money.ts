/**
 * Peníze bez plovoucí čárky: částky jsou v DB i v kódu jako text
 * ("1234.50"), počítá se v celých haléřích (BigInt).
 */

export function toCents(v: unknown): bigint {
  if (v === null || v === undefined || v === "") return BigInt(0);
  const s = String(v).replace(/\s/g, "").replace(",", ".").replace(/(\.\d{2})0+$/, "$1");
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`Neplatná částka: ${s}`);
  const cents = BigInt(m[2]) * BigInt(100) + BigInt((m[3] ?? "").padEnd(2, "0"));
  return m[1] === "-" ? -cents : cents;
}

export function fromCents(c: bigint): string {
  const neg = c < BigInt(0);
  const a = neg ? -c : c;
  const s = `${a / BigInt(100)}.${(a % BigInt(100)).toString().padStart(2, "0")}`;
  return neg ? `-${s}` : s;
}

export const sumCents = (xs: bigint[]) => xs.reduce((a, b) => a + b, BigInt(0));

/** Desetinné číslo jako celé číslo se zadaným počtem míst (bez floatu). */
export function toScaled(v: unknown, scale: number): bigint {
  if (v === null || v === undefined || v === "") return BigInt(0);
  const s = String(v).replace(/\s/g, "").replace(",", ".");
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`Neplatné číslo: ${s}`);
  const frac = (m[3] ?? "").padEnd(scale, "0");
  // zaokrouhlení nadbytečných míst (half-up)
  let n = BigInt(m[2] + frac.slice(0, scale));
  if (frac.length > scale && Number(frac[scale]) >= 5) n += BigInt(1);
  return m[1] === "-" ? -n : n;
}

/** Zaokrouhlí celé číslo s `from` místy na `to` míst (half-up, symetricky). */
export function rescale(n: bigint, from: number, to: number): bigint {
  if (from <= to) return n * BigInt(10) ** BigInt(to - from);
  const d = BigInt(10) ** BigInt(from - to);
  const neg = n < BigInt(0);
  const a = neg ? -n : n;
  const r = (a + d / BigInt(2)) / d;
  return neg ? -r : r;
}

/** a × b zaokrouhleno na haléře; např. množství × cena, základ × kurz. */
export function mulCents(a: unknown, aScale: number, b: unknown, bScale: number): bigint {
  return rescale(toScaled(a, aScale) * toScaled(b, bScale), aScale + bScale, 2);
}

/** Částka × sazba % (sazba se 4 místy), zaokrouhleno na haléře. */
export function percentOf(cents: bigint, rate: unknown): bigint {
  return rescale(cents * toScaled(rate, 4), 2 + 4 + 2, 2);
}

/**
 * Zaokrouhlí částku v haléřích na jednotku (0,01 = beze změny, 1 = koruny,
 * 0,05 …). `method`: nearest (polovina od nuly), up / down (v absolutní hodnotě).
 */
export function roundCents(cents: bigint, unit: string | number, method: "nearest" | "up" | "down" = "nearest"): bigint {
  const step = BigInt(Math.round(Number(unit) * 100));
  if (step <= BigInt(1)) return cents;
  const neg = cents < BigInt(0);
  const a = neg ? -cents : cents;
  const rest = a % step;
  let r = a - rest;
  if (rest > BigInt(0) && (method === "up" || (method === "nearest" && rest * BigInt(2) >= step))) r += step;
  return neg ? -r : r;
}
