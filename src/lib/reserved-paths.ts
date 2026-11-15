/**
 * První části adres, které patří aplikaci (moduly, systémové stránky). Zkratka organizace pro
 * veřejné odkazy (/<zkratka>/<portál>) nesmí být mezi nimi. Test hlídá, že seznam pokrývá všechny
 * moduly a stránky v src/app.
 */
export const RESERVED_PATHS = new Set([
  // systémové cesty
  "api", "login", "logout", "portal", "help", "settings", "system", "report", "print", "kasa", "_next", "favicon.ico", "icon.png", "logo",
  "admin", "app", "static", "public", "www", "shanon",
  // moduly
  "sys", "gl", "gab", "tax", "ar", "ap", "bank", "cash", "inv", "pos", "whs", "int", "prt", "org", "qa",
]);

/** Zkratka pro veřejné odkazy: malá písmena, číslice, pomlčka, 2–40 znaků, ne vyhrazené slovo. */
export const PUBLIC_SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;
export const isPublicSlug = (s: string) => PUBLIC_SLUG.test(s) && !RESERVED_PATHS.has(s);
