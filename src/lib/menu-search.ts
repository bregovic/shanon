/** Hledání v položkách menu: bez diakritiky a velikosti, všechna slova (v názvu, modulu nebo sekci). */
export interface MenuHit {
  module: string;
  moduleLabel: string;
  icon: string;
  section: string;
  label: string;
  href: string;
}

export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export function searchMenu<T extends MenuHit>(menu: T[], q: string, limit = 12): T[] {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored: { e: T; score: number }[] = [];
  for (const e of menu) {
    const label = fold(e.label);
    const hay = `${label} ${fold(e.moduleLabel)} ${fold(e.section)}`;
    if (!words.every((w) => hay.includes(w))) continue;
    // přednost: název začíná slovem, pak obsahuje, pak shoda jen v modulu/sekci
    const score = words.reduce((a, w) => a + (label.startsWith(w) ? 3 : label.includes(` ${w}`) ? 2 : label.includes(w) ? 1 : 0), 0);
    scored.push({ e, score });
  }
  // stejná stránka může být v menu víckrát (např. v oblíbených sekcích) — jednou
  const seen = new Set<string>();
  return scored
    .sort((a, b) => b.score - a.score || a.e.label.localeCompare(b.e.label, "cs"))
    .map((x) => x.e)
    .filter((e) => (seen.has(e.href) ? false : (seen.add(e.href), true)))
    .slice(0, limit);
}
