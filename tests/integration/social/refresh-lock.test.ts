import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { db, pool } from "../../../src/db/client";
import { socialAccount } from "../../../src/db/schema";
import { DAY_MS, MINUTE_MS } from "../../../src/lib/time";
import { decryptSecret } from "../../../src/server/crypto/token-cipher";
import {
  mockProvider,
  mockTokensFor,
  setMockScenarioForTests,
} from "../../../src/server/social/providers/mock";
import {
  accessTokenAad,
  getFreshAccessToken,
  refreshTokenAad,
} from "../../../src/server/social/tokens";
import { accountRow, insertDemoAccount } from "../../helpers/connect-flow";
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
  return { id, old: mockTokensFor(creator.userId, "t1", expired) };
}

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
      .mockImplementation(async (t) => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return real(t);
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
