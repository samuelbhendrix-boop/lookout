import { NextResponse, type NextRequest } from "next/server";

// Edge-cheap gate: redirects cookie-less visitors to /login. Real session validation
// (DB lookup, expiry, membership) happens server-side in getSession().
const PUBLIC = ["/login", "/signup"];
const PUBLIC_PREFIX = ["/join/"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasCookie = req.cookies.has("lk_session");
  if (!hasCookie && !PUBLIC.includes(pathname) && !PUBLIC_PREFIX.some((p) => pathname.startsWith(p))) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Pages only — API routes return 401 JSON themselves.
  matcher: ["/((?!api|_next|favicon.ico).*)"],
};
