import { and, asc, eq, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { db } from "../../../src/db/client";
import { auditEvent, socialAccount, socialPost } from "../../../src/db/schema";
import { MINUTE_MS } from "../../../src/lib/time";
import { decryptSecret } from "../../../src/server/crypto/token-cipher";
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
import { SOCIAL_CACHE_TTL_DAYS } from "../../../src/server/social/sync";
import {
  accessTokenAad,
  refreshTokenAad,
  storeTokens,
} from "../../../src/server/social/tokens";
import { mockNextHeaders, signedInCreator } from "../../helpers/auth";
import {
  accountsOf,
  at,
  callback,
  connect,
  cookieLine,
  disconnectWhere,
  FROM_ONBOARDING,
  location,
  oauthPair,
  start,
} from "../../helpers/connect-flow";
import { resetDb } from "../../helpers/db";
import { captureLogEvents } from "../../helpers/logs";

// The connect round trip (02 §7.2, 07 D37) against the real route handlers (tests/helpers/connect-flow.ts).
vi.mock("next/headers", () => import("../../helpers/next-headers"));

afterAll(resetDb);
beforeEach(() => mockNextHeaders(null));
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  setMockScenarioForTests(null);
});

function expectCookieCleared(response: Response) {
  const line = cookieLine(response);
  expect(line).toMatch(/^cliplease_oauth=;/);
  expect(line).toMatch(/Path=\/api\/connect/i);
  expect(line).toMatch(/Expires=Thu, 01 Jan 1970/i);
}

// The real calls, bound before any spy, so a spy laid over another (a second grantScopes) still reaches them.
const realExchange = mockProvider.exchangeCode.bind(mockProvider);
const realProfile = mockProvider.getProfile.bind(mockProvider);

/** The platform grants these scopes instead of the mock's own. */
function grantScopes(scopes: string[]) {
  return vi
    .spyOn(mockProvider, "exchangeCode")
    .mockImplementation(async (i) => ({ ...(await realExchange(i)), scopes }));
}

