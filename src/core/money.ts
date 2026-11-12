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
