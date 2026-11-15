/**
 * Bankovní výpis v CSV podle specifikace (bank.statementFormat): nic napevno pro konkrétní banku.
 *
 * - hlavička = řádky „popisek;hodnota“ před tabulkou transakcí; údaj se najde podle prefixu
 *   popisku (bez diakritiky a velikosti písmen), hodnota je první neprázdná buňka za ním,
 * - tabulka transakcí začíná řádkem, jehož buňka odpovídá `linesStart`; sloupce se najdou
 *   podle názvů z řádků specifikace (údaj ← název sloupce),
 * - částky s desetinnou čárkou / tečkou, datum podle masky (dd.MM.yyyy, yyyy-MM-dd, d.M.yyyy…).
 *
 * Výsledek má stejný tvar jako výpis GPC (stejné kontroly, párování a zaúčtování).
 */
import { UserError, type RecordData } from "@/core/module";
import type { GpcStatement } from "./gpc";

export interface CsvFormat {
  code: string;
  detect?: string | null;
  fileNamePattern?: string | null;
  encoding: string;
  delimiter: string;
  decimalSeparator: string;
  dateFormat: string;
  linesStart?: string | null;
  fields: { section: string; target: string; source: string }[];
}

export interface CsvStatement extends GpcStatement {
  iban: string | null;
  dateFrom: string | null;
  /** číslo účtu z názvu souboru (maska specifikace) */
  fileAccount: string | null;
  lines: (GpcStatement["lines"][number] & { counterName: string | null; ks: string | null; ss: string | null; reference: string | null })[];
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

/** Dekódovat podle kódování specifikace (UTF-8 s BOM i bez, jinak Windows-1250). */
export function decodeText(data: Buffer, encoding: string): string {
  if (encoding === "utf-8") return new TextDecoder("utf-8").decode(data).replace(/^﻿/, "");
  return new TextDecoder("windows-1250").decode(data);
}

/** CSV řádek → buňky (uvozovky, zdvojené uvozovky uvnitř). */
function cells(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (line.startsWith(delimiter, i)) {
      out.push(cur);
      cur = "";
      i += delimiter.length - 1;
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** Částka podle desetinného oddělovače → haléře (se znaménkem). */
export function parseAmount(v: string, decimal: string): bigint | null {
  let s = v.replace(/[\s ']/g, "");
  if (!s) return null;
  if (decimal === ",") s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
  const neg = s.startsWith("-");
  const [int, frac = ""] = s.replace(/^[+-]/, "").split(".");
  const c = BigInt(int) * BigInt(100) + BigInt((frac + "00").slice(0, 2));
  return neg ? -c : c;
}

/** Datum podle masky (dd, d, MM, M, yyyy, yy) → ISO. */
export function parseDate(v: string, mask: string): string | null {
  const s = v.trim();
  if (!s) return null;
  const parts = mask.match(/d+|M+|y+|[^dMy]+/g) ?? [];
  let re = "^";
  const order: string[] = [];
  for (const p of parts) {
    const kind = /^d+$/.test(p) ? "d" : /^M+$/.test(p) ? "M" : /^y+$/.test(p) ? "y" : null;
    if (kind) {
      re += kind === "y" ? (p.length <= 2 ? "(\\d{2})" : "(\\d{4})") : "(\\d{1,2})";
      order.push(kind);
    } else re +=p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
  }
  const m = new RegExp(re).exec(s);
  if (!m) return null;
  const val: Record<string, number> = {};
  order.forEach((k, i) => (val[k] = Number(m[i + 1])));
  const y = val.y < 100 ? 2000 + val.y : val.y;
  const dt = new Date(Date.UTC(y, val.M - 1, val.d));
  if (dt.getUTCMonth() !== val.M - 1 || dt.getUTCDate() !== val.d) return null;
  return `${y}-${String(val.M).padStart(2, "0")}-${String(val.d).padStart(2, "0")}`;
}

/** Odpovídá soubor specifikaci? (začátek prvního neprázdného řádku) */
export function matchesFormat(text: string, f: CsvFormat): boolean {
  if (!f.detect) return false;
  const first = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  return fold(first).startsWith(fold(f.detect));
}

/** Číslo účtu z názvu souboru podle masky (první skupina). */
export function accountFromFileName(name: string, pattern?: string | null): string | null {
  if (!pattern) return null;
  try {
    return new RegExp(pattern, "i").exec(name.replace(/^.*[\\/]/, ""))?.[1] ?? null;
  } catch {
    return null;
  }
}

export function parseCsvStatement(text: string, f: CsvFormat, fileName: string, t: (ref: string, p?: Record<string, string>) => string = (r) => r): CsvStatement {
  const rows = text.split(/\r?\n/).map((l) => cells(l, f.delimiter));
  const header = f.fields.filter((x) => x.section === "header");
  const line = f.fields.filter((x) => x.section === "line");
  const marker = fold(f.linesStart || (line[0]?.source ?? ""));
  const start = rows.findIndex((r) => r.some((c) => fold(c) === marker));
  if (start < 0) throw new UserError("@BANK:CsvNoLines", { file: fileName, marker: f.linesStart ?? "" });

  // hlavička: popisek;hodnota (prefix popisku)
  const hv: Record<string, string> = {};
  for (const r of rows.slice(0, start)) {
    const label = fold(r[0] ?? "");
    if (!label) continue;
    const h = header.find((x) => label.startsWith(fold(x.source)));
    if (h && !(h.target in hv)) hv[h.target] = r.slice(1).find((c) => c !== "") ?? "";
  }

  // sloupce transakcí podle názvů
  const head = rows[start].map(fold);
  const col: Record<string, number> = {};
  for (const x of line) {
    const i = head.indexOf(fold(x.source));
    if (i >= 0) col[x.target] = i;
  }
  const get = (r: string[], k: string) => (col[k] !== undefined ? (r[col[k]] ?? "").trim() : "");

  const out: CsvStatement["lines"] = [];
  rows.slice(start + 1).forEach((r, i) => {
    if (r.every((c) => !c)) return;
    const amountRaw = get(r, "amount");
    if (!amountRaw) return;
    const cents = parseAmount(amountRaw, f.decimalSeparator);
    if (cents === null) throw new UserError("@BANK:CsvBadValue", { line: String(start + i + 2), value: amountRaw, field: t("@BANK:TgAmount") });
    const dateRaw = get(r, "date");
    const date = parseDate(dateRaw, f.dateFormat);
    if (!date) throw new UserError("@BANK:CsvBadValue", { line: String(start + i + 2), value: dateRaw, field: t("@BANK:TgDate") });
    const msg = [get(r, "message"), get(r, "counterName"), get(r, "note"), get(r, "type")].filter(Boolean).join(" · ");
    const sym = (v: string) => (/^0*$/.test(v) ? null : v.replace(/^0+/, ""));
    out.push({
      lineNum: out.length + 1,
      counterAccount: get(r, "counterAccount") || null,
      counterName: get(r, "counterName") || null,
      vs: sym(get(r, "vs")),
      ks: sym(get(r, "ks")),
      ss: sym(get(r, "ss")),
      reference: get(r, "reference") || null,
      cents,
      date,
      message: msg.slice(0, 255) || null,
      dateOk: true,
    });
  });

  const credit = out.filter((l) => l.cents > BigInt(0)).reduce((a, l) => a + l.cents, BigInt(0));
  const debit = out.filter((l) => l.cents < BigInt(0)).reduce((a, l) => a - l.cents, BigInt(0));
  const opening = hv.opening ? parseAmount(hv.opening, f.decimalSeparator) : null;
  const closingHdr = hv.closing ? parseAmount(hv.closing, f.decimalSeparator) : null;
  const dateFrom = hv.dateFrom ? parseDate(hv.dateFrom, f.dateFormat) : (out[0]?.date ?? null);
  const dateTo = hv.dateTo ? parseDate(hv.dateTo, f.dateFormat) : (out[out.length - 1]?.date ?? null);
  const open = opening ?? BigInt(0);
  // číslo výpisu: z hlavičky, jinak období (výpis za období z internetového bankovnictví)
  const statementNum = (hv.statementNum || (dateFrom && dateTo ? `${dateFrom.replace(/-/g, "")}-${dateTo.replace(/-/g, "")}` : fileName.replace(/\.[^.]+$/, ""))).slice(0, 40);
  return {
    account: (hv.accountNum ?? "").replace(/\s/g, ""),
    accountName: null,
    iban: hv.iban ? hv.iban.replace(/\s/g, "").toUpperCase() : null,
    statementNum,
    date: dateTo ?? new Date().toISOString().slice(0, 10),
    dateFrom,
    opening: open,
    // bez konečného zůstatku v hlavičce se dopočítá (kontrola součtů pak jen formální)
    closing: closingHdr ?? open + credit - debit,
    debit,
    credit,
    lines: out,
    fileAccount: accountFromFileName(fileName, f.fileNamePattern),
  };
}

/** Specifikace z DB → CsvFormat. */
export function toCsvFormat(fmt: RecordData, fields: RecordData[]): CsvFormat {
  return {
    code: String(fmt.code),
    detect: (fmt.detect as string) ?? null,
    fileNamePattern: (fmt.fileNamePattern as string) ?? null,
    encoding: String(fmt.encoding ?? "cp1250"),
    delimiter: String(fmt.delimiter ?? ";"),
    decimalSeparator: String(fmt.decimalSeparator ?? ","),
    dateFormat: String(fmt.dateFormat ?? "dd.MM.yyyy"),
    linesStart: (fmt.linesStart as string) ?? null,
    fields: fields.map((x) => ({ section: String(x.section), target: String(x.target), source: String(x.source) })),
  };
}

/** Patří výpis k bankovnímu účtu? (IBAN, číslo účtu bez kódu banky, číslo z názvu souboru) */
export function csvMatchesAccount(st: CsvStatement, acc: RecordData): boolean {
  const digits = (v: unknown) => String(v ?? "").replace(/\/\d{4}$/, "").replace(/\D/g, "").replace(/^0+/, "");
  if (st.iban && acc.iban && String(acc.iban).replace(/\s/g, "").toUpperCase() === st.iban) return true;
  const own = digits(acc.accountNum);
  if (!own) return false;
  return (!!st.account && digits(st.account) === own) || (!!st.fileAccount && digits(st.fileAccount) === own);
}
