// Linked Demo accounts for [int] tests: the connect round trip against the real route handlers (a real session from
// signedInCreator, the gates read it through next/headers, so each file mocks it:
// vi.mock("next/headers", () => import("../../helpers/next-headers"))), with the sealed cookie carried from start to
// callback as a browser would; or a connected account inserted directly, and the reads around it.
import { randomUUID } from "node:crypto";
import { and, asc, eq, type SQL } from "drizzle-orm";
import { NextRequest } from "next/server";
import { GET as callbackGET } from "../../src/app/api/connect/[provider]/callback/route";
import { GET as startGET } from "../../src/app/api/connect/[provider]/start/route";
import { db } from "../../src/db/client";
import { auditEvent, socialAccount, socialPost } from "../../src/db/schema";
import type { CreatorProfile, SocialAccount } from "../../src/db/schema/types";
import type { Actor } from "../../src/server/auth/actor";
import { env } from "../../src/server/env";
import { OAUTH_COOKIE } from "../../src/server/social/oauth-state";
import {
  mockAccountIdFor,
  mockTokensFor,
} from "../../src/server/social/providers/mock";
import { sealTokenColumns } from "../../src/server/social/tokens";
import { creatorActor } from "./auth";
import { insertCreator, insertSocialAccount } from "./factories";

export const at = (path: string) => new URL(path, env.APP_URL).href;
export const FROM_ONBOARDING = "?returnTo=%2Fonboarding%3Fstep%3Dconnect";

const params = (provider: string) => ({
  params: Promise.resolve({ provider }),
});

export function start(
  query = "?returnTo=%2Fdashboard%2Fconnections",
  provider = "mock",
) {
  return startGET(
    new NextRequest(at(`/api/connect/${provider}/start${query}`)),
    params(provider),
  );
}

export function callback(
  url: string,
  cookie: string | null,
  provider = "mock",
) {
  return callbackGET(
    new NextRequest(url, cookie ? { headers: { cookie } } : undefined),
    params(provider),
  );
}

/** The response's Set-Cookie line for the oauth cookie. */
export function cookieLine(response: Response): string {
  const line = response.headers
    .getSetCookie()
    .find((l) => l.startsWith(`${OAUTH_COOKIE}=`));
  if (!line) throw new Error("no oauth Set-Cookie");
  return line;
}

/** The `cliplease_oauth=<sealed>` pair a browser sends back. */
export const oauthPair = (response: Response) =>
  cookieLine(response).split(";")[0] as string;

export const location = (response: Response) =>
  response.headers.get("location") as string;

/** start → callback with the cookie, as the browser follows the mock's redirect. */
export async function connect(query?: string) {
  const started = await start(query);
  return callback(location(started), oauthPair(started));
}

type DemoOptions = {
  second?: boolean;
  accessTokenExpiresAt?: Date;
  connectedAt?: Date;
};

/**
 * A connected, never-synced Demo account for `creator`: the profile the mock reports and its mock tokens, sealed as
 * the callback seals them, linked at `connectedAt` (now unless given).
 */
export async function insertDemoAccount(
  creator: Pick<CreatorProfile, "id" | "userId">,
  opts: DemoOptions = {},
): Promise<SocialAccount> {
  const id = randomUUID();
  return insertSocialAccount(creator, {
    id,
    providerAccountId: mockAccountIdFor(creator.userId, opts.second),
    username: opts.second ? "demo.creator.2" : "demo.creator",
    displayName: opts.second ? "Demo Creator 2" : "Demo Creator",
    avatarUrl: opts.second ? "mock://avatar/02" : "mock://avatar/01",
    connectedAt: opts.connectedAt,
    ...sealTokenColumns(id, mockTokensFor(creator.userId, "t1", opts)),
  });
}

export type Demo = { account: SocialAccount; actor: Actor; userId: string };

/** A creator (new unless given) with a connected, never-synced Demo account, and the creator's actor. */
export async function demoAccount(
  creator?: Pick<CreatorProfile, "id" | "userId">,
  opts: DemoOptions = {},
): Promise<Demo> {
  const owner = creator ?? (await insertCreator());
  return {
    account: await insertDemoAccount(owner, opts),
    actor: creatorActor({ creatorId: owner.id, userId: owner.userId }),
    userId: owner.userId,
  };
}

/** The creator's one Demo account after a connect through the routes (and its first sync). */
export async function connectedDemo(
  creatorId: string,
  query = "?returnTo=%2Fdashboard%2Fconnections",
): Promise<SocialAccount> {
  await connect(query);
  const [account] = await accountsOf(creatorId);
  if (!account) throw new Error("no account");
  return account;
}

export function postsOf(accountId: string) {
  return db
    .select()
    .from(socialPost)
    .where(eq(socialPost.socialAccountId, accountId))
    .orderBy(asc(socialPost.providerPostId));
}

/** The account's post `nn` ("05"). */
export async function postNumber(accountId: string, nn: string) {
  const row = (await postsOf(accountId)).find((p) =>
    p.providerPostId.endsWith(`_${nn}`),
  );
  if (!row) throw new Error(`no post ${nn}`);
  return row;
}

export function auditsOf(entityId: string, action: string) {
  return db
    .select({ data: auditEvent.data, actorType: auditEvent.actorType })
    .from(auditEvent)
    .where(
      and(eq(auditEvent.entityId, entityId), eq(auditEvent.action, action)),
    );
}

export async function accountRow(id: string): Promise<SocialAccount> {
  const [row] = await db
    .select()
    .from(socialAccount)
    .where(eq(socialAccount.id, id));
  if (!row) throw new Error("no account");
  return row;
}

export function accountsOf(creatorId: string): Promise<SocialAccount[]> {
  return db
    .select()
    .from(socialAccount)
    .where(eq(socialAccount.creatorId, creatorId));
}

/** Marks the matching accounts disconnected with just what the CHECK needs: quick setup (disconnectSocialAccount is the real one). */
export function disconnectWhere(where: SQL) {
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
