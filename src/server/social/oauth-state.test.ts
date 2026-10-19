import { afterEach, describe, expect, it, vi } from "vitest";
import { MINUTE_MS } from "../../lib/time";
import { createTokenCipher } from "../crypto/token-cipher";
import { env } from "../env";
import {
  type OAuthStatePayload,
  oauthCookieOptions,
  openOAuthState,
  parseReturnTo,
  sealOAuthState,
  stateMatches,
} from "./oauth-state";

const STATE = "A".repeat(43);

function payload(
  overrides: Partial<OAuthStatePayload> = {},
): OAuthStatePayload {
  return {
    provider: "mock",
    state: STATE,
    codeVerifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    userId: "user-1",
    returnTo: "/onboarding?step=connect",
    requestedScopes: ["mock.read"],
    createdAt: Date.now(),
    ...overrides,
  };
}

function flipMiddleByte(sealed: string): string {
  const parts = sealed.split(".");
  const bytes = Buffer.from(parts[4] as string, "base64url");
  const i = Math.floor(bytes.length / 2);
  bytes[i] = (bytes[i] as number) ^ 0x01;
  parts[4] = bytes.toString("base64url");
  return parts.join(".");
}

afterEach(() => vi.useRealTimers());

describe("sealOAuthState / openOAuthState (07 D37)", () => {
  it("round-trips the payload", () => {
    const p = payload();
    expect(openOAuthState(sealOAuthState(p))).toEqual(p);
  });

  it("refuses a missing, empty, garbage or tampered cookie", () => {
    expect(openOAuthState(undefined)).toBeNull();
    expect(openOAuthState("")).toBeNull();
    expect(openOAuthState("not-a-cookie")).toBeNull();
    expect(
      openOAuthState(flipMiddleByte(sealOAuthState(payload()))),
    ).toBeNull();
  });

  it("refuses a payload that fails its schema or comes from the future", () => {
    const bad = { ...payload(), state: "short" };
    expect(openOAuthState(sealOAuthState(bad))).toBeNull();
    const extra = { ...payload(), extra: 1 } as OAuthStatePayload;
    expect(openOAuthState(sealOAuthState(extra))).toBeNull();
    expect(
      openOAuthState(
        sealOAuthState(payload({ createdAt: Date.now() + MINUTE_MS })),
      ),
    ).toBeNull();
  });

  it("accepts a cookie up to 600 s old and refuses it at 601 s", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T12:00:00Z"));
    const sealed = sealOAuthState(payload());
    vi.setSystemTime(new Date("2026-10-18T12:10:00Z"));
    expect(openOAuthState(sealed)).not.toBeNull();
    vi.setSystemTime(new Date("2026-10-18T12:10:01Z"));
    expect(openOAuthState(sealed)).toBeNull();
  });

  it("refuses a cookie sealed under another key", () => {
    const other = createTokenCipher(Buffer.alloc(32, 3).toString("base64"));
    const foreign = createTokenCipher(
      other.deriveSubkey("oauth-state").toString("base64"),
    ).encrypt(JSON.stringify(payload()), "oauth-state");
    expect(openOAuthState(foreign)).toBeNull();
  });
});

describe("stateMatches and oauthCookieOptions", () => {
  it("compares in constant time and treats another length as a mismatch", () => {
    expect(stateMatches(STATE, STATE)).toBe(true);
    expect(stateMatches(`${"B".repeat(42)}A`, STATE)).toBe(false);
    expect(stateMatches("A", STATE)).toBe(false);
    expect(stateMatches(null, STATE)).toBe(false);
  });

  it("sets HttpOnly, SameSite=Lax, Path=/api/connect, Max-Age=600, and Secure only on https", () => {
    expect(oauthCookieOptions("http://localhost:3000")).toEqual({
      httpOnly: true,
      sameSite: "lax",
      path: "/api/connect",
      maxAge: 600,
      secure: false,
    });
    expect(oauthCookieOptions("https://cliplease.test").secure).toBe(true);
  });
});

describe("parseReturnTo (07 D37)", () => {
  const at = (path: string) => new URL(path, env.APP_URL).href;
  const LIBRARY = at("/dashboard/library");
  const ID = "0b9c5b8e-5a4f-4c1e-9d2a-3f6e7a8b9c0d";

  it.each([
    "/onboarding?step=connect",
    `/dashboard/videos/new?post=${ID}`,
    "/dashboard/connections",
    `/dashboard/library?platform=mock&account=${ID}`,
  ])("accepts %s", (raw) => {
    expect(parseReturnTo(raw).href).toBe(at(raw));
  });

  it.each([
    null,
    "",
    "//evil.com",
    "/\\evil.com",
    "https://evil.com",
    "/dashboard/../admin",
    "/dashboard/%2e%2e/admin",
    "/dashboard?next=//x",
    "/admin",
    "/api/connect/mock/start",
    "/dashboard/x/../connections",
    "https://user:pass@localhost/dashboard",
    "/dashboard/connections#frag",
  ])("sends %j to the Library", (raw) => {
    expect(parseReturnTo(raw).href).toBe(LIBRARY);
  });
});
