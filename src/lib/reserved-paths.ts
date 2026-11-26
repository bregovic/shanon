/**
 * První části adres, které patří aplikaci (moduly, systémové stránky). Zkratka organizace pro
 * veřejné odkazy (/<zkratka>/<portál>) nesmí být mezi nimi. Test hlídá, že seznam pokrývá všechny
 * moduly a stránky v src/app.
 */
export const RESERVED_PATHS = new Set([
  // systémové cesty
  "api", "login", "logout", "portal", "help", "settings", "profile", "system", "report", "print", "kasa", "_next", "favicon.ico", "icon.png", "logo",
  "admin", "app", "static", "public", "www", "shanon", "eshop", "pay-sim", "stanice", "sablony",
  // aplikace Portál (zaměstnanci, dodavatelé) a soubory instalovatelných aplikací
  "p", "manifest.webmanifest", "portal-app.webmanifest", "icons",
  // moduly
  "sys", "gl", "gab", "tax", "ar", "ap", "bank", "cash", "inv", "pos", "whs", "int", "prt", "org", "qa", "shop", "wf", "hr",
]);

/**
 * Druhá část adresy e-shopu (/<zkratka>/<část>/…): položka, kategorie, košík, objednávka, stránka.
 * Adresa dodavatelského portálu nesmí být jedna z nich.
 */
export const SHOP_PATHS = new Set(["p", "k", "kosik", "objednavka", "info"]);

/** Zkratka pro veřejné odkazy: malá písmena, číslice, pomlčka, 2–40 znaků, ne vyhrazené slovo. */
export const PUBLIC_SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;
export const isPublicSlug = (s: string) => PUBLIC_SLUG.test(s) && !RESERVED_PATHS.has(s);