/** The platform's account id holds a NUL byte, which can't be stored: the registry fails the profile read (text.ts). */
function nulAccountId() {
  return vi
    .spyOn(mockProvider, "getProfile")
    .mockImplementation(async (token) => {
      const own = await realProfile(token);
      return { ...own, externalAccountId: `${own.externalAccountId}\u0000` };
    });
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

  it("sends a signed-out visitor to sign-in and back to where the connect started, and answers 404 for an unknown or disabled platform", async () => {
    const nextOf = async (query?: string) => {
      const signedOut = await start(query);
      expect(signedOut.status).toBe(302);
      const target = new URL(location(signedOut));
      expect(target.pathname).toBe("/sign-in");
      return target.searchParams.get("next");
    };
    expect(await nextOf()).toBe("/dashboard/connections");
    expect(await nextOf(FROM_ONBOARDING)).toBe("/onboarding?step=connect");
    // No returnTo, or one outside the app: the Library, where the callback would land too.
    expect(await nextOf("")).toBe("/dashboard/library");
    expect(await nextOf("?returnTo=%2F%2Fevil.com")).toBe("/dashboard/library");

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

  it("refuses a reconnect without the scope and leaves the live account and its grant alone (owner answer)", async () => {
    const me = await signedInCreator();
    await connect();
    const before = await accountsOf(me.creatorId);
    grantScopes([]);
    const revoke = vi.spyOn(mockProvider, "revoke");
    const response = await connect();
    expect(location(response)).toBe(
      at("/dashboard/connections?error=missing_scope"),
    );
    expect(revoke).not.toHaveBeenCalled();
    expect(await accountsOf(me.creatorId)).toEqual(before);
    expect(before[0]?.status).toBe("connected");
  });

  it("gives nothing back when a connect without the scope can't read the profile: the account is unknown", async () => {
    await signedInCreator();
    grantScopes([]);
    vi.spyOn(mockProvider, "getProfile").mockRejectedValueOnce(
      new SocialAuthError(),
    );
    const revoke = vi.spyOn(mockProvider, "revoke");
    const logs = captureLogEvents("social.connect_failed");
    const response = await connect();
    const { events } = logs();
    expect(location(response)).toBe(
      at("/dashboard/connections?error=missing_scope"),
    );
    expect(revoke).not.toHaveBeenCalled();
    expect(events).toEqual([
      expect.objectContaining({
        level: "warn",
        provider: "mock",
        stage: "profile",
        reason: "SocialAuthError",
      }),
    ]);
  });

  it("counts a profile whose account id holds a NUL as unreadable: without the scope, nothing is given back", async () => {
    await signedInCreator();
    grantScopes([]);
    nulAccountId();
    const revoke = vi.spyOn(mockProvider, "revoke");
    expect(location(await connect())).toBe(
      at("/dashboard/connections?error=missing_scope"),
    );
    expect(revoke).not.toHaveBeenCalled();
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

  it("refuses an account another creator holds and leaves theirs alone, grant included: no revoke (J2.7, owner answer)", async () => {
    setMockScenarioForTests("shared_account");
    const a = await signedInCreator();
    expect(location(await connect())).toBe(
      at("/dashboard/connections?connected=mock"),
    );
    const [before] = await accountsOf(a.creatorId);

    const b = await signedInCreator();
    const revoke = vi.spyOn(mockProvider, "revoke");
    const response = await connect(FROM_ONBOARDING);
    expect(location(response)).toBe(
      at("/onboarding?step=connect&error=already_linked"),
    );
    expectCookieCleared(response);
    expect(await accountsOf(b.creatorId)).toEqual([]);
    expect(await accountsOf(a.creatorId)).toEqual([before]);
    expect(revoke).not.toHaveBeenCalled();
    await db
      .delete(socialAccount)
      .where(eq(socialAccount.providerAccountId, "mock_acct_shared"));
  });

  it("answers a failed exchange, profile read or save with provider_error, logs each by stage and keeps the grant (07 D37)", async () => {
    const me = await signedInCreator();
    const revoke = vi.spyOn(mockProvider, "revoke");
    const logs = captureLogEvents("social.connect_failed");

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

    // A NUL byte in the platform's account id: the profile read fails.
    const nul = nulAccountId();
    response = await connect();
    expect(location(response)).toBe(
      at("/dashboard/connections?error=provider_error"),
    );
    nul.mockRestore();

    // A token expiry that isn't a date can't be saved: a failure that isn't a unique violation.
    vi.spyOn(mockProvider, "exchangeCode").mockImplementation(async (i) => ({
      ...(await realExchange(i)),
      accessTokenExpiresAt: new Date(Number.NaN),
    }));
    response = await connect();
    expect(location(response)).toBe(
      at("/dashboard/connections?error=provider_error"),
    );

    const { written, events } = logs();
    const profileFailed = expect.objectContaining({
      level: "warn",
      provider: "mock",
      stage: "profile",
      reason: "SocialUpstreamError",
    });
    expect(events).toEqual([
      expect.objectContaining({
        level: "warn",
        provider: "mock",
        stage: "exchange",
        reason: "SocialAuthError",
      }),
      profileFailed,
      profileFailed,
      expect.objectContaining({
        level: "error",
        provider: "mock",
        stage: "link",
      }),
    ]);
    expect(written).not.toMatch(/mock_(access|refresh|code|acct)_/);
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
    if (!mine?.lastSyncedAt) throw new Error("the connect didn't sync");
    expect(await listAccountSummaries(me.actor)).toEqual([
      {
        id: mine.id,
        platform: "mock",
        username: "demo.creator",
        displayName: "Demo Creator",
        status: "connected",
        avatarSrc: `/api/connections/avatars/${mine.id}`,
        lastSyncedAt: mine.lastSyncedAt.toISOString(),
        lastSyncError: null,
        syncProblem: false,
        hasOlder: false,
        postCount: 24,
        accountType: "Media_Creator",
        connectedAt: mine.connectedAt.toISOString(),
        syncing: false,
        blockedMinutes: null,
        stale: false,
      },
    ]);

    // postCount counts what the creator can see (visiblePostsWhere): not a removed post, nor one unseen for 30 days.
    const [first, second] = await db
      .select({ id: socialPost.id })
      .from(socialPost)
      .where(eq(socialPost.socialAccountId, mine.id))
      .limit(2);
    if (!first || !second) throw new Error("no posts");
    await db
      .update(socialPost)
      .set({ status: "removed", removedAt: new Date() })
      .where(eq(socialPost.id, first.id));
    await db
      .update(socialPost)
      .set({
        fetchedAt: sql`now() - make_interval(days => ${SOCIAL_CACHE_TTL_DAYS}, mins => 1)`,
      })
      .where(eq(socialPost.id, second.id));
    expect((await listAccountSummaries(me.actor))[0]?.postCount).toBe(22);

    await disconnectWhere(eq(socialAccount.creatorId, me.creatorId));
    expect(await listAccountSummaries(me.actor)).toEqual([]);
    expect(await listAccountSummaries(other.actor)).toHaveLength(1);
  });
});
