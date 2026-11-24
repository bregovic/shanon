/**
 * Registr aplikace pro moduly (src/modules), které ho potřebují až při volání (workflow, testy napojení).
 * Moduly nesmí importovat `@/registry` přímo: registr importuje všechny moduly, takže by vznikla smyčka
 * a v produkčním sestavení by registr podle pořadí načtení narazil na nehotový modul („Cannot access … before
 * initialization“). `src/registry.ts` registr po sestavení nastaví sem.
 */
import type { Registry } from "./module";

let current: Registry | null = null;

export function setAppRegistry(r: Registry): void {
  current = r;
}

export function appRegistry(): Registry {
  if (!current) throw new Error("Registr aplikace ještě není sestavený");
  return current;
}
