/**
 * Zadávání data jako v AX: „d“ (nebo „t“, „dnes“) = dnes, „d+3“ / „d-1“ / „+3“ = posun
 * o dny, „15“ = 15. aktuálního měsíce, „1511“ = 15. 11. letos, „151126“ / „15112026“,
 * „15.11.“, „15.11.26“, „15/11/2026“, ISO „2026-11-15“. Vrací ISO datum, null pro
 * prázdné, undefined pro neplatné.
 */
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function make(y: number, m: number, d: number): string | undefined {
  if (y < 100) y += 2000;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? iso(dt) : undefined;
}

export function parseDateInput(text: string, today = new Date()): string | null | undefined {
  const s = text.trim().toLowerCase();
  if (!s) return null;
  const rel = /^(?:d|t|dnes|today)?\s*([+-])\s*(\d{1,4})$/.exec(s);
  if (["d", "t", "dnes", "today"].includes(s)) return iso(today);
  if (rel) {
    const d = new Date(today);
    d.setDate(d.getDate() + (rel[1] === "-" ? -1 : 1) * Number(rel[2]));
    return iso(d);
  }
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return make(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[./-](\d{1,2})[./-]?(\d{2}|\d{4})?$/.exec(s.replace(/\s+/g, ""));
  if (m) return make(m[3] ? +m[3] : today.getFullYear(), +m[2], +m[1]);
  if (/^\d+$/.test(s)) {
    const y = today.getFullYear();
    const mo = today.getMonth() + 1;
    if (s.length <= 2) return make(y, mo, +s);
    if (s.length === 4) return make(y, +s.slice(2, 4), +s.slice(0, 2));
    if (s.length === 6) return make(+s.slice(4, 6), +s.slice(2, 4), +s.slice(0, 2));
    if (s.length === 8) return make(+s.slice(4, 8), +s.slice(2, 4), +s.slice(0, 2));
  }
  return undefined;
}

/** ISO → zobrazení podle jazyka (cs 15.11.2026, en 15/11/2026). */
export function formatDateInput(v: unknown, lang: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ""));
  if (!m) return "";
  return lang === "en" ? `${m[3]}/${m[2]}/${m[1]}` : `${+m[3]}.${+m[2]}.${m[1]}`;
}
