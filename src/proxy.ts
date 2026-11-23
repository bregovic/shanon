import { NextResponse, type NextRequest } from "next/server";
import { RESERVED_PATHS, SHOP_PATHS } from "@/lib/reserved-paths";

/**
 * Jen rychlé přesměrování nepřihlášených na /login. Skutečné ověření
 * (platnost relace, oprávnění) dělá každá stránka a akce na serveru.
 */
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // jednoduchá adresa dodavatelského portálu: /<zkratka organizace>/<portál>
  const m = /^\/([a-z0-9][a-z0-9-]{1,39})\/([a-z0-9][a-z0-9-]{0,39})\/?$/.exec(path);
  if (m && !RESERVED_PATHS.has(m[1]) && !SHOP_PATHS.has(m[2])) return NextResponse.rewrite(new URL(`/portal/${m[1]}/${m[2]}`, request.url));
  // e-shop organizace: /<zkratka> a /<zkratka>/(p|k|kosik|objednavka|info)/…
  const s = /^\/([a-z0-9][a-z0-9-]{1,39})(\/(?:p|k|kosik|objednavka|info)(?:\/[^?#]*)?)?\/?$/.exec(path);
  if (s && !RESERVED_PATHS.has(s[1])) {
    const url = request.nextUrl.clone();
    url.pathname = `/eshop/${s[1]}${s[2] ?? ""}`;
    return NextResponse.rewrite(url);
  }
  if (!request.cookies.has("shanon_session")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // api/files: nahrávání souborů (proxy by omezilo velikost těla); relaci ověřuje route
  // api/v1: REST API s vlastní autorizací klíčem (bez přihlášení); api/station: tisková stanice (klíč stanice)
  // stanice: zástupce Shanon Pokladna si zapamatuje počítač a pokračuje na přihlášení / úvod
  // portal, api/portal: dodavatelský portál (veřejný odkaz s tajným klíčem, limity v src/server/supplier-portal.ts)
  // eshop, api/eshop: veřejný e-shop (src/server/eshop.ts); api/pay: oznámení platební brány
  // p/, api/p/: aplikace Portál (vlastní přihlášení, src/server/portal-auth.ts); manifesty a ikony aplikací
  matcher: ["/((?!login|_next/|icon.png|logo|api/health|api/files|api/v1|api/station|stanice|api/portal|portal/|api/eshop|eshop/|api/pay/|pay-sim/|api/pay-sim/|p/|api/p/|manifest.webmanifest|pos-sw.js|portal-app.webmanifest|icons/).*)"],
};
