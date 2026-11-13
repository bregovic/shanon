/**
 * Návrat „odkud jsem přišel“ (Esc). Hlavička si v relaci prohlížeče pamatuje
 * cestu v aplikaci; když předchozí stránka existuje, Esc jde zpět historií
 * (i se stavem gridu), jinak na výchozí stránku (seznam / plocha modulu).
 */
const KEY = "shanon_nav";

export function trackNavigation(path: string) {
  try {
    const stack: string[] = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
    if (stack[stack.length - 1] === path) return;
    // návrat zpět historií = odebrat poslední krok
    if (stack[stack.length - 2] === path) stack.pop();
    else stack.push(path);
    sessionStorage.setItem(KEY, JSON.stringify(stack.slice(-50)));
  } catch {
    /* úložiště nedostupné */
  }
}

export function canGoBack(): boolean {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "[]").length > 1;
  } catch {
    return false;
  }
}

export function goBack(router: { back(): void; push(href: string): void }, fallback?: string) {
  if (canGoBack()) router.back();
  else if (fallback) router.push(fallback);
}
