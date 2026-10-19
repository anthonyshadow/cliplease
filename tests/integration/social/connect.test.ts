import { and, asc, eq, type SQL } from "drizzle-orm";
import { NextRequest } from "next/server";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { GET as callbackGET } from "../../../src/app/api/connect/[provider]/callback/route";
import { GET as startGET } from "../../../src/app/api/connect/[provider]/start/route";
import { db } from "../../../src/db/client";
import { auditEvent, socialAccount } from "../../../src/db/schema";
import { MINUTE_MS } from "../../../src/lib/time";
import { decryptSecret } from "../../../src/server/crypto/token-cipher";
import { env } from "../../../src/server/env";
import { listAccountSummaries } from "../../../src/server/library/queries";
import {
  SocialAuthError,
  SocialUpstreamError,
} from "../../../src/server/social/errors";
import {
  OAUTH_COOKIE,
  OAUTH_STATE_MAX_AGE_S,
  openOAuthState,
} from "../../../src/server/social/oauth-state";
import {
  mockAccountIdFor,
  mockProvider,
  setMockScenarioForTests,
} from "../../../src/server/social/providers/mock";
import { redirectUriFor } from "../../../src/server/social/registry";
import {
  accessTokenAad,
  refreshTokenAad,
  storeTokens,
} from "../../../src/server/social/tokens";
import {
  mockNextHeaders,
  newCreatorEmail,
  signInWithOtp,
  userByEmail,
} from "../../helpers/auth";
import { resetDb } from "../../helpers/db";
import { insertCreator } from "../../helpers/factories";

// The connect round trip (02 §7.2, 07 D37) against the real route handlers: a real session (the gate reads it through
// next/headers), the sealed cookie carried from start to callback as a browser would, and the mock provider.
vi.mock("next/headers", () => import("../../helpers/next-headers"));

afterAll(resetDb);
beforeEach(() => mockNextHeaders(null));
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  setMockScenarioForTests(null);
});

const at = (path: string) => new URL(path, env.APP_URL).href;
const FROM_ONBOARDING = "?returnTo=%2Fonboarding%3Fstep%3Dconnect";
const params = (provider: string) => ({
  params: Promise.resolve({ provider }),
});

type Creator = { session: string; userId: string; creatorId: string };

/** A signed-in creator; the session becomes the request headers the gates read. */
async function signedInCreator(): Promise<Creator> {
  const email = newCreatorEmail();
  const session = await signInWithOtp(email);
  const owner = await userByEmail(email);
  const creator = await insertCreator({ userId: owner.id });
  mockNextHeaders(session);
  return { session, userId: owner.id, creatorId: creator.id };
}

function start(
  query = "?returnTo=%2Fdashboard%2Fconnections",
  provider = "mock",
) {
  return startGET(
    new NextRequest(at(`/api/connect/${provider}/start${query}`)),
    params(provider),
  );
}

function callback(url: string, cookie: string | null, provider = "mock") {
  return callbackGET(
    new NextRequest(url, cookie ? { headers: { cookie } } : undefined),
    params(provider),
  );
}

/** The response's Set-Cookie line for the oauth cookie. */
function cookieLine(response: Response): string {
  const line = response.headers
    .getSetCookie()
    .find((l) => l.startsWith(`${OAUTH_COOKIE}=`));
  if (!line) throw new Error("no oauth Set-Cookie");
  return line;
}

/** The `cliplease_oauth=<sealed>` pair a browser sends back. */
const oauthPair = (response: Response) =>
  cookieLine(response).split(";")[0] as string;

const location = (response: Response) =>
  response.headers.get("location") as string;

/** start → callback with the cookie, as the browser follows the mock's redirect. */
async function connect(query?: string) {
  const started = await start(query);
  return callback(location(started), oauthPair(started));
}

function expectCookieCleared(response: Response) {
  const line = cookieLine(response);
  expect(line).toMatch(/^cliplease_oauth=;/);
  expect(line).toMatch(/Path=\/api\/connect/i);
  expect(line).toMatch(/Expires=Thu, 01 Jan 1970/i);
}

async function accountsOf(creatorId: string) {
  return db
    .select()
    .from(socialAccount)
    .where(eq(socialAccount.creatorId, creatorId));
}

// Bound before any spy, so a second grantScopes still reaches the real exchange.
const realExchange = mockProvider.exchangeCode.bind(mockProvider);

