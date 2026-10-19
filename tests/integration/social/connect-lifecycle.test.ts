import { eq } from "drizzle-orm";
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
import { GET as avatarGET } from "../../../src/app/api/connections/avatars/[accountId]/route";
import { db } from "../../../src/db/client";
import { socialAccount } from "../../../src/db/schema";
import { decryptSecret } from "../../../src/server/crypto/token-cipher";
import { disconnectSocialAccount } from "../../../src/server/social/disconnect";
import {
  mockAccountIdFor,
  mockProvider,
  setMockScenarioForTests,
} from "../../../src/server/social/providers/mock";
import { accessTokenAad } from "../../../src/server/social/tokens";
import { mockNextHeaders, signedInCreator } from "../../helpers/auth";
import {
  accountsOf,
  at,
  connect,
  connectedDemo,
  insertDemoAccount,
  location,
  postsOf,
} from "../../helpers/connect-flow";
import { resetDb } from "../../helpers/db";

// Reconnect, "Connect another account" and the avatar proxy (J2.8, J2.10, J2.11, J2.16; 02 §7.6; 07 D37, D42) against
// the real route handlers and the test database.
vi.mock("next/headers", () => import("../../helpers/next-headers"));

afterAll(resetDb);
beforeEach(() => mockNextHeaders(null));
afterEach(() => {
  vi.restoreAllMocks();
  setMockScenarioForTests(null);
});

const RETURN_HERE = "?returnTo=%2Fdashboard%2Fconnections";
const ANOTHER = `?switch=1&returnTo=%2Fdashboard%2Fconnections`;

const postCount = async (accountId: string) =>
  (await postsOf(accountId)).length;

describe("Reconnect (J2.10, 07 D37)", () => {
  it("brings a needs_reconnect account back: same row, new tokens, no revoke, no duplicate posts", async () => {
    const me = await signedInCreator();
    const before = await connectedDemo(me.creatorId, RETURN_HERE);
    await db
      .update(socialAccount)
      .set({
        status: "needs_reconnect",
        lastSyncError: "upstream",
        lastSyncErrorAt: new Date(),
      })
      .where(eq(socialAccount.id, before.id));
    const revoke = vi.spyOn(mockProvider, "revoke");

    expect(location(await connect(RETURN_HERE))).toBe(
      at("/dashboard/connections?connected=mock"),
    );
    const rows = await accountsOf(me.creatorId);
    expect(rows.map((r) => r.id)).toEqual([before.id]);
    const [after] = rows;
    expect(after).toMatchObject({
      status: "connected",
      lastSyncError: null,
      lastSyncErrorAt: null,
    });
    expect(
      decryptSecret(after?.accessTokenEnc as string, accessTokenAad(before.id)),
    ).not.toBe(
      decryptSecret(before.accessTokenEnc as string, accessTokenAad(before.id)),
    );
    expect(revoke).not.toHaveBeenCalled();
    expect(await postCount(before.id)).toBe(24);
  });
});

describe("Connect another account (J2.8, J2.11; 07 D41)", () => {
  it("switch=1 adds the second Demo account as its own row with its own posts", async () => {
    const me = await signedInCreator();
    const first = await connectedDemo(me.creatorId, RETURN_HERE);
    expect(location(await connect(ANOTHER))).toBe(
      at("/dashboard/connections?connected=mock"),
    );
    const rows = await accountsOf(me.creatorId);
    expect(rows).toHaveLength(2);
    const second = rows.find((r) => r.id !== first.id);
    expect(second).toMatchObject({
      providerAccountId: mockAccountIdFor(me.userId, true),
      username: "demo.creator.2",
      status: "connected",
    });
    expect(await postCount(second?.id as string)).toBe(24);
    expect(await postCount(first.id)).toBe(24);
  });

  it("leaves an account that needs reconnecting alone when another one connects (J2.11)", async () => {
    const me = await signedInCreator();
    const first = await connectedDemo(me.creatorId, RETURN_HERE);
    await db
      .update(socialAccount)
      .set({ status: "needs_reconnect" })
      .where(eq(socialAccount.id, first.id));
    await connect(ANOTHER);
    const rows = await accountsOf(me.creatorId);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === first.id)?.status).toBe("needs_reconnect");
  });
});

describe("the avatar proxy (02 §7.6, 07 D42)", () => {
  const avatar = (accountId: string) =>
    avatarGET(new NextRequest(at(`/api/connections/avatars/${accountId}`)), {
      params: Promise.resolve({ accountId }),
    });

  it("serves the owner's mock avatar as a locked-down SVG", async () => {
    const me = await signedInCreator();
    const account = await insertDemoAccount({
      id: me.creatorId,
      userId: me.userId,
    });
    const response = await avatar(account.id);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'",
    );
    expect(response.headers.get("cache-control")).toBe("private, max-age=3600");
    const svg = await response.text();
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain(">01<");
  });

  it("answers 401 without a session, 404 for another creator, a bad id or a disconnected account", async () => {
    const owner = await signedInCreator();
    const account = await insertDemoAccount({
      id: owner.creatorId,
      userId: owner.userId,
    });

    mockNextHeaders(null);
    const signedOut = await avatar(account.id);
    expect(signedOut.status).toBe(401);
    expect(await signedOut.json()).toEqual({ error: { code: "unauthorized" } });

    await signedInCreator();
    expect((await avatar(account.id)).status).toBe(404);
    expect((await avatar("not-a-uuid")).status).toBe(404);

    mockNextHeaders(owner.session);
    await disconnectSocialAccount(account.id, owner.actor);
    expect((await avatar(account.id)).status).toBe(404);
  });
});
