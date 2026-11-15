import { NextResponse, type NextRequest } from "next/server";
import { RESERVED_PATHS } from "@/lib/reserved-paths";

/**
 * Jen rychlé přesměrování nepřihlášených na /login. Skutečné ověření
 * (platnost relace, oprávnění) dělá každá stránka a akce na serveru.
 */
export function proxy(request: NextRequest) {
  // jednoduchá adresa dodavatelského portálu: /<zkratka organizace>/<portál>
  const m = /^\/([a-z0-9][a-z0-9-]{1,39})\/([a-z0-9][a-z0-9-]{0,39})\/?$/.exec(request.nextUrl.pathname);
  if (m && !RESERVED_PATHS.has(m[1])) return NextResponse.rewrite(new URL(`/portal/${m[1]}/${m[2]}`, request.url));
  if (!request.cookies.has("shanon_session")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // api/files: nahrávání souborů (proxy by omezilo velikost těla); relaci ověřuje route
  // api/v1: REST API s vlastní autorizací klíčem (bez přihlášení)
  // portal, api/portal: dodavatelský portál (veřejný odkaz s tajným klíčem, limity v src/server/supplier-portal.ts)
  matcher: ["/((?!login|_next/|icon.png|logo|api/health|api/files|api/v1|api/portal|portal/).*)"],
};
