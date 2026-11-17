/**
 * Kód nové účtované firmy ze zkratky názvu (místo IČO): bez právní formy a diakritiky, počáteční
 * písmena slov doplněná písmeny prvního slova na 4 znaky („Uzeniny Hynek Cibulka s.r.o.“ → UHCZ,
 * „Shanon a.s.“ → SHAN). Obsazený kód: poslední znaky nahradí číslo (SHA2 … SHA9, SH10 …).
 */
const LEGAL_FORMS = /\b(spol\.?\s*s\s*r\.?\s*o\.?|s\.?\s*r\.?\s*o\.?|a\.?\s*s\.?|v\.?\s*o\.?\s*s\.?|k\.?\s*s\.?|z\.?\s*s\.?|o\.?\s*p\.?\s*s\.?|z\.?\s*[uú]\.?|s\.?\s*p\.?|se|gmbh|ag|ltd\.?|llc|inc\.?|sp\.?\s*z\s*o\.?\s*o\.?)(?=\s|$|,)/gi;

export function companyCodeFromName(name: string, taken: Iterable<string> = [], len = 4): string {
  const plain = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(LEGAL_FORMS, " ")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .trim()
    .toUpperCase();
  const words = plain.split(/\s+/).filter(Boolean);
  let base = words.map((w) => w[0]).join("").slice(0, len);
  const first = words[0] ?? "";
  for (let i = 1; base.length < len && i < first.length; i++) base += first[i];
  if (!base) base = "FIRMA".slice(0, len);
  const used = new Set([...taken].map((c) => String(c).toUpperCase()));
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const suffix = String(n);
    const code = base.slice(0, Math.max(1, len - suffix.length)) + suffix;
    if (!used.has(code)) return code;
  }
  return `${base}${Date.now() % 100000}`;
}
