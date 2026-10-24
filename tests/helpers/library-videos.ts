// Library video [int] helpers (P11): a creator's videos and a post's postings as stored, the live check's spies on the
// raw mock adapter (the registry's wrapper calls the adapter's getPost at each call, as P07's suites rely on), a Library
// draft built by the factories, and two creators on one Demo account.
import { asc, eq } from "drizzle-orm";
import { expect, vi } from "vitest";
import { db } from "../../src/db/client";
import { video, videoPosting } from "../../src/db/schema";
import type {
  NewSocialAccount,
  NewSocialPostRow,
  Video,
} from "../../src/db/schema/types";
import { disconnectSocialAccount } from "../../src/server/social/disconnect";
import {
  mockProvider,
  setMockScenarioForTests,
} from "../../src/server/social/providers/mock";
import type { SocialPost } from "../../src/server/social/types";
import { type SignedInCreator, signedInCreator } from "./auth";
import { accountsOf, connect, connectedDemo, postNumber } from "./connect-flow";
import {
  insertLibraryVideo,
  insertSocialAccount,
  insertSocialPost,
  markOriginalReady,
} from "./factories";

/** The creator's videos, oldest first. */
export const videosOf = (creatorId: string) =>
  db
    .select()
    .from(video)
    .where(eq(video.creatorId, creatorId))
    .orderBy(asc(video.createdAt));

/** The postings of social post `socialPostId`. */
export const postingsOn = (socialPostId: string) =>
  db
    .select()
    .from(videoPosting)
    .where(eq(videoPosting.socialPostId, socialPostId));

/** Expects `creatorId` to have no video and post `socialPostId` no posting: a refusal wrote nothing. */
export async function expectNothingWritten(
  creatorId: string,
  socialPostId: string,
) {
  expect(await videosOf(creatorId)).toEqual([]);
  expect(await postingsOn(socialPostId)).toEqual([]);
}

/** The video's same_video_confirmed_at, or null. */
export async function confirmedAt(videoId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: video.sameVideoConfirmedAt })
    .from(video)
    .where(eq(video.id, videoId));
  return row?.at ?? null;
}

/** Counts the live checks from here on (create it after any sync: the sync's reference check calls getPost too). */
export const spyGetPost = () => vi.spyOn(mockProvider, "getPost");

/** getPost answering the real post with `change` applied (a live visibility the mock never reports). */
export function liveGetPost(change: Partial<SocialPost>) {
  const realGet = mockProvider.getPost.bind(mockProvider);
  return spyGetPost().mockImplementation(async (...args) => {
    const post = await realGet(...args);
    return post && { ...post, ...change };
  });
}

/**
 * A draft Library video of `owner` and its verified source posting, built by the factories (no sync and no live check:
 * for what comes after Make licensable). Its original is ready unless `ready` is false; `post` overrides the post's
 * columns (its ids, say), and `account` the Demo account's (its status, say).
 */
export async function libraryDraft(
  owner: { creatorId: string },
  {
    ready = true,
    post: postOverrides = {},
    account: accountOverrides = {},
  }: {
    ready?: boolean;
    post?: Partial<NewSocialPostRow>;
    account?: Partial<NewSocialAccount>;
  } = {},
): Promise<Video> {
  const account = await insertSocialAccount(
    { id: owner.creatorId },
    { username: "demo.creator", ...accountOverrides },
  );
  const post = await insertSocialPost(account, postOverrides);
  const { video: row } = await insertLibraryVideo(account, post);
  if (ready) await markOriginalReady(row);
  return row;
}

/**
 * Two creators on one Demo account (shared_account): A links it, makes its post 01 licensable with `makeLicensable`
 * (what that returned is `made`) and disconnects; B then links the same platform account, which syncs, and stays
 * signed in. `bPost` is B's own row of the same post 01.
 */
export async function twoCreatorsOnOneAccount<T>(
  makeLicensable: (a: SignedInCreator, socialPostId: string) => Promise<T>,
) {
  setMockScenarioForTests("shared_account");
  const a = await signedInCreator();
  const shared = await connectedDemo(a.creatorId);
  const aPost = await postNumber(shared.id, "01");
  const made = await makeLicensable(a, aPost.id);
  await disconnectSocialAccount(shared.id, a.actor);

  const b = await signedInCreator();
  await connect();
  const [bAccount] = await accountsOf(b.creatorId);
  if (!bAccount) throw new Error("B linked no account");
  return {
    a,
    aPost,
    made,
    b,
    bAccount,
    bPost: await postNumber(bAccount.id, "01"),
  };
}
