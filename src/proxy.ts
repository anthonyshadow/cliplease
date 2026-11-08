import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { PAGE_PATH_HEADER, signInPath } from "@/lib/sign-in";

/** The public record (owner answer Q-184): no session check, only the page path its not-found view reads for the code. */
const PUBLIC_RECORD = /^\/verify(?:\/|$)/;

// An optimistic gate only (02 §4.5): no session cookie → /sign-in?next=…. Every page and action re-checks the session,
// and a page's gate sends a signed-out visitor (a stale cookie) back to the same path and query. /verify passes
// through ungated: it is matched only to forward its path.
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const page = pathname + search;
  if (!PUBLIC_RECORD.test(pathname) && !getSessionCookie(request)) {
    return NextResponse.redirect(new URL(signInPath(page), request.url));
  }
  const headers = new Headers(request.headers);
  headers.set(PAGE_PATH_HEADER, page);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/onboarding",
    "/admin/:path*",
    "/licenses/:path*",
    "/verify/:path*",
  ],
};
