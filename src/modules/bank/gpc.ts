/**
 * Bankovní výpis ve formátu GPC (ABO) — pevná šířka 128 znaků, CP1250.
 * Exportují ho všechny české banky. Pozice polí převzaté z Kliniky POS HX,
 * kde jsou ověřené na ostrých výpisech.
 *
 * Pasti formátu:
 *  - **Částka je 11 znaků, ne 12.** Dvanáctý znak je kód účtování
 *    (1 debet, 2 kredit, 4 storno debet, 5 storno kredit). S dvanácti znaky
 *    vyjdou částky 100× větší.
 *  - Částky jsou v haléřích (počítáme v BigInt, žádný float).
 *  - Číslo dokladu bývá samé nuly — identitu řádku tvoří výpis + pořadí.
 *  - Datum je DDMMRR, rok bereme jako 20xx.
 *  - Jediná pojistka proti posunu polí: součty transakcí musí sedět na obraty
 *    v hlavičce a zůstatek se musí dopočítat (`checkStatement`).
 */

export interface GpcLine {
  /** pořadí ve výpisu od 1 */
  lineNum: number;
  counterAccount: string | null;
  vs: string | null;
  /** haléře se znaménkem: + příchozí, − odchozí */
  cents: bigint;
  date: string;
  message: string | null;
  dateOk: boolean;
}

export interface GpcStatement {
  account: string;
  accountName: string | null;
  statementNum: string;
  date: string;
  opening: bigint;
  closing: bigint;
  debit: bigint;
  credit: bigint;
  lines: GpcLine[];
}

const cents = (s: string) => BigInt(s.replace(/\D/g, "") || "0");

/** Zůstatek v hlavičce má za částkou znaménko (+/−). */
const signedCents = (s: string, sign: string) => (sign === "-" ? -cents(s) : cents(s));

function date(s: string): string | null {
  if (!/^\d{6}$/.test(s)) return null;
  const [d, m, y] = [s.slice(0, 2), s.slice(2, 4), s.slice(4, 6)];
  if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return `20${y}-${m}-${d}`;
}

const clean = (s: string) => {
  const v = s.replace(/^0+/, "").trim();
  return v === "" ? null : v;
};

/** Soubor může obsahovat víc výpisů za sebou (každý začíná řádkem 074). */
export function parseGpc(text: string): GpcStatement[] {
  const out: GpcStatement[] = [];
  let cur: GpcStatement | null = null;
  for (const row of text.split(/\r?\n/)) {
    if (row.length < 100) continue;
    const type = row.slice(0, 3);
    if (type === "074") {
      cur = {
        account: clean(row.slice(3, 19)) ?? "",
        accountName: row.slice(19, 39).trim() || null,
        statementNum: row.slice(105, 108),
        date: date(row.slice(108, 114)) ?? date(row.slice(39, 45)) ?? "",
        opening: signedCents(row.slice(45, 59), row.slice(59, 60)),
        closing: signedCents(row.slice(60, 74), row.slice(74, 75)),
        debit: cents(row.slice(75, 89)),
        credit: cents(row.slice(90, 104)),
        lines: [],
      };
      out.push(cur);
    } else if (type === "075" && cur) {
      const code = row.slice(60, 61);
      const incoming = code === "2" || code === "4";
      const d = date(row.slice(91, 97));
      const amount = cents(row.slice(49, 60));
      cur.lines.push({
        lineNum: cur.lines.length + 1,
        counterAccount: clean(row.slice(19, 35)),
        vs: clean(row.slice(61, 71)),
        cents: incoming ? amount : -amount,
        date: d ?? cur.date,
        dateOk: d !== null,
        message: row.slice(97, 117).trim() || null,
      });
    }
  }
  return out;
}

/** Součty na obraty a dopočet zůstatku. Vrací popis neshody, nebo null. */
export function checkStatement(s: GpcStatement): string | null {
  const zero = BigInt(0);
  const credit = s.lines.filter((l) => l.cents > zero).reduce((a, l) => a + l.cents, zero);
  const debit = s.lines.filter((l) => l.cents < zero).reduce((a, l) => a - l.cents, zero);
  const errors: string[] = [];
  if (credit !== s.credit) errors.push(`příjmy ${credit} ≠ ${s.credit}`);
  if (debit !== s.debit) errors.push(`výdaje ${debit} ≠ ${s.debit}`);
  if (s.opening + s.credit - s.debit !== s.closing) errors.push("zůstatek nesedí na obraty");
  const noDate = s.lines.filter((l) => !l.dateOk).length;
  if (noDate) errors.push(`u ${noDate} řádků nešlo přečíst datum`);
  return errors.length ? errors.join(", ") : null;
}

/** GPC bývá CP1250, některé banky posílají UTF-8. */
export function decodeGpc(buf: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1250").decode(buf);
  }
}

/** Testovací/ukázkový řádek 074 (hlavička) — pro testy a generování vzorků. */
export function gpcHeader(o: { account: string; name: string; num: string; date: string; opening: bigint; closing: bigint; debit: bigint; credit: bigint }) {
  const ddmmyy = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(2, 4)}`;
  const amt = (v: bigint) => (v < BigInt(0) ? -v : v).toString().padStart(14, "0");
  const sign = (v: bigint) => (v < BigInt(0) ? "-" : "+");
  return (
    "074" +
    o.account.padStart(16, "0") +
    o.name.padEnd(20).slice(0, 20) +
    ddmmyy(o.date) +
    amt(o.opening) + sign(o.opening) +
    amt(o.closing) + sign(o.closing) +
    amt(o.debit) + "0" +
    amt(o.credit) + "0" +
    o.num.padStart(3, "0") +
    ddmmyy(o.date)
  ).padEnd(128);
}

/** Testovací řádek 075 (transakce). */
export function gpcLine(o: { counter: string; cents: bigint; vs: string; date: string; message: string }) {
  const ddmmyy = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(2, 4)}`;
  const a = o.cents < BigInt(0) ? -o.cents : o.cents;
  return (
    "075" +
    "0".repeat(16) +
    o.counter.padStart(16, "0") +
    "0".repeat(14) + // číslo dokladu (pozice 35–48)
    a.toString().padStart(11, "0") +
    (o.cents < BigInt(0) ? "1" : "2") +
    o.vs.padStart(10, "0") +
    "0".repeat(20) + // KS + SS (neověřené pozice)
    ddmmyy(o.date) +
    o.message.padEnd(20).slice(0, 20)
  ).padEnd(128);
}
