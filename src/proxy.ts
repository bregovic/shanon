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
  matcher: ["/((?!login|_next/|favicon.ico|api/health).*)"],
};