/** The platform grants these scopes instead of the mock's own. */
function grantScopes(scopes: string[]) {
  return vi
    .spyOn(mockProvider, "exchangeCode")
    .mockImplementation(async (i) => ({ ...(await realExchange(i)), scopes }));
}

/** Marks the matching rows disconnected, as P08's Disconnect will. */
function disconnectWhere(where: SQL) {
  return db
    .update(socialAccount)
    .set({
      status: "disconnected",
      accessTokenEnc: null,
      refreshTokenEnc: null,
      disconnectedAt: new Date(),
    })
    .where(where);
}

async function linkedAudits(socialAccountId: string) {
  return db
    .select({ data: auditEvent.data })
    .from(auditEvent)
    .where(
      and(
        eq(auditEvent.action, "social_account.linked"),
        eq(auditEvent.entityId, socialAccountId),
      ),
    )
    .orderBy(asc(auditEvent.createdAt));
}

describe("start", () => {
  it("seals the cookie and sends the creator to the mock's authorize URL", async () => {
    await signedInCreator();
    const response = await start();
    expect(response.status).toBe(302);
    const target = new URL(location(response));
    expect(`${target.origin}${target.pathname}`).toBe(redirectUriFor("mock"));
    expect(target.searchParams.get("code")).toMatch(
      /^mock_code_[0-9a-f]{8}\.[A-Za-z0-9_-]{43}$/,
    );
    expect(target.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const line = cookieLine(response);
    expect(line).toMatch(/HttpOnly/i);
    expect(line).toMatch(/SameSite=lax/i);
    expect(line).toMatch(/Path=\/api\/connect/i);
    expect(line).toMatch(/Max-Age=600/i);
    expect(line).not.toMatch(/Secure/i);
    expect(line).not.toContain("mock_");
  });

  it("sends a signed-out visitor to sign-in, and answers 404 for an unknown or disabled platform", async () => {
    const signedOut = await start();
    expect(signedOut.status).toBe(302);
    const target = new URL(location(signedOut));
    expect(target.pathname).toBe("/sign-in");
    expect(target.searchParams.get("next")).toBe("/dashboard/connections");

    await signedInCreator();
    expect((await start("", "nope")).status).toBe(404);
    expect((await start("", "youtube")).status).toBe(404);
  });
});

describe("callback", () => {
  it("links the account with sealed tokens and lands on returnTo with connected=mock", async () => {
    const me = await signedInCreator();
    const response = await connect();
    expect(response.status).toBe(302);
    expect(location(response)).toBe(
      at("/dashboard/connections?connected=mock"),
    );
    expectCookieCleared(response);

    const rows = await accountsOf(me.creatorId);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    if (!row) throw new Error("no row");
    expect(row).toMatchObject({
      provider: "mock",
      status: "connected",
      providerAccountId: mockAccountIdFor(me.userId),
      username: "demo.creator",
      scopes: ["mock.read"],
    });
    expect(row.tokenRefreshedAt).toBeInstanceOf(Date);
    expect(row.connectedAt).toBeInstanceOf(Date);
    for (const sealed of [row.accessTokenEnc, row.refreshTokenEnc]) {
      expect(sealed).toMatch(/^v1\./);
      expect(sealed).not.toMatch(/mock_access_|mock_refresh_/);
    }
    expect(
      decryptSecret(row.accessTokenEnc as string, accessTokenAad(row.id)),
    ).toMatch(/^mock_access_/);
    expect(
      decryptSecret(row.refreshTokenEnc as string, refreshTokenAad(row.id)),
    ).toMatch(/^mock_refresh_/);

    const audits = await linkedAudits(row.id);
    expect(audits).toEqual([
      { data: { socialAccountId: row.id, provider: "mock", created: true } },
    ]);
    expect(JSON.stringify(audits)).not.toMatch(
      /demo\.creator|mock_access|mock_refresh/,
    );
  });

  it("refuses a tampered cookie, a changed state and another user's cookie before any exchange", async () => {
    const a = await signedInCreator();
    const exchange = vi.spyOn(mockProvider, "exchangeCode");

    const started = await start();
    const [name, sealed] = oauthPair(started).split("=") as [string, string];
    const tampered = `${name}=${sealed.slice(0, -4)}${sealed.slice(-4) === "AAAA" ? "BBBB" : "AAAA"}`;
    let response = await callback(location(started), tampered);
    expect(location(response)).toBe(at("/dashboard/connections?error=state"));
    expectCookieCleared(response);

    for (const state of ["B".repeat(43), "short"]) {
      const s = await start(FROM_ONBOARDING);
      const url = new URL(location(s));
      url.searchParams.set("state", state);
      response = await callback(url.href, oauthPair(s));
      expect(location(response)).toBe(at("/dashboard/connections?error=state"));
      expectCookieCleared(response);
    }

    const fromA = await start(FROM_ONBOARDING);
    await signedInCreator(); // B's session now
    response = await callback(location(fromA), oauthPair(fromA));
    expect(location(response)).toBe(at("/dashboard/connections?error=state"));
    expectCookieCleared(response);

    expect(exchange).not.toHaveBeenCalled();
    expect(await accountsOf(a.creatorId)).toEqual([]);
  });

  it("refuses no cookie, an expired one and one for another platform (J2.9)", async () => {
    await signedInCreator();
    const exchange = vi.spyOn(mockProvider, "exchangeCode");

    const s1 = await start();
    let response = await callback(location(s1), null);
    expect(location(response)).toBe(at("/dashboard/connections?error=state"));
    expectCookieCleared(response);

    vi.useFakeTimers({ toFake: ["Date"] });
    const s2 = await start();
    vi.setSystemTime(Date.now() + (OAUTH_STATE_MAX_AGE_S + 1) * 1000);
    response = await callback(location(s2), oauthPair(s2));
    expect(location(response)).toBe(at("/dashboard/connections?error=state"));
    vi.useRealTimers();

    const s3 = await start();
    response = await callback(
      location(s3).replace("/mock/", "/youtube/"),
      oauthPair(s3),
      "youtube",
    );
    expect(location(response)).toBe(at("/dashboard/connections?error=state"));
    expectCookieCleared(response);
    expect(exchange).not.toHaveBeenCalled();
  });

  it("maps the platform's ?error to denied, on the returnTo, with no row (J2.3)", async () => {
    const me = await signedInCreator();
    const s = await start(FROM_ONBOARDING);
    const url = new URL(location(s));
    url.searchParams.delete("code");
    url.searchParams.set("error", "access_denied");
    const response = await callback(url.href, oauthPair(s));
    expect(location(response)).toBe(
      at("/onboarding?step=connect&error=denied"),
    );
    expectCookieCleared(response);
    expect(await accountsOf(me.creatorId)).toEqual([]);
  });

  it("refuses a connect without the required scope and gives the tokens back (J2.5)", async () => {
    const me = await signedInCreator();
    const exchange = grantScopes([]);
    const revoke = vi.spyOn(mockProvider, "revoke");
    const response = await connect();
    expect(location(response)).toBe(
      at("/dashboard/connections?error=missing_scope"),
    );
    expectCookieCleared(response);
    expect(await accountsOf(me.creatorId)).toEqual([]);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith(
      await exchange.mock.results.at(-1)?.value,
    );
  });

  it("still redirects when giving the tokens back fails", async () => {
    await signedInCreator();
    grantScopes([]);
    vi.spyOn(mockProvider, "revoke").mockRejectedValue(new Error("down"));
    const response = await connect();
    expect(location(response)).toBe(
      at("/dashboard/connections?error=missing_scope"),
    );
  });

  it("refuses an account another creator holds, leaves theirs alone and gives the tokens back (J2.7)", async () => {
    setMockScenarioForTests("shared_account");
    const a = await signedInCreator();
    expect(location(await connect())).toBe(
      at("/dashboard/connections?connected=mock"),
    );
    const [before] = await accountsOf(a.creatorId);

    const b = await signedInCreator();
    const exchange = vi.spyOn(mockProvider, "exchangeCode");
    const revoke = vi.spyOn(mockProvider, "revoke");
    const response = await connect(FROM_ONBOARDING);
    expect(location(response)).toBe(
      at("/onboarding?step=connect&error=already_linked"),
    );
    expectCookieCleared(response);
    expect(await accountsOf(b.creatorId)).toEqual([]);
    expect(await accountsOf(a.creatorId)).toEqual([before]);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith(
      await exchange.mock.results.at(-1)?.value,
    );
    await db
      .delete(socialAccount)
      .where(eq(socialAccount.providerAccountId, "mock_acct_shared"));
  });

  it("answers a failed exchange, profile read or save with provider_error and keeps the grant (07 D37)", async () => {
    const me = await signedInCreator();
    const revoke = vi.spyOn(mockProvider, "revoke");

    const exchange = vi
      .spyOn(mockProvider, "exchangeCode")
      .mockRejectedValueOnce(new SocialAuthError());
    let response = await connect(FROM_ONBOARDING);
    expect(location(response)).toBe(
      at("/onboarding?step=connect&error=provider_error"),
    );
    expectCookieCleared(response);
    exchange.mockRestore();

    const profile = vi
      .spyOn(mockProvider, "getProfile")
      .mockRejectedValueOnce(new SocialUpstreamError());
    response = await connect();
    expect(location(response)).toBe(
      at("/dashboard/connections?error=provider_error"),
    );
    profile.mockRestore();

    // A NUL byte in the username makes the database refuse the row: a failure that isn't a unique violation.
    const real = mockProvider.getProfile.bind(mockProvider);
    vi.spyOn(mockProvider, "getProfile").mockImplementation(async (token) => ({
      ...(await real(token)),
      username: "demo\u0000creator",
    }));
    response = await connect();
    expect(location(response)).toBe(
      at("/dashboard/connections?error=provider_error"),
    );

    expect(revoke).not.toHaveBeenCalled();
    expect(await accountsOf(me.creatorId)).toEqual([]);
  });

  it("asks for nothing extra with insights=1 on the mock, and stores its granted scope", async () => {
    const me = await signedInCreator();
    const started = await start(
      "?returnTo=%2Fdashboard%2Fconnections&insights=1",
    );
    const sealed = oauthPair(started).slice(`${OAUTH_COOKIE}=`.length);
    expect(openOAuthState(sealed)?.requestedScopes).toEqual(["mock.read"]);
    const response = await callback(location(started), oauthPair(started));
    expect(location(response)).toBe(
      at("/dashboard/connections?connected=mock"),
    );
    expect((await accountsOf(me.creatorId))[0]?.scopes).toEqual(["mock.read"]);
  });

  it("storeTokens keeps the stored refresh token when the new set has none (03 §7.2)", async () => {
    const me = await signedInCreator();
    await connect();
    const [before] = await accountsOf(me.creatorId);
    if (!before) throw new Error("no row");
    const later = new Date(Date.now() + MINUTE_MS);
    await storeTokens(
      db,
      before.id,
      {
        accessToken: "mock_access_00000000_next",
        accessTokenExpiresAt: later,
        refreshToken: null,
        refreshTokenExpiresAt: null,
        scopes: ["mock.read"],
      },
      later,
    );
    const [after] = await accountsOf(me.creatorId);
    expect(
      decryptSecret(after?.accessTokenEnc as string, accessTokenAad(before.id)),
    ).toBe("mock_access_00000000_next");
    expect(after?.tokenRefreshedAt?.getTime()).toBe(later.getTime());
    expect(after?.refreshTokenEnc).toBe(before.refreshTokenEnc);
    expect(after?.refreshTokenExpiresAt).toEqual(before.refreshTokenExpiresAt);
  });

  it("reconnecting the same account keeps one row with new tokens and no revoke (J2.8)", async () => {
    const me = await signedInCreator();
    await connect();
    const [first] = await accountsOf(me.creatorId);
    if (!first) throw new Error("no row");
    const revoke = vi.spyOn(mockProvider, "revoke");
    await new Promise((resolve) => setTimeout(resolve, 5));

    const response = await connect();
    expect(location(response)).toBe(
      at("/dashboard/connections?connected=mock"),
    );
    const rows = await accountsOf(me.creatorId);
    expect(rows).toHaveLength(1);
    const [second] = rows;
    if (!second) throw new Error("no row");
    expect(second.id).toBe(first.id);
    expect(
      decryptSecret(second.accessTokenEnc as string, accessTokenAad(second.id)),
    ).not.toBe(
      decryptSecret(first.accessTokenEnc as string, accessTokenAad(first.id)),
    );
    expect(second.connectedAt.getTime()).toBeGreaterThan(
      first.connectedAt.getTime(),
    );
    expect(revoke).not.toHaveBeenCalled();
    expect((await linkedAudits(first.id)).map((a) => a.data.created)).toEqual([
      true,
      false,
    ]);
  });

  it("reconnects a disconnected row in place", async () => {
    const me = await signedInCreator();
    await connect();
    const [row] = await accountsOf(me.creatorId);
    if (!row) throw new Error("no row");
    await disconnectWhere(eq(socialAccount.id, row.id));

    await connect();
    const [again] = await accountsOf(me.creatorId);
    expect(again).toMatchObject({
      id: row.id,
      status: "connected",
      disconnectedAt: null,
    });
    expect(again?.accessTokenEnc).toMatch(/^v1\./);
  });

  it("comes back to onboarding when the connect started there (07 D37)", async () => {
    await signedInCreator();
    const response = await connect(FROM_ONBOARDING);
    expect(location(response)).toBe(
      at("/onboarding?step=connect&connected=mock"),
    );
  });

  it("sends a returnTo outside the app to the Library", async () => {
    await signedInCreator();
    const response = await connect("?returnTo=%2F%2Fevil.com");
    expect(location(response)).toBe(at("/dashboard/library?connected=mock"));
  });

  it("stores only scopes that were asked for and granted (owner answer Q3 a; 07 D83)", async () => {
    const original = mockProvider.optionalScopes;
    Object.defineProperty(mockProvider, "optionalScopes", {
      value: ["mock.extra"],
      configurable: true,
    });
    try {
      const me = await signedInCreator();
      grantScopes(["mock.read", "mock.extra", "mock.unrequested"]);
      await connect("?returnTo=%2Fdashboard%2Fconnections&insights=1");
      expect((await accountsOf(me.creatorId))[0]?.scopes).toEqual([
        "mock.read",
        "mock.extra",
      ]);

      // Asked for the optional scope, not granted: no error.
      grantScopes(["mock.read"]);
      const response = await connect(
        "?returnTo=%2Fdashboard%2Fconnections&insights=1",
      );
      expect(location(response)).toBe(
        at("/dashboard/connections?connected=mock"),
      );
      expect((await accountsOf(me.creatorId))[0]?.scopes).toEqual([
        "mock.read",
      ]);

      // Granted without being asked for: dropped.
      grantScopes(["mock.read", "mock.extra"]);
      await connect();
      expect((await accountsOf(me.creatorId))[0]?.scopes).toEqual([
        "mock.read",
      ]);
    } finally {
      Object.defineProperty(mockProvider, "optionalScopes", {
        value: original,
        configurable: true,
      });
    }
  });

  it("never writes a code or a token to the logs or the console", async () => {
    await signedInCreator();
    const written: string[] = [];
    const capture = (chunk: unknown) => {
      written.push(String(chunk));
      return true;
    };
    vi.spyOn(process.stdout, "write").mockImplementation(capture);
    vi.spyOn(process.stderr, "write").mockImplementation(capture);
    for (const method of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        written.push(args.map(String).join(" "));
      });
    }
    // A refused connect whose revoke fails (it logs), then a successful one.
    const revoke = vi
      .spyOn(mockProvider, "revoke")
      .mockRejectedValue(new Error("down"));
    const exchange = grantScopes([]);
    await connect();
    revoke.mockRestore();
    exchange.mockRestore();
    expect(location(await connect())).toBe(
      at("/dashboard/connections?connected=mock"),
    );
    expect(written.join("")).not.toMatch(
      /mock_access_|mock_refresh_|mock_code_/,
    );
    expect(written.join("")).toContain("social.revoke_failed");
  });
});

describe("listAccountSummaries", () => {
  it("lists the creator's live accounts only", async () => {
    const me = await signedInCreator();
    await connect();
    const other = await signedInCreator();
    await connect();
    const [mine] = await accountsOf(me.creatorId);
    const actor = (c: Creator) =>
      ({ kind: "creator", userId: c.userId, creatorId: c.creatorId }) as const;
    expect(await listAccountSummaries(actor(me))).toEqual([
      {
        id: mine?.id,
        platform: "mock",
        username: "demo.creator",
        displayName: "Demo Creator",
        status: "connected",
      },
    ]);
    await disconnectWhere(eq(socialAccount.creatorId, me.creatorId));
    expect(await listAccountSummaries(actor(me))).toEqual([]);
    expect(await listAccountSummaries(actor(other))).toHaveLength(1);
  });
});
