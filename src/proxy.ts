import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

// An optimistic gate only (02 §4.5): no session cookie → /sign-in?next=…. Every page and action re-checks the session.
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set(
      "next",
      request.nextUrl.pathname + request.nextUrl.search,
    );
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

// P20b adds "/licenses/:path*" (07 D126).
export const config = {
  matcher: ["/dashboard/:path*", "/onboarding", "/admin/:path*"],
};
