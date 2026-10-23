import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { db, pool } from "../../../src/db/client";
import { socialAccount } from "../../../src/db/schema";
import { DAY_MS, MINUTE_MS } from "../../../src/lib/time";
import { decryptSecret } from "../../../src/server/crypto/token-cipher";
import {
  SocialAuthError,
  SocialUpstreamError,
} from "../../../src/server/social/errors";
import { linkAccount } from "../../../src/server/social/link";
import {
  mockProvider,
  mockTokensFor,
  setMockScenarioForTests,
} from "../../../src/server/social/providers/mock";
import {
  accessTokenAad,
  getFreshAccessToken,
  markNeedsReconnect,
  NoTimeToRefreshError,
  refreshTokenAad,
  storeTokens,
  withAccessToken,
} from "../../../src/server/social/tokens";
import {
  accountRow,
  auditsOf,
  demoAccount,
  insertDemoAccount,
} from "../../helpers/connect-flow";
import { resetDb } from "../../helpers/db";
import { insertCreator } from "../../helpers/factories";

// 07 D12 (c): concurrent requests refresh a token once. Under rotating_refresh a second refresh with the same refresh
// token fails, so anything but one refresh would flip the account to needs_reconnect. The pool's 10 connections all wait
// on the row lock at once.

afterAll(resetDb);
afterEach(() => {
  vi.restoreAllMocks();
  setMockScenarioForTests(null);
});

/** A Demo account whose access token expired a minute ago, with its tokens in the clear for the checks. */
async function expiredDemoAccount() {
  const creator = await insertCreator();
  const expired = { accessTokenExpiresAt: new Date(Date.now() - MINUTE_MS) };
  const { id } = await insertDemoAccount(creator, expired);
  return { id, creator, old: mockTokensFor(creator.userId, "t1", expired) };
}

/** The refresh's 10 s deadline, already passed. */
const deadlinePassed = () =>
  vi
    .spyOn(AbortSignal, "timeout")
    .mockReturnValue(
      AbortSignal.abort(new DOMException("timed out", "TimeoutError")),
    );

