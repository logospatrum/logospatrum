/**
 * Issues the per-browser `pat_uid` cookie used as the budget subject key.
 *
 * Runs on every page + /api/* request (matcher below excludes statics).
 * Token computation lives in `layout.tsx` (Node runtime), not here, because
 * `node:crypto.createHmac` isn't available in Next.js' default Edge runtime
 * for middleware. UUID generation uses Web Crypto (`crypto.randomUUID`)
 * which IS available in Edge.
 *
 * Cookie attributes: HttpOnly (JS can't read it), Secure in prod (HTTPS only),
 * SameSite=Lax (sent on top-level navigations + same-site requests), Path=/,
 * Max-Age=1 year.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE = "pat_uid";

export function middleware(req: NextRequest) {
  const existing = req.cookies.get(COOKIE)?.value;
  if (existing) return NextResponse.next();

  const patUid = crypto.randomUUID();
  const res = NextResponse.next();
  res.cookies.set(COOKIE, patUid, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}

export const config = {
  matcher: [
    // Skip Next.js static assets and image optimization endpoints, plus
    // bare image files served from /public. Everything else gets the cookie.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)).*)",
  ],
};
