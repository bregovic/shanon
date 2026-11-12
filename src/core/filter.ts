/**
 * Filtry sloupců gridu — syntaxe převzatá ze SmartDataGridu staré verze,
 * ale vyhodnocuje se na serveru (do prohlížeče jde jen stránka výsledků).
 *
 *   text        přesná shoda (bez rozlišení velikosti písmen)
 *   *text*      obsahuje       text*  začíná      *text  končí
 *   A, B        nebo           !text  není        ""     prázdné
 *   > 100  < 100  10..20  10..  ..20               čísla a data
 *   15  1512  15.12  15.12.2026  15.12..  ..31.12  data (den, den+měsíc…)
 *   ano / ne                                       zaškrtávací pole
 */
import type { FieldKind } from "./edt";

export type Cond =
  | { op: "empty"; not: boolean }
  | { op: "eq" | "contains" | "starts" | "ends"; value: string; not: boolean }
  | { op: "like"; parts: string[]; not: boolean } // a*b*c — všechny části v pořadí
  | { op: "range"; from?: string; to?: string } // čísla i data (YYYY-MM-DD), včetně mezí
  | { op: "gt" | "lt"; value: string }
  | { op: "bool"; value: boolean };

/** Výsledek: seznam podmínek spojených NEBO (A, B). Prázdné pole = filtr nic nepropustí. */
export type ParsedFilter = Cond[];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
};

/** "15" · "1512" · "15.12" · "15.12.2026" · "2026-12-15" → YYYY-MM-DD */
export function parseSmartDate(input: string, today = new Date()): string | null {
  const s = input.trim();
  const y = today.getFullYear();
  let m: RegExpMatchArray | null;
  if (/^\d{1,2}$/.test(s)) return iso(y, today.getMonth() + 1, Number(s));
  if (/^\d{3,4}$/.test(s)) {
    const p = s.padStart(4, "0");
    return iso(y, Number(p.slice(2)), Number(p.slice(0, 2)));
  }
  if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.?$/))) return iso(y, Number(m[2]), Number(m[1]));
  if ((m = s.match(/^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})$/))) return iso(Number(m[3]), Number(m[2]), Number(m[1]));
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

const parseNumber = (s: string): string | null => {
  const v = s.replace(/\s/g, "").replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(v) ? v : null;
};

const YES = ["ano", "a", "yes", "y", "1", "true", "✓"];
const NO = ["ne", "n", "no", "0", "false"];

/**
 * Rozebere výraz podle druhu pole. Neplatné části (např. "abc" u čísla)
 * se vynechají; když nezbude nic, filtr nevrátí žádný záznam.
 */
export function parseFilter(kind: FieldKind, expr: string, today = new Date()): ParsedFilter {
  const out: Cond[] = [];
  for (const raw of expr.split(",").map((p) => p.trim()).filter(Boolean)) {
    let part = raw;
    let not = false;
    if (part.startsWith("!")) {
      not = true;
      part = part.slice(1).trim();
    }
    if (part === '""' || part === "''") {
      out.push({ op: "empty", not });
      continue;
    }

    if (kind === "bool") {
      const v = part.toLowerCase();
      if (YES.includes(v)) out.push({ op: "bool", value: !not });
      else if (NO.includes(v)) out.push({ op: "bool", value: not });
      continue;
    }

    if (kind === "int" || kind === "decimal" || kind === "date" || kind === "datetime") {
      const conv = kind === "int" || kind === "decimal" ? parseNumber : (s: string) => parseSmartDate(s, today);
      if (/^[<>]/.test(part)) {
        const v = conv(part.slice(1).trim());
        if (v !== null) out.push({ op: part[0] === ">" ? "gt" : "lt", value: v });
        continue;
      }
      if (part.includes("..")) {
        const [a, b] = part.split("..");
        const from = a.trim() ? conv(a) : undefined;
        const to = b.trim() ? conv(b) : undefined;
        if (from !== null && to !== null && (from || to)) out.push({ op: "range", from: from ?? undefined, to: to ?? undefined });
        continue;
      }
      const v = conv(part);
      if (v !== null) out.push({ op: "range", from: v, to: v });
      continue;
    }

    // text, výčet, odkaz
    if (part.includes("*")) {
      const pieces = part.split("*");
      const words = pieces.filter(Boolean);
      const lead = part.startsWith("*");
      const trail = part.endsWith("*");
      if (words.length === 0) out.push({ op: "contains", value: "", not });
      else if (words.length === 1 && lead && trail) out.push({ op: "contains", value: words[0], not });
      else if (words.length === 1 && trail) out.push({ op: "starts", value: words[0], not });
      else if (words.length === 1 && lead) out.push({ op: "ends", value: words[0], not });
      else out.push({ op: "like", parts: pieces, not }); // a*b — prázdné krajní části = bez ukotvení
      continue;
    }
    out.push({ op: "eq", value: part, not });
  }
  return out;
}

/** Text výrazu pro nápovědu v menu sloupce (label → výčet operátorů). */
export const FILTER_HELP: [string, string][] = [
  ["text", "@SYS:FltExact"],
  ["*text*", "@SYS:FltContains"],
  ["text*", "@SYS:FltStarts"],
  ["A, B", "@SYS:FltOr"],
  ["!text", "@SYS:FltNot"],
  ['""', "@SYS:FltEmpty"],
  ["15.12", "@SYS:FltDay"],
  ["15.12..", "@SYS:FltFrom"],
  ["..31.12", "@SYS:FltTo"],
  ["10..20", "@SYS:FltRange"],
  ["> 100", "@SYS:FltGt"],
  ["< 100", "@SYS:FltLt"],
];