describe("getFreshAccessToken under rotating_refresh (07 D12)", () => {
  it("10 concurrent calls make one refresh and all get its token", async () => {
    setMockScenarioForTests("rotating_refresh");
    const { id, old } = await expiredDemoAccount();
    // Real contention: all 10 connections open up front, and a refresh slow enough that the other calls arrive while
    // the first one holds the lock. Without the lock they would all refresh, and rotating_refresh refuses the reuse.
    const clients = await Promise.all(
      Array.from({ length: 10 }, () => pool.connect()),
    );
    for (const client of clients) client.release();
    const real = mockProvider.refreshToken.bind(mockProvider);
    const refresh = vi
      .spyOn(mockProvider, "refreshToken")
      .mockImplementation(async (t, opts) => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return real(t, opts);
      });

    const tokens = await Promise.all(
      Array.from({ length: 10 }, () => getFreshAccessToken(id)),
    );

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(new Set(tokens).size).toBe(1);
    const [token] = tokens;
    expect(token).toMatch(/^mock_access_[0-9a-f]{8}_[0-9a-f]{16}$/);
    expect(token).not.toBe(old.accessToken);
    const row = await accountRow(id);
    expect(row.status).toBe("connected");
    expect(
      decryptSecret(row.accessTokenEnc as string, accessTokenAad(id)),
    ).toBe(token);
    const refreshToken = decryptSecret(
      row.refreshTokenEnc as string,
      refreshTokenAad(id),
    );
    expect(refreshToken).toMatch(/^mock_refresh_[0-9a-f]{8}_[0-9a-f]{16}$/);
    expect(refreshToken).not.toBe(old.refreshToken);
    expect(row.accessTokenExpiresAt?.getTime()).toBeGreaterThan(Date.now());
    expect(row.scopes).toEqual(["mock.read"]);
  });

  it("uses a token that isn't due without refreshing it", async () => {
    const { id, old } = await expiredDemoAccount();
    await db
      .update(socialAccount)
      .set({ accessTokenExpiresAt: new Date(Date.now() + DAY_MS) })
      .where(eq(socialAccount.id, id));
    const refresh = vi.spyOn(mockProvider, "refreshToken");
    expect(await getFreshAccessToken(id)).toBe(old.accessToken);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("sends an account whose refresh is refused to needs_reconnect", async () => {
    setMockScenarioForTests("expired");
    const { id } = await expiredDemoAccount();
    await expect(getFreshAccessToken(id)).rejects.toMatchObject({
      name: "SocialAuthError",
    });
    expect((await accountRow(id)).status).toBe("needs_reconnect");
    // Not connected any more: refused without another refresh.
    const refresh = vi.spyOn(mockProvider, "refreshToken");
    await expect(getFreshAccessToken(id)).rejects.toMatchObject({
      name: "SocialAuthError",
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("the refresh deadline (07 D12, ADR-13)", () => {
  it("stores a token set that arrives after the deadline, so a rotated refresh token is never dropped", async () => {
    const { id, old } = await expiredDemoAccount();
    deadlinePassed();
    const real = mockProvider.refreshToken.bind(mockProvider);
    // An adapter that answers although its signal aborted.
    const refresh = vi
      .spyOn(mockProvider, "refreshToken")
      .mockImplementation(async (t) =>
        real(t, { signal: new AbortController().signal }),
      );
    const token = await getFreshAccessToken(id);
    expect(refresh.mock.calls[0]?.[1].signal.aborted).toBe(true);
    expect(token).not.toBe(old.accessToken);
    const row = await accountRow(id);
    expect(
      decryptSecret(row.accessTokenEnc as string, accessTokenAad(id)),
    ).toBe(token);
    expect(
      decryptSecret(row.refreshTokenEnc as string, refreshTokenAad(id)),
    ).not.toBe(old.refreshToken);
  });

  it("withAccessToken starts no refresh that couldn't end by the caller's refreshBy: NoTimeToRefreshError, no call, the row as it was", async () => {
    const { id } = await expiredDemoAccount();
    const before = await accountRow(id);
    const refresh = vi.spyOn(mockProvider, "refreshToken");
    const call = vi.fn(async () => "used");

    await expect(
      withAccessToken(id, call, { refreshBy: Date.now() + 1_000 }),
    ).rejects.toBeInstanceOf(NoTimeToRefreshError);
    expect(refresh).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
    expect(await accountRow(id)).toEqual(before);
    // With time left, the refresh runs and the call goes through.
    await expect(
      withAccessToken(id, call, { refreshBy: Date.now() + 60_000 }),
    ).resolves.toBe("used");
  });

  it("gives up with SocialUpstreamError when the deadline aborts the call, and keeps the row as it was", async () => {
    const { id } = await expiredDemoAccount();
    const before = await accountRow(id);
    deadlinePassed();
    await expect(getFreshAccessToken(id)).rejects.toBeInstanceOf(
      SocialUpstreamError,
    );
    expect(await accountRow(id)).toEqual(before);
  });
});

describe("markNeedsReconnect fenced on the refused tokens (07 D12b)", () => {
  it("marks the account only while it still holds the tokens that were refused", async () => {
    const { id } = await expiredDemoAccount();
    const { tokenRefreshedAt } = await accountRow(id);
    await markNeedsReconnect(id, new Date(Date.now() + MINUTE_MS));
    expect((await accountRow(id)).status).toBe("connected");
    expect(await auditsOf(id, "social_account.needs_reconnect")).toEqual([]);

    await markNeedsReconnect(id, tokenRefreshedAt);
    expect((await accountRow(id)).status).toBe("needs_reconnect");
    expect(await auditsOf(id, "social_account.needs_reconnect")).toHaveLength(
      1,
    );
  });

  it("leaves a reconnect that lands while a refresh is refused connected", async () => {
    const { id, creator } = await expiredDemoAccount();
    const fresh = mockTokensFor(creator.userId, "t2");
    let reconnect: Promise<unknown> = Promise.resolve();
    vi.spyOn(mockProvider, "refreshToken").mockImplementation(async () => {
      // The reconnect's UPDATE waits on this refresh's row lock and stores its tokens once the refresh gives up.
      reconnect = linkAccount({
        creatorId: creator.id,
        platform: "mock",
        tokens: fresh,
        profile: await mockProvider.getProfile(fresh.accessToken),
      });
      await vi.waitFor(
        async () => {
          const { rows } = await db.execute<{ n: number }>(
            sql`select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query like 'update "social_account"%'`,
          );
          expect(rows[0]?.n).toBeGreaterThan(0);
        },
        { timeout: 10_000, interval: 20 },
      );
      throw new SocialAuthError();
    });
    // The call failed, but the account is fine: an upstream error, never a prompt to reconnect.
    await expect(getFreshAccessToken(id)).rejects.toBeInstanceOf(
      SocialUpstreamError,
    );
    await reconnect;
    const row = await accountRow(id);
    expect(row.status).toBe("connected");
    expect(
      decryptSecret(row.accessTokenEnc as string, accessTokenAad(id)),
    ).toBe(fresh.accessToken);
    expect(await auditsOf(id, "social_account.needs_reconnect")).toEqual([]);
  });

  /**
   * withAccessToken on a Demo account whose platform refuses every token. Another request's refresh lands before the
   * first refusal, so it retries with that token; with `reconnect`, newer tokens land again before the retry's
   * refusal. Gives back the tokens used and what the call threw.
   */
  async function refusedRetry(reconnect: boolean) {
    const {
      account: { id },
      userId,
    } = await demoAccount();
    const used: string[] = [];
    const thrown = await withAccessToken(id, async (token) => {
      used.push(token);
      if (used.length === 1 || reconnect) {
        await storeTokens(
          db,
          id,
          mockTokensFor(userId, `t${used.length + 1}`),
          new Date(Date.now() + used.length * MINUTE_MS),
        );
      }
      throw new SocialAuthError();
    }).catch((error: unknown) => error);
    return { id, userId, used, thrown };
  }

  it("marks the account when the retry's token is refused too: fenced on the retry's tokens", async () => {
    const { id, userId, used, thrown } = await refusedRetry(false);
    expect(thrown).toBeInstanceOf(SocialAuthError);
    expect(used).toEqual([
      mockTokensFor(userId, "t1").accessToken,
      mockTokensFor(userId, "t2").accessToken,
    ]);
    expect((await accountRow(id)).status).toBe("needs_reconnect");
    expect(await auditsOf(id, "social_account.needs_reconnect")).toHaveLength(
      1,
    );
  });

  it("leaves the account connected when a reconnect replaces the tokens the retry was refused with", async () => {
    const { id, used, thrown } = await refusedRetry(true);
    expect(thrown).toBeInstanceOf(SocialUpstreamError);
    expect(used).toHaveLength(2);
    expect((await accountRow(id)).status).toBe("connected");
    expect(await auditsOf(id, "social_account.needs_reconnect")).toEqual([]);
  });
});
