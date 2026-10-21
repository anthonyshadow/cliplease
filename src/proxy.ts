import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { PAGE_PATH_HEADER, signInPath } from "@/lib/sign-in";

// An optimistic gate only (02 §4.5): no session cookie → /sign-in?next=…. Every page and action re-checks the session,
// and a page's gate sends a signed-out visitor (a stale cookie) back to the same path and query.
export function proxy(request: NextRequest) {
  const page = request.nextUrl.pathname + request.nextUrl.search;
  if (!getSessionCookie(request)) {
    return NextResponse.redirect(new URL(signInPath(page), request.url));
  }
  const headers = new Headers(request.headers);
  headers.set(PAGE_PATH_HEADER, page);
  return NextResponse.next({ request: { headers } });
}

// P20b adds "/licenses/:path*" (07 D126).
export const config = {
  matcher: ["/dashboard/:path*", "/onboarding", "/admin/:path*"],
};
