/** Pole formuláře portálu – podmíněné zobrazení (stejné pravidlo na stránce i na serveru). */
/** „Zobrazit, když“: „klíč=hodnota“ nebo „klíč“ (zaškrtnuté / vyplněné). Stejné pravidlo na stránce. */
export function formFieldVisible(showIf: string, answers: Record<string, unknown>): boolean {
  const rule = String(showIf ?? "").trim();
  if (!rule) return true;
  const i = rule.indexOf("=");
  if (i < 0) {
    const v = answers[rule];
    return v === true || (typeof v === "string" && v.trim() !== "" && v !== "false");
  }
  return String(answers[rule.slice(0, i).trim()] ?? "").trim() === rule.slice(i + 1).trim();
}
