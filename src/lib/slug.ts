/** Část adresy z názvu: bez diakritiky, malá písmena, pomlčky. */
export function slugify(s: string, fallback = "polozka"): string {
  return (
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || fallback
  );
}
