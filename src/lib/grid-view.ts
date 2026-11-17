/**
 * Zapamatované filtry a řazení seznamů (sessionStorage `grid:<objekt>`): platí, dokud uživatel neodejde z agendy —
 * návrat z detailu záznamu (/modul/objekt/<id>) je zachová, přechod jinam je zahodí.
 */
export function dropStaleGridViews(path: string): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (!k?.startsWith("grid:")) continue;
      const base = (JSON.parse(sessionStorage.getItem(k) ?? "{}") as { base?: string }).base;
      if (!base || (path !== base && !path.startsWith(`${base}/`))) sessionStorage.removeItem(k);
    }
  } catch {
    /* úložiště nedostupné */
  }
}
