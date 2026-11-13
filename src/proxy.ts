import { NextResponse, type NextRequest } from "next/server";

/**
 * Jen rychlé přesměrování nepřihlášených na /login. Skutečné ověření
 * (platnost relace, oprávnění) dělá každá stránka a akce na serveru.
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.has("shanon_session")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // api/files: nahrávání souborů (proxy by omezilo velikost těla); relaci ověřuje route
  // api/v1: REST API s vlastní autorizací klíčem (bez přihlášení)
  matcher: ["/((?!login|_next/|icon.png|logo|api/health|api/files|api/v1).*)"],
};
