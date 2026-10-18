// A stand-in for `next/headers` in [int] tests, for code that calls headers() outside a request. In each file:
//   vi.mock("next/headers", () => import("../../helpers/next-headers"));
// Better Auth's nextCookies plugin keeps the real module (node_modules aren't mocked) and does nothing outside a request.
let current = new Headers();

/** The request the next headers() call sees: `cookie` is its Cookie header value, or null for none. */
export function mockNextHeaders(cookie: string | null) {
  current = new Headers(cookie ? { cookie } : undefined);
}

export async function headers(): Promise<Headers> {
  return new Headers(current);
}
