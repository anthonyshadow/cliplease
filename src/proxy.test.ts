import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { PAGE_PATH_HEADER } from "@/lib/sign-in";
import { config, proxy } from "./proxy";

// The optimistic gate (02 §4.5) and /verify's pass-through (owner answer Q-184). NextResponse.next() carries the
// request header it overrides as x-middleware-request-{name}.
const ORIGIN = "http://localhost:3000";
const FORWARDED = `x-middleware-request-${PAGE_PATH_HEADER}`;

const request = (path: string, cookie?: string) =>
  new NextRequest(new URL(path, ORIGIN), {
    headers: cookie ? { cookie } : {},
  });

describe("proxy", () => {
  it("sends a signed-out visitor to sign-in with the page as next", () => {
    const response = proxy(request("/dashboard/videos?tab=all"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/sign-in?next=%2Fdashboard%2Fvideos%3Ftab%3Dall`,
    );
  });

  it("lets a session cookie through with the page path", () => {
    const response = proxy(
      request("/dashboard/videos", "better-auth.session_token=x"),
    );
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get(FORWARDED)).toBe("/dashboard/videos");
  });

  it("passes /verify through with no session, forwarding its path", () => {
    const response = proxy(request("/verify/CL-0000-0000?x=1"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get(FORWARDED)).toBe("/verify/CL-0000-0000?x=1");
  });

  it("gates a path that only starts like /verify", () => {
    expect(proxy(request("/verifying")).status).toBe(307);
  });

  it("matches /verify and its codes", () => {
    expect(config.matcher).toContain("/verify/:path*");
  });
});
