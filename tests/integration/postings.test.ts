import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ZodError } from "zod";
import { db } from "../../src/db/client";
import { socialAccount, socialPost } from "../../src/db/schema";
import type {
  SocialAccount,
  SocialPostRow,
  VideoPosting,
} from "../../src/db/schema/types";
import { POSTINGS_MAX } from "../../src/lib/postings/limits";
import { HOUR_MS } from "../../src/lib/time";
import type { Actor } from "../../src/server/auth/actor";
import {
  AlreadyLicensableElsewhereError,
  AlreadyOnYourVideoError,
  CheckedRecentlyError,
  InvalidPostingsError,
  NotPublicError,
  PostingsLockedError,
} from "../../src/server/postings/errors";
import {
  type PostingTarget,
  verifiedPostingConflictError,
} from "../../src/server/postings/ownership";
import {
  getPublicPostings,
  listVideoPostings,
} from "../../src/server/postings/queries";
import {
  POSTING_CHECK_COOLDOWN_MS,
  type PostingInput,
  recheckPosting,
  type SaveVideoPostingsInput,
  saveVideoPostings,
} from "../../src/server/postings/save";
import {
  POSTING_CHECKS_BUDGET_MS,
  verifyPostingLink,
} from "../../src/server/postings/verify";
import { disconnectSocialAccount } from "../../src/server/social/disconnect";
import {
  SocialAuthError,
  SocialRateLimitError,
  SocialUpstreamError,
} from "../../src/server/social/errors";
import {
  mockProvider,
  setMockScenarioForTests,
} from "../../src/server/social/providers/mock";
import { createVideoFromPost } from "../../src/server/videos/create";
import {
  confirmSameVideo,
  withdrawSameVideo,
} from "../../src/server/videos/edit";
import {
  NoVerifiedPostingError,
  OriginalNotReadyError,
  VideoNotFoundError,
} from "../../src/server/videos/errors";
import { getVideoStepFacts } from "../../src/server/videos/queries";
import { bareCreator, mockNextHeaders } from "../helpers/auth";
import {
  accountRow,
  auditsOf,
  demoAccount,
  postNumber,
  postsOf,
} from "../helpers/connect-flow";
import { resetDb } from "../helpers/db";
import {
  insertUploadVideo,
  insertVideoPosting,
  markOriginalReady,
  publishVideo,
  videoRow,
} from "../helpers/factories";
import { syncedDemo } from "../helpers/library";
import {
  confirmedAt,
  liveGetPost,
  spyGetPost,
  twoCreatorsOnOneAccount,
} from "../helpers/library-videos";
import { captureLogEvents } from "../helpers/logs";
import { pgError, wrapped } from "../helpers/pg-errors";
import {
  adminActor,
  backdateCheckedAt,
  conflictAuditsNaming,
  expectOwnershipInvariant,
  extraDemoAccount,
  fetchGuard,
  insertVerifiedElsewhere,
  mockLink,
  mockPostId,
  postingRow,
  postingsOf,
  releasePosting,
  SNOW_TITLE,
  setSameVideoConfirmed,
  spyFind,
  trackingUrlCount,
} from "../helpers/postings";

// "Where was it posted?" on the server (P11b; 02 §5.12, 03 §7.4, I27, I28; 06 §5b; 07 D65–D70, D72, D73; owner answers
// Q-69 a, Q-70 a and Q-82 a–Q-86 a) against the test database and the mock provider. Live checks are counted on the raw
// adapter (mockProvider), as in P11's suite: the registry's wrapper calls its getPost and findPostByLinkKey at each call,
// and the mock's lookup is its getPost. A check stands for 30 seconds (Q-84 a), so a test that wants a link asked again
// moves its checked_at back first (backdateCheckedAt). Every test leaves 03 I28 true (afterEach), and fetch is refused
// for the whole file.
vi.mock("next/headers", () => import("../helpers/next-headers"));

const fetches = fetchGuard();

beforeAll(() => fetches.install());
beforeEach(() => {
  // vi.restoreAllMocks() in afterEach removes the fetch spy with the others: put it back for each test.
  fetches.install();
  mockNextHeaders(null);
});
afterEach(async () => {
  fetches.collect();
  vi.restoreAllMocks();
  setMockScenarioForTests(null);
  await expectOwnershipInvariant();
});
afterAll(async () => {
  try {
    // Every URL the suite stored is canonical (07 D67).
    expect(await trackingUrlCount()).toBe(0);
    // Under the mock nothing calls fetch at all, so no pasted link or its canonical URL was ever requested (07 D73).
    const pasted = fetches.pasted();
    const requested = fetches.requested();
    expect(pasted.length).toBeGreaterThan(0);
    for (const url of requested) {
      for (const link of pasted) expect(url).not.toContain(link);
    }
    expect(requested).toEqual([]);
  } finally {
    await resetDb();
  }
});

const FB_ID = "1234567890123";
const FB_LINK = `https://www.facebook.com/video.php?v=${FB_ID}`;
const FB_URL = `https://www.facebook.com/watch/?v=${FB_ID}`;
const X_ID = "1790000000000000001";
const X_LINK = `https://twitter.com/mayafilms/status/${X_ID}/video/1`;
const X_URL = `https://x.com/i/status/${X_ID}`;
const SNAP_ID = "W7_EDlXWTBiXAEEniNoMPwAAYYWx";
const SNAP_LINK = `https://www.snapchat.com/@maya.films/spotlight/${SNAP_ID}`;
const SNAP_URL = `https://www.snapchat.com/spotlight/${SNAP_ID}`;
const IG_CODE = "C9xYz12AbCd";
const IG_LINK = `https://www.instagram.com/reel/${IG_CODE}/?igsh=MWZ4dGx0`;
const IG_URL = `https://www.instagram.com/reel/${IG_CODE}/`;
const TIKTOK_ID = "7106594312292453675";

const FACEBOOK: PostingInput = { platform: "facebook", link: FB_LINK };
const X_POST: PostingInput = { platform: "x", link: X_LINK };

/** A Demo row pasting `link`. */
const demoPaste = (
  link: string,
  extra: Partial<PostingInput> = {},
): PostingInput => ({ platform: "mock", link, ...extra });

/** An Other row named "Vimeo" with link https://vimeo.com/{n}: clean of tracking parameters. */
const vimeo = (n: number, extra: Partial<PostingInput> = {}): PostingInput => ({
  platform: "other",
  otherLabel: "Vimeo",
  link: `https://vimeo.com/${n}`,
  ...extra,
});

/** n distinct Vimeo rows from `first`. */
const vimeos = (n: number, first: number) =>
  Array.from({ length: n }, (_, i) => vimeo(first + i));

/** A Demo link as verifyPostingLink takes it: post `nn` of `account`. */
const demoLink = (account: SocialAccount, nn: string) => ({
  platform: "mock" as const,
  linkKey: mockPostId(account, nn),
  url: mockLink(account, nn),
});

/** verifyPostingLink's answer for a link that stays Not verified. */
const notVerified = (reason: string) => ({
  verification: "unverified",
  reason,
});

/** A Demo creator after its first sync (24 posts), a draft upload of theirs and their post `nn`. */
async function syncedUpload(nn = "01") {
  const d = await syncedDemo();
  const upload = await insertUploadVideo({ id: d.account.creatorId });
  return { d, upload, post: await postNumber(d.account.id, nn) };
}

/** A synced Demo creator and the Library video Make licensable made from its post `nn`. */
async function libraryVideo(nn = "01") {
  const d = await syncedDemo();
  const post = await postNumber(d.account.id, nn);
  const { videoId } = await createVideoFromPost(d.actor, post.id);
  return { d, post, videoId };
}

/** saveVideoPostings, with every pasted link remembered for the no-fetch check. */
function save(
  actor: Actor,
  videoId: string,
  postings: PostingInput[],
  notPosted = false,
) {
  return saveWith(actor, { videoId, notPosted, postings });
}

/** save with the whole input, the source row's Switch included (owner answer Q-73 a). */
function saveWith(actor: Actor, input: SaveVideoPostingsInput) {
  for (const p of input.postings) {
    if (p.link) fetches.remember(p.platform, p.link);
  }
  return saveVideoPostings(actor, input);
}

/** A save that must succeed: the owner DTOs it returns. */
async function saveOk(...args: Parameters<typeof save>) {
  const result = await save(...args);
  if (!result.ok) {
    throw new Error(`the save was refused: ${JSON.stringify(result.fields)}`);
  }
  return result.postings;
}

/** The video's posting at `position`. */
async function postingAt(videoId: string, position: number) {
  const row = (await postingsOf(videoId)).find((p) => p.position === position);
  if (!row) throw new Error(`no posting at position ${position}`);
  return row;
}

/**
 * syncedUpload with its post `nn` pasted and saved on the upload: `row` is the posting the save wrote. With `failWith`,
 * the save's live check meets that error (check_failed), and getPost answers again after it.
 */
async function pastedOnUpload(
  nn = "01",
  { failWith }: { failWith?: Error } = {},
) {
  const { d, upload, post } = await syncedUpload(nn);
  const failing = failWith && spyGetPost().mockRejectedValue(failWith);
  await saveOk(d.actor, upload.id, [demoPaste(post.permalink)]);
  failing?.mockRestore();
  return { d, upload, post, row: await postingAt(upload.id, 1) };
}

/** The verified fields Q-69 a and Q-70 a keep. */
const verifiedFields = (p: VideoPosting) => ({
  verification: p.verification,
  unverifiedReason: p.unverifiedReason,
  socialAccountId: p.socialAccountId,
  socialPostId: p.socialPostId,
  verifiedUsername: p.verifiedUsername,
  verifiedAccountLinkedAt: p.verifiedAccountLinkedAt,
  verifiedAt: p.verifiedAt,
  url: p.url,
  linkKey: p.linkKey,
});

/** Marks a synced post removed, last seen an hour ago. */
const removePost = (postId: string) =>
  db
    .update(socialPost)
    .set({
      status: "removed",
      removedAt: new Date(),
      fetchedAt: new Date(Date.now() - HOUR_MS),
    })
    .where(eq(socialPost.id, postId));

/** A save that must succeed: its whole result. */
async function savedResult(...args: Parameters<typeof save>) {
  const result = await save(...args);
  if (!result.ok) {
    throw new Error(`the save was refused: ${JSON.stringify(result.fields)}`);
  }
  return result;
}

/**
 * The save's own deadline (Q-82 a), in the test's hands: the next AbortSignal.timeout gives `deadline`'s signal, and
 * getPost aborts it once it has answered, so the first live check is the last one in time.
 */
function deadlineAfterFirstGetPost() {
  const deadline = new AbortController();
  const timeout = vi
    .spyOn(AbortSignal, "timeout")
    .mockReturnValueOnce(deadline.signal);
  const realGet = mockProvider.getPost.bind(mockProvider);
  const getPost = spyGetPost().mockImplementation(async (...args) => {
    const live = await realGet(...args);
    deadline.abort();
    return live;
  });
  return { timeout, getPost };
}

/** Moves the account's connect and last sync an hour back: only a check's age then decides the cooldown (Q-84 a). */
const linkedLongAgo = (accountId: string) =>
  db
    .update(socialAccount)
    .set({
      connectedAt: new Date(Date.now() - HOUR_MS),
      lastSyncedAt: new Date(Date.now() - HOUR_MS),
    })
    .where(eq(socialAccount.id, accountId));

/** The columns a carried-over row keeps (Q-84 a): its verification, checked_at and Switch. */
const lastResult = (p: VideoPosting) => ({
  ...verifiedFields(p),
  checkedAt: p.checkedAt,
  showLink: p.showLink,
});

describe("saveVideoPostings: Verified only by the post's id on a linked account (07 D68)", () => {
  it("verifies a synced post by a DB match: one live getPost, no lookup; ownership follows the postings", async () => {
    const { d, upload, post } = await syncedUpload();
    const getPost = spyGetPost();
    const find = spyFind();

    const postings = await saveOk(d.actor, upload.id, [
      demoPaste(`${post.permalink}?utm_source=share#t=3`),
    ]);

    expect(getPost).toHaveBeenCalledTimes(1);
    expect(getPost).toHaveBeenCalledWith(
      expect.any(String),
      post.providerPostId,
      d.account.providerAccountId,
      { signal: expect.any(AbortSignal) },
    );
    expect(find).not.toHaveBeenCalled();
    const [row, ...others] = await postingsOf(upload.id);
    expect(others).toEqual([]);
    expect(row).toMatchObject({
      videoId: upload.id,
      creatorId: d.account.creatorId,
      platform: "mock",
      position: 1,
      isSource: false,
      otherLabel: null,
      url: post.permalink,
      linkKey: post.linkKey,
      verification: "verified",
      unverifiedReason: null,
      socialAccountId: d.account.id,
      socialPostId: post.id,
      verifiedUsername: "@demo.creator",
      verifiedAccountLinkedAt: d.account.connectedAt,
      showLink: true,
    });
    expect(row?.verifiedAt).toBeInstanceOf(Date);
    expect(row?.checkedAt).toBeInstanceOf(Date);
    expect(postings).toEqual(await listVideoPostings(d.actor, upload.id));
    expect(postings).toMatchObject([
      {
        id: row?.id,
        platform: "mock",
        label: "Demo",
        url: post.permalink,
        verification: "verified",
        isSource: false,
        position: 1,
      },
    ]);
    const saved = await videoRow(upload.id);
    expect(saved.ownership).toBe("verified_owner");
    expect(saved.postingsConfirmedAt).toBeInstanceOf(Date);

    // A re-save without the link drops its row, and ownership follows it back.
    expect(await saveOk(d.actor, upload.id, [FACEBOOK])).toMatchObject([
      { platform: "facebook", verification: "unverified", position: 1 },
    ]);
    expect((await postingsOf(upload.id)).map((p) => p.platform)).toEqual([
      "facebook",
    ]);
    expect((await videoRow(upload.id)).ownership).toBe("self_attested");
  });

  it("matches a synced row whatever its status: the live answer brings a removed post back as available", async () => {
    const { d, upload, post } = await syncedUpload("02");
    await removePost(post.id);
    const find = spyFind();

    await saveOk(d.actor, upload.id, [demoPaste(post.permalink)]);

    expect(find).not.toHaveBeenCalled();
    expect(await postingAt(upload.id, 1)).toMatchObject({
      verification: "verified",
      socialPostId: post.id,
    });
    const refreshed = await postNumber(d.account.id, "02");
    expect(refreshed).toMatchObject({ status: "available", removedAt: null });
    expect(refreshed.fetchedAt.getTime()).toBeGreaterThan(
      Date.now() - HOUR_MS / 2,
    );
  });

  it("verifies a post the sync never stored by a lookup by id, and adds it to the Library (pinned_old_post, post 24)", async () => {
    setMockScenarioForTests("pinned_old_post");
    const { d, upload } = await syncedUpload();
    const id24 = mockPostId(d.account, "24");
    expect((await postsOf(d.account.id)).map((p) => p.providerPostId)).toEqual(
      expect.not.arrayContaining([id24]),
    );
    const find = spyFind();

    await saveOk(d.actor, upload.id, [demoPaste(mockLink(d.account, "24"))]);

    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith(
      expect.any(String),
      id24,
      d.account.providerAccountId,
      { signal: expect.any(AbortSignal) },
    );
    const added = (await postsOf(d.account.id)).find(
      (p) => p.providerPostId === id24,
    );
    expect(added).toMatchObject({
      creatorId: d.account.creatorId,
      status: "available",
      linkKey: id24,
      permalink: mockLink(d.account, "24"),
    });
    expect(await postingAt(upload.id, 1)).toMatchObject({
      verification: "verified",
      socialAccountId: d.account.id,
      socialPostId: added?.id,
      linkKey: id24,
    });
    expect((await videoRow(upload.id)).ownership).toBe("verified_owner");
  });

  it("saves post 05 as not_found once the platform no longer has it (post_removed, synced before)", async () => {
    const { d, upload, post } = await syncedUpload("05");
    setMockScenarioForTests("post_removed");
    const getPost = spyGetPost();
    const find = spyFind();

    await saveOk(d.actor, upload.id, [demoPaste(post.permalink)]);

    expect(getPost).toHaveBeenCalledTimes(1);
    expect(find).not.toHaveBeenCalled();
    const row = await postingAt(upload.id, 1);
    expect(row).toMatchObject({
      url: post.permalink,
      linkKey: post.linkKey,
      verification: "unverified",
      unverifiedReason: "not_found",
      socialAccountId: null,
      socialPostId: null,
      verifiedUsername: null,
      verifiedAt: null,
    });
    expect(row.checkedAt).toBeInstanceOf(Date);
    expect((await videoRow(upload.id)).ownership).toBe("self_attested");
  });

  it("saves another creator's post as not_found: the lookup on the creator's own account finds nothing", async () => {
    const { d, upload } = await syncedUpload();
    const other = await demoAccount();
    const find = spyFind();

    await saveOk(d.actor, upload.id, [
      demoPaste(mockLink(other.account, "03")),
    ]);

    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith(
      expect.any(String),
      mockPostId(other.account, "03"),
      d.account.providerAccountId,
      { signal: expect.any(AbortSignal) },
    );
    expect(await postingAt(upload.id, 1)).toMatchObject({
      verification: "unverified",
      unverifiedReason: "not_found",
      linkKey: mockPostId(other.account, "03"),
    });
    expect(await postsOf(other.account.id)).toEqual([]);
  });

  it("saves no_account with no platform call when the creator has no Demo account", async () => {
    const { creator, actor } = await bareCreator();
    const upload = await insertUploadVideo(creator);
    const other = await demoAccount();
    const getPost = spyGetPost();
    const find = spyFind();

    await saveOk(actor, upload.id, [demoPaste(mockLink(other.account, "02"))]);

    expect(getPost).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    const row = await postingAt(upload.id, 1);
    expect(row).toMatchObject({
      platform: "mock",
      url: mockLink(other.account, "02"),
      linkKey: mockPostId(other.account, "02"),
      verification: "unverified",
      unverifiedReason: "no_account",
    });
    expect(row.checkedAt).toBeInstanceOf(Date);
  });

  it("saves an Instagram reel as no_account when the creator has no Instagram account, with no call", async () => {
    const d = await demoAccount();
    const upload = await insertUploadVideo({ id: d.account.creatorId });
    const getPost = spyGetPost();
    const find = spyFind();

    await saveOk(d.actor, upload.id, [
      { platform: "instagram", link: IG_LINK },
    ]);

    expect(getPost).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    expect(await postingAt(upload.id, 1)).toMatchObject({
      platform: "instagram",
      url: IG_URL,
      linkKey: IG_CODE,
      verification: "unverified",
      unverifiedReason: "no_account",
    });
  });

  it("saves check_failed with no call when the only account needs a reconnect, and the save still succeeds", async () => {
    const { d, upload, post } = await syncedUpload();
    await db
      .update(socialAccount)
      .set({ status: "needs_reconnect" })
      .where(eq(socialAccount.id, d.account.id));
    const getPost = spyGetPost();
    const find = spyFind();

    await saveOk(d.actor, upload.id, [demoPaste(post.permalink)]);

    expect(getPost).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    expect(await postingAt(upload.id, 1)).toMatchObject({
      verification: "unverified",
      unverifiedReason: "check_failed",
    });
    expect((await videoRow(upload.id)).postingsConfirmedAt).toBeInstanceOf(
      Date,
    );
  });

  it("saves check_failed with no call when the connected account has neither a handle nor a name (verifiedAs)", async () => {
    const { d, upload, post } = await syncedUpload();
    await db
      .update(socialAccount)
      .set({ username: null, displayName: null })
      .where(eq(socialAccount.id, d.account.id));
    const getPost = spyGetPost();

    await saveOk(d.actor, upload.id, [demoPaste(post.permalink)]);

    expect(getPost).not.toHaveBeenCalled();
    expect(await postingAt(upload.id, 1)).toMatchObject({
      verification: "unverified",
      unverifiedReason: "check_failed",
    });
  });

  it.each([
    ["a platform failure", new SocialUpstreamError()],
    ["a rate limit", new SocialRateLimitError(900)],
  ])(
    "saves check_failed when the live check meets %s: the account stays connected and no log line carries the link",
    async (_, failure) => {
      const { d, upload, post } = await syncedUpload();
      const getPost = spyGetPost().mockRejectedValue(failure);
      const logged = captureLogEvents("postings.check_failed");

      await saveOk(d.actor, upload.id, [demoPaste(post.permalink)]);

      const { written } = logged();
      expect(getPost).toHaveBeenCalledTimes(1);
      expect(await postingAt(upload.id, 1)).toMatchObject({
        verification: "unverified",
        unverifiedReason: "check_failed",
      });
      expect((await accountRow(d.account.id)).status).toBe("connected");
      expect(written).not.toContain("https://");
      expect(written).not.toContain("example.com/mock");
    },
  );

  it("saves check_failed when the platform refuses the token, and the account needs a reconnect (07 D12 b)", async () => {
    const { d, upload, post } = await syncedUpload();
    spyGetPost().mockRejectedValue(new SocialAuthError());

    await saveOk(d.actor, upload.id, [demoPaste(post.permalink)]);

    expect(await postingAt(upload.id, 1)).toMatchObject({
      verification: "unverified",
      unverifiedReason: "check_failed",
    });
    expect((await accountRow(d.account.id)).status).toBe("needs_reconnect");
  });

  it("saves Facebook, X, Snapchat and Other as unverifiable and a link-less TikTok as no_link: no call, no checked_at", async () => {
    const d = await demoAccount();
    const upload = await insertUploadVideo({ id: d.account.creatorId });
    const getPost = spyGetPost();
    const find = spyFind();

    await saveOk(d.actor, upload.id, [
      FACEBOOK,
      X_POST,
      { platform: "snapchat", link: SNAP_LINK },
      vimeo(123456789, { link: "https://vimeo.com/123456789#t=10s" }),
      { platform: "tiktok" },
      { platform: "x", link: "" },
    ]);

    expect(getPost).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    expect(
      (await postingsOf(upload.id)).map((p) => [
        p.position,
        p.platform,
        p.otherLabel,
        p.url,
        p.linkKey,
        p.verification,
        p.unverifiedReason,
        p.checkedAt,
      ]),
    ).toEqual([
      [1, "facebook", null, FB_URL, FB_ID, "unverified", "unverifiable", null],
      [2, "x", null, X_URL, X_ID, "unverified", "unverifiable", null],
      [
        3,
        "snapchat",
        null,
        SNAP_URL,
        SNAP_ID,
        "unverified",
        "unverifiable",
        null,
      ],
      [
        4,
        "other",
        "Vimeo",
        "https://vimeo.com/123456789",
        null,
        "unverified",
        "unverifiable",
        null,
      ],
      [5, "tiktok", null, null, null, "unverified", "no_link", null],
      [6, "x", null, null, null, "unverified", "unverifiable", null],
    ]);
    expect((await videoRow(upload.id)).ownership).toBe("self_attested");
  });

  it("refuses a post the live check finds private: fields[i] = 'private', nothing written, postings unconfirmed", async () => {
    const { d, upload, post } = await syncedUpload();
    const getPost = liveGetPost({ visibility: "private" });

    expect(
      await save(d.actor, upload.id, [FACEBOOK, demoPaste(post.permalink)]),
    ).toEqual({ ok: false, fields: { 1: "private" } });

    expect(getPost).toHaveBeenCalledTimes(1);
    expect(await postingsOf(upload.id)).toEqual([]);
    expect((await videoRow(upload.id)).postingsConfirmedAt).toBeNull();
    expect(await auditsOf(upload.id, "video.postings_saved")).toEqual([]);
  });

  it("verifies an unlisted post with its link hidden by default, and keeps an explicit showLink (07 D18 per posting)", async () => {
    const { d, upload, post: first } = await syncedUpload();
    const second = await postNumber(d.account.id, "02");
    liveGetPost({ visibility: "unlisted" });

    await saveOk(d.actor, upload.id, [
      demoPaste(first.permalink),
      demoPaste(second.permalink, { showLink: true }),
      vimeo(77, { showLink: false }),
      FACEBOOK,
    ]);

    expect(
      (await postingsOf(upload.id)).map((p) => [
        p.platform,
        p.verification,
        p.showLink,
      ]),
    ).toEqual([
      ["mock", "verified", false],
      ["mock", "verified", true],
      ["other", "unverified", false],
      ["facebook", "unverified", true],
    ]);
  });

  it("keeps a verified unlisted link the creator showed shown when a later save sends no Switch for it (07 D18)", async () => {
    const { d, upload, post: first } = await syncedUpload();
    const second = await postNumber(d.account.id, "02");
    liveGetPost({ visibility: "unlisted" });
    await saveOk(d.actor, upload.id, [
      demoPaste(first.permalink),
      demoPaste(second.permalink, { showLink: true }),
    ]);

    // The step posts no unchanged Switch; past the cooldown (Q-84 a) the re-save checks both links again, still unlisted.
    for (const row of await postingsOf(upload.id)) {
      await backdateCheckedAt(row.id);
    }
    await saveOk(d.actor, upload.id, [
      demoPaste(first.permalink),
      demoPaste(second.permalink),
      FACEBOOK,
    ]);

    expect(
      (await postingsOf(upload.id)).map((p) => [
        p.platform,
        p.verification,
        p.showLink,
      ]),
    ).toEqual([
      ["mock", "verified", false],
      ["mock", "verified", true],
      ["facebook", "unverified", true],
    ]);
  });

  it("returns each refused link by its index in the input, with no platform call and nothing written", async () => {
    const { d, upload, post } = await syncedUpload();
    const getPost = spyGetPost();
    const find = spyFind();

    expect(
      await save(d.actor, upload.id, [
        { platform: "instagram", link: "https://instagram.com@evil.com/" },
        demoPaste(post.permalink),
        { platform: "tiktok", link: "https://vm.tiktok.com/ZMabc123/" },
        {
          platform: "other",
          otherLabel: "Intranet",
          link: "http://localhost/",
        },
        {
          platform: "instagram",
          link: "https://www.tiktok.com/@scout2015/video/6718335390845095173",
        },
        { platform: "youtube", link: "https://www.youtube.com/@mayafilms" },
        {
          platform: "tiktok",
          link: `https://www.tiktok.com/@maya.films/photo/${TIKTOK_ID}`,
        },
        { platform: "x", link: "javascript:alert(1)" },
      ]),
    ).toEqual({
      ok: false,
      fields: {
        0: "bad_host",
        2: "short_link",
        3: "bad_host",
        4: "wrong_platform",
        5: "profile_link",
        6: "not_a_video",
        7: "not_a_url",
      },
    });

    expect(getPost).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    expect(await postingsOf(upload.id)).toEqual([]);
    expect((await videoRow(upload.id)).postingsConfirmedAt).toBeNull();
  });

  it("stores canonical URLs only: no tracking parameter or fragment survives, and ids stay exact strings", async () => {
    const { d, upload, post } = await syncedUpload("03");

    await saveOk(d.actor, upload.id, [
      { platform: "instagram", link: IG_LINK },
      {
        platform: "instagram",
        link: "https://m.instagram.com/reels/C9xYz12AbCe/?utm_source=ig_web_copy_link",
      },
      {
        platform: "tiktok",
        link: `Check out maya's video! #tiktok https://m.tiktok.com/@maya.films/video/${TIKTOK_ID}?is_from_webapp=1&sender_device=pc`,
      },
      { platform: "youtube", link: "https://youtu.be/dQw4w9WgXcQ?si=Ab12" },
      {
        platform: "youtube",
        link: "https://youtube.com/shorts/dQw4w9WgXcR?feature=share",
      },
      demoPaste(`${post.permalink}?utm_medium=copy#top`),
    ]);

    expect(
      (await postingsOf(upload.id)).map((p) => [p.url, p.linkKey]),
    ).toEqual([
      [IG_URL, IG_CODE],
      ["https://www.instagram.com/reel/C9xYz12AbCe/", "C9xYz12AbCe"],
      [`https://www.tiktok.com/@maya.films/video/${TIKTOK_ID}`, TIKTOK_ID],
      ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["https://www.youtube.com/shorts/dQw4w9WgXcR", "dQw4w9WgXcR"],
      [post.permalink, post.linkKey],
    ]);
    expect(await trackingUrlCount()).toBe(0);
  });
});

describe("saveVideoPostings: a saved Verified link survives a failed re-check (Q-69 a, Q-70 a)", () => {
  it("keeps a verified link verified when a re-save's check fails (Q-69 a): only checked_at moves", async () => {
    const { d, upload, post, row: before } = await pastedOnUpload();
    const checkedBefore = await backdateCheckedAt(before.id);
    const tick = await setSameVideoConfirmed(upload.id);
    const getPost = spyGetPost().mockRejectedValue(
      new SocialRateLimitError(900),
    );

    await saveOk(d.actor, upload.id, [demoPaste(post.permalink)]);

    expect(getPost).toHaveBeenCalledTimes(1);
    const after = await postingAt(upload.id, 1);
    expect(verifiedFields(after)).toEqual(verifiedFields(before));
    expect(after.checkedAt?.getTime()).toBeGreaterThan(checkedBefore.getTime());
    const saved = await videoRow(upload.id);
    expect(saved.ownership).toBe("verified_owner");
    expect(saved.sameVideoConfirmedAt).toEqual(tick);
  });

  it("keeps a verified link verified on a re-save after its account was disconnected (Q-70 a): no call, checked_at kept", async () => {
    const { d, upload, post, row: before } = await pastedOnUpload();
    const checkedBefore = await backdateCheckedAt(before.id);
    const tick = await setSameVideoConfirmed(upload.id);
    await disconnectSocialAccount(d.account.id, d.actor);
    const getPost = spyGetPost();
    const find = spyFind();

    await saveOk(d.actor, upload.id, [demoPaste(post.permalink)]);

    expect(getPost).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    const after = await postingAt(upload.id, 1);
    expect(verifiedFields(after)).toEqual(verifiedFields(before));
    // No check ran, so none is recorded.
    expect(after.checkedAt).toEqual(checkedBefore);
    const saved = await videoRow(upload.id);
    expect(saved.ownership).toBe("verified_owner");
    expect(saved.sameVideoConfirmedAt).toEqual(tick);
    expect(await listVideoPostings(d.actor, upload.id)).toMatchObject([
      { verification: "verified", accountStatus: "disconnected" },
    ]);
  });

  it("keeps a link verified through a disconnected account while another account on that platform is connected (Q-70 a), with no call", async () => {
    const { d, upload, post, row: before } = await pastedOnUpload();
    // The other account can't see this post: its lookup would answer not_found, which is no answer here.
    await extraDemoAccount({ id: d.account.creatorId }, new Date());
    await disconnectSocialAccount(d.account.id, d.actor);
    const getPost = spyGetPost();
    const find = spyFind();

    await saveOk(d.actor, upload.id, [demoPaste(post.permalink)]);
    const after = await postingAt(upload.id, 1);
    expect(verifiedFields(after)).toEqual(verifiedFields(before));
    expect((await videoRow(upload.id)).ownership).toBe("verified_owner");

    expect(
      await recheckPosting(d.actor, { postingId: after.id }),
    ).toMatchObject({ verification: "verified" });
    expect(getPost).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
  });

  it("keeps a link verified through an account that lost its name while another account is connected: check_failed with no call, never not_found", async () => {
    const { d, upload, post, row: before } = await pastedOnUpload();
    // The post is synced on an account that can't verify until a reconnect; the other account can't see it.
    await db
      .update(socialAccount)
      .set({ username: null, displayName: null })
      .where(eq(socialAccount.id, d.account.id));
    await extraDemoAccount({ id: d.account.creatorId }, new Date());
    const getPost = spyGetPost();
    const find = spyFind();

    await saveOk(d.actor, upload.id, [demoPaste(post.permalink)]);
    const after = await postingAt(upload.id, 1);
    expect(verifiedFields(after)).toEqual(verifiedFields(before));
    // The save's failed check just moved checked_at: past the cooldown (Q-84 a), Check again asks again.
    await backdateCheckedAt(after.id);
    expect(
      await recheckPosting(d.actor, { postingId: after.id }),
    ).toMatchObject({ verification: "verified" });

    expect(getPost).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    expect(verifiedFields(await postingRow(after.id))).toEqual(
      verifiedFields(before),
    );
    expect((await videoRow(upload.id)).ownership).toBe("verified_owner");
  });

  it("still downgrades a verified link the platform no longer has (not_found), and clears the same-video tick", async () => {
    const { d, upload, post, row } = await pastedOnUpload("05");
    await backdateCheckedAt(row.id);
    await setSameVideoConfirmed(upload.id);
    setMockScenarioForTests("post_removed");

    await saveOk(d.actor, upload.id, [demoPaste(post.permalink)]);

    expect(await postingAt(upload.id, 1)).toMatchObject({
      verification: "unverified",
      unverifiedReason: "not_found",
    });
    const saved = await videoRow(upload.id);
    expect(saved.ownership).toBe("self_attested");
    expect(saved.sameVideoConfirmedAt).toBeNull();
  });
});

describe("saveVideoPostings: one verified posting per platform post (07 D66, D68)", () => {
  it("refuses a post another creator holds verified, whether or not the paste would verify (shared_account), with no call", async () => {
    const {
      a,
      aPost,
      made: { videoId },
      b,
      bPost,
    } = await twoCreatorsOnOneAccount((creator, id) =>
      createVideoFromPost(creator.actor, id),
    );
    const link = "https://example.com/mock/mock_post_shared_01";
    expect(bPost.permalink).toBe(link);
    const bUpload = await insertUploadVideo({ id: b.creatorId });
    // C has no account at all: an unverified paste is refused too.
    const c = await bareCreator();
    const cUpload = await insertUploadVideo(c.creator);
    const getPost = spyGetPost();
    const find = spyFind();

    await expect(
      save(b.actor, bUpload.id, [demoPaste(link)]),
    ).rejects.toBeInstanceOf(AlreadyLicensableElsewhereError);
    await expect(
      save(c.actor, cUpload.id, [demoPaste(link)]),
    ).rejects.toBeInstanceOf(AlreadyLicensableElsewhereError);

    expect(getPost).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    for (const upload of [bUpload, cUpload]) {
      expect(await postingsOf(upload.id)).toEqual([]);
      expect((await videoRow(upload.id)).postingsConfirmedAt).toBeNull();
    }
    expect(await postingsOf(videoId)).toMatchObject([
      {
        creatorId: a.creatorId,
        isSource: true,
        verification: "verified",
        linkKey: aPost.linkKey,
      },
    ]);
  });

  it("refuses the creator's post that is already on their other video (AlreadyOnYourVideoError with its title)", async () => {
    const { d, post } = await libraryVideo("01");
    const upload = await insertUploadVideo({ id: d.account.creatorId });
    const getPost = spyGetPost();

    const error = await save(d.actor, upload.id, [
      demoPaste(post.permalink),
    ]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AlreadyOnYourVideoError);
    expect(error).toMatchObject({ videoTitle: SNOW_TITLE });
    expect(getPost).not.toHaveBeenCalled();
    expect(await postingsOf(upload.id)).toEqual([]);
  });

  it("maps a lost video_posting_verified_uidx by the cross-creator rule again; any other error passes as it is (verifiedPostingConflictError)", async () => {
    const { d, post, videoId } = await libraryVideo("01");
    const upload = await insertUploadVideo({ id: d.account.creatorId });
    const elsewhere = "mock_post_elsewhere_01";
    await insertVerifiedElsewhere(elsewhere);
    const lost = pgError("23505", "video_posting_verified_uidx");
    const on = (videoId: string, linkKey: string): PostingTarget => ({
      creatorId: d.account.creatorId,
      videoId,
      platform: "mock",
      linkKey,
    });

    // The creator's own other video won: its title comes back, bare or wrapped by Drizzle.
    for (const error of [lost, wrapped(lost)]) {
      const mine = await verifiedPostingConflictError(db, error, [
        on(upload.id, post.linkKey),
      ]).catch((e: unknown) => e);
      expect(mine).toBeInstanceOf(AlreadyOnYourVideoError);
      expect(mine).toMatchObject({ videoTitle: SNOW_TITLE });
    }
    await expect(
      verifiedPostingConflictError(db, lost, [on(upload.id, elsewhere)]),
    ).rejects.toBeInstanceOf(AlreadyLicensableElsewhereError);
    // Held by this video, or no target: still the generic refusal.
    for (const targets of [[on(videoId, post.linkKey)], []]) {
      expect(
        await verifiedPostingConflictError(db, lost, targets),
      ).toBeInstanceOf(AlreadyLicensableElsewhereError);
    }
    const otherIndex = pgError("23505", "video_posting_video_link_uidx");
    const bug = new TypeError("x is undefined");
    for (const error of [otherIndex, bug, "boom"]) {
      expect(
        await verifiedPostingConflictError(db, error, [
          on(upload.id, elsewhere),
        ]),
      ).toBe(error);
    }
  });

  it("re-checks inside the transaction: a post verified elsewhere during the check refuses the save, though the paste stays unverified", async () => {
    const { d, upload, post } = await syncedUpload();
    const elsewhere: string[] = [];
    // The check then fails (check_failed): no unique index stops an unverified row, only the re-check does.
    const getPost = spyGetPost().mockImplementation(async () => {
      elsewhere.push((await insertVerifiedElsewhere(post.linkKey)).id);
      throw new SocialUpstreamError();
    });

    const error = await save(d.actor, upload.id, [
      FACEBOOK,
      demoPaste(post.permalink),
    ]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AlreadyLicensableElsewhereError);
    // The re-check names the refused row too (Q-78 a).
    expect(error).toMatchObject({ index: 1 });

    expect(getPost).toHaveBeenCalledTimes(1);
    expect(elsewhere).toHaveLength(1);
    expect(await postingsOf(upload.id)).toEqual([]);
    expect((await videoRow(upload.id)).postingsConfirmedAt).toBeNull();
  });

  it("names the refused row by its input index (owner answer Q-78 a), whichever refusal, and saves nothing", async () => {
    const { d, post } = await libraryVideo("01");
    const upload = await insertUploadVideo({ id: d.account.creatorId });
    const post03 = await postNumber(d.account.id, "03");
    const elsewhere = "mock_post_0badc0de_02";
    await insertVerifiedElsewhere(elsewhere);
    const getPost = spyGetPost();
    const refusal = (postings: PostingInput[]) =>
      save(d.actor, upload.id, postings).catch((e: unknown) => e);

    // A copy dropped before the check (index 2) keeps the input's numbering.
    const mine = await refusal([
      FACEBOOK,
      demoPaste(post03.permalink),
      demoPaste(`${post03.permalink}/?utm_source=copy`),
      demoPaste(post.permalink),
    ]);
    expect(mine).toBeInstanceOf(AlreadyOnYourVideoError);
    expect(mine).toMatchObject({ videoTitle: SNOW_TITLE, index: 3 });

    const theirs = await refusal([
      vimeo(1),
      { platform: "tiktok" },
      demoPaste(`https://example.com/mock/${elsewhere}`),
      demoPaste(post.permalink),
    ]);
    expect(theirs).toBeInstanceOf(AlreadyLicensableElsewhereError);
    expect(theirs).toMatchObject({ index: 2 });

    expect(getPost).not.toHaveBeenCalled();
    expect(await postingsOf(upload.id)).toEqual([]);
    expect((await videoRow(upload.id)).postingsConfirmedAt).toBeNull();
  });

  it("audits other creators' unverified pastes when a link verifies (video_posting.conflict, ids only); theirs stay", async () => {
    const { d, upload, post } = await syncedUpload("07");
    const b = await bareCreator();
    const bUpload = await insertUploadVideo(b.creator);
    await saveOk(b.actor, bUpload.id, [demoPaste(post.permalink)]);
    const theirs = await postingAt(bUpload.id, 1);
    expect(theirs).toMatchObject({
      verification: "unverified",
      unverifiedReason: "no_account",
    });

    await saveOk(d.actor, upload.id, [demoPaste(post.permalink)]);

    const mine = await postingAt(upload.id, 1);
    expect(mine.verification).toBe("verified");
    const audits = await auditsOf(mine.id, "video_posting.conflict");
    expect(audits).toEqual([
      {
        actorType: "creator",
        data: {
          videoPostingId: mine.id,
          platform: "mock",
          conflictingPostingIds: [theirs.id],
        },
      },
    ]);
    expect(await auditsOf(theirs.id, "video_posting.conflict")).toEqual([]);
    expect(await conflictAuditsNaming([mine.id, theirs.id])).toHaveLength(1);
    const json = JSON.stringify(audits);
    expect(json).not.toContain("https://");
    expect(json).not.toContain(post.linkKey);
    expect(await postingsOf(bUpload.id)).toEqual([theirs]);
  });

  it("writes no second conflict audit when a re-save keeps the link verified (07 D68: on becoming verified only)", async () => {
    const { d, upload, post } = await syncedUpload("09");
    const b = await bareCreator();
    const bUpload = await insertUploadVideo(b.creator);
    await saveOk(b.actor, bUpload.id, [demoPaste(post.permalink)]);
    await saveOk(d.actor, upload.id, [demoPaste(post.permalink)]);
    const first = await postingAt(upload.id, 1);
    expect(await auditsOf(first.id, "video_posting.conflict")).toHaveLength(1);
    // Past the cooldown (Q-84 a): the re-save checks the link again, and it verifies again.
    await backdateCheckedAt(first.id);
    const getPost = spyGetPost();

    await saveOk(d.actor, upload.id, [demoPaste(post.permalink)]);

    expect(getPost).toHaveBeenCalledTimes(1);

    const again = await postingAt(upload.id, 1);
    expect(again.verification).toBe("verified");
    expect(await auditsOf(again.id, "video_posting.conflict")).toEqual([]);
  });
});

describe("saveVideoPostings: the rules of the step (07 D69)", () => {
  it("saves 12 rows on an upload at positions 1…12, and refuses 13 before anything is written", async () => {
    const { creator, actor } = await bareCreator();
    const upload = await insertUploadVideo(creator);
    await saveOk(actor, upload.id, vimeos(POSTINGS_MAX, 1000));
    expect((await postingsOf(upload.id)).map((p) => p.position)).toEqual(
      Array.from({ length: POSTINGS_MAX }, (_, i) => i + 1),
    );

    const other = await insertUploadVideo(creator);
    await expect(
      save(actor, other.id, vimeos(POSTINGS_MAX + 1, 2000)),
    ).rejects.toBeInstanceOf(ZodError);
    expect(await postingsOf(other.id)).toEqual([]);
    expect((await videoRow(other.id)).postingsConfirmedAt).toBeNull();
  });

  it("lets a Library video take 11 rows beside its source, and refuses 12 (InvalidPostingsError too_many) with no call", async () => {
    const { d, videoId } = await libraryVideo();
    const post02 = await postNumber(d.account.id, "02");
    await saveOk(d.actor, videoId, vimeos(POSTINGS_MAX - 1, 3000));
    const before = await postingsOf(videoId);
    expect(before.map((p) => p.position)).toEqual(
      Array.from({ length: POSTINGS_MAX }, (_, i) => i),
    );
    const getPost = spyGetPost();

    const error = await save(d.actor, videoId, [
      demoPaste(post02.permalink),
      ...vimeos(POSTINGS_MAX - 1, 4000),
    ]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InvalidPostingsError);
    expect(error).toMatchObject({ code: "too_many" });
    expect(getPost).not.toHaveBeenCalled();
    expect(await postingsOf(videoId)).toEqual(before);
  });

  it("refuses published and disabled videos (PostingsLockedError) and saves an unpublished one", async () => {
    const { creator, actor } = await bareCreator();
    const published = await publishVideo(await insertUploadVideo(creator));
    const disabled = await insertUploadVideo(creator, {
      status: "disabled",
      disabledAt: new Date(),
      disabledReason: "other",
    });
    const unpublished = await insertUploadVideo(creator, {
      status: "unpublished",
    });

    for (const locked of [published, disabled]) {
      await expect(save(actor, locked.id, [FACEBOOK])).rejects.toBeInstanceOf(
        PostingsLockedError,
      );
      expect(await postingsOf(locked.id)).toEqual([]);
    }
    await saveOk(actor, unpublished.id, [FACEBOOK]);
    expect(await postingsOf(unpublished.id)).toMatchObject([
      { platform: "facebook", position: 1 },
    ]);
  });

  it("answers another creator's video and an unknown id as not found (VideoNotFoundError), writing nothing", async () => {
    const owner = await bareCreator();
    const theirs = await insertUploadVideo(owner.creator);
    const me = await bareCreator();

    for (const id of [theirs.id, randomUUID()]) {
      await expect(save(me.actor, id, [FACEBOOK])).rejects.toBeInstanceOf(
        VideoNotFoundError,
      );
    }
    expect(await postingsOf(theirs.id)).toEqual([]);
    expect((await videoRow(theirs.id)).postingsConfirmedAt).toBeNull();
  });

  it("keeps the source posting through every save: [] leaves it alone, and a copy of its link is dropped", async () => {
    const { d, post, videoId } = await libraryVideo();
    const [source] = await postingsOf(videoId);
    expect(source).toMatchObject({
      isSource: true,
      position: 0,
      verification: "verified",
    });
    const getPost = spyGetPost();

    await saveOk(d.actor, videoId, []);
    expect(await postingsOf(videoId)).toEqual([source]);

    await saveOk(d.actor, videoId, [demoPaste(post.permalink), FACEBOOK]);
    expect(getPost).not.toHaveBeenCalled();
    const rows = await postingsOf(videoId);
    expect(rows[0]).toEqual(source);
    expect(rows.map((p) => [p.position, p.platform, p.isSource])).toEqual([
      [0, "mock", true],
      [1, "facebook", false],
    ]);
    expect((await videoRow(videoId)).ownership).toBe("verified_owner");
  });

  it("sets only the source row's show_link from sourceShowLink (Q-73 a): a kept row, the tick and an upload are unaffected", async () => {
    const { d, videoId } = await libraryVideo();
    const post02 = await postNumber(d.account.id, "02");
    await saveOk(d.actor, videoId, [demoPaste(post02.permalink)]);
    const [source, kept] = (await postingsOf(videoId)) as [
      VideoPosting,
      VideoPosting,
    ];
    expect([source.showLink, kept.showLink]).toEqual([true, true]);
    await markOriginalReady({ id: videoId, creatorId: d.account.creatorId });
    await confirmSameVideo(d.actor, videoId);
    const tick = await confirmedAt(videoId);
    // Q-69 a: past the cooldown (Q-84 a), the re-save's check of post 02 fails, so that row is kept verified as it was.
    await backdateCheckedAt(kept.id);
    const getPost = spyGetPost().mockRejectedValue(
      new SocialRateLimitError(900),
    );

    expect(
      await saveWith(d.actor, {
        videoId,
        notPosted: false,
        sourceShowLink: false,
        postings: [demoPaste(post02.permalink)],
      }),
    ).toMatchObject({ ok: true });

    expect(getPost).toHaveBeenCalledTimes(1);
    const [sourceAfter, keptAfter] = (await postingsOf(videoId)) as [
      VideoPosting,
      VideoPosting,
    ];
    const { showLink: _was, updatedAt: _then, ...unchanged } = source;
    const { showLink, updatedAt: _now, ...rest } = sourceAfter;
    expect(showLink).toBe(false);
    expect(rest).toEqual(unchanged);
    expect(verifiedFields(keptAfter)).toEqual(verifiedFields(kept));
    expect(keptAfter.showLink).toBe(true);
    const saved = await videoRow(videoId);
    expect(saved.ownership).toBe("verified_owner");
    expect(saved.sameVideoConfirmedAt).toEqual(tick);
    getPost.mockRestore();

    // On again; a save without it leaves the source's Switch as it is.
    expect(
      await saveWith(d.actor, {
        videoId,
        notPosted: false,
        sourceShowLink: true,
        postings: [],
      }),
    ).toMatchObject({ ok: true });
    expect((await postingRow(source.id)).showLink).toBe(true);
    expect(
      await saveWith(d.actor, {
        videoId,
        notPosted: false,
        sourceShowLink: false,
        postings: [],
      }),
    ).toMatchObject({ ok: true });
    await saveOk(d.actor, videoId, [FACEBOOK]);
    expect((await postingRow(source.id)).showLink).toBe(false);

    // An upload has no source row: the field is ignored.
    const upload = await insertUploadVideo({ id: d.account.creatorId });
    expect(
      await saveWith(d.actor, {
        videoId: upload.id,
        notPosted: false,
        sourceShowLink: false,
        postings: [FACEBOOK],
      }),
    ).toMatchObject({ ok: true });
    expect(await postingsOf(upload.id)).toMatchObject([
      { platform: "facebook", isSource: false, showLink: true },
    ]);
  });

  it("refuses notPosted on a Library video (InvalidPostingsError not_posted_library)", async () => {
    const { d, videoId } = await libraryVideo();
    const before = await postingsOf(videoId);

    const error = await save(d.actor, videoId, [], true).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(InvalidPostingsError);
    expect(error).toMatchObject({ code: "not_posted_library" });
    expect(await postingsOf(videoId)).toEqual(before);
    expect((await videoRow(videoId)).postingsConfirmedAt).toBeNull();
  });

  it("saves notPosted on an upload as zero rows: postings confirmed, self-attested", async () => {
    const { d, upload, post } = await syncedUpload();
    await saveOk(d.actor, upload.id, [demoPaste(post.permalink), FACEBOOK]);
    expect((await videoRow(upload.id)).ownership).toBe("verified_owner");

    expect(await saveOk(d.actor, upload.id, [], true)).toEqual([]);

    expect(await postingsOf(upload.id)).toEqual([]);
    const saved = await videoRow(upload.id);
    expect(saved.ownership).toBe("self_attested");
    expect(saved.postingsConfirmedAt).toBeInstanceOf(Date);
    expect(await auditsOf(upload.id, "video.postings_saved")).toContainEqual({
      actorType: "creator",
      data: { platforms: [], verified: 0 },
    });
  });

  it("numbers rows 1…n in input order, and a re-save replaces them", async () => {
    const { creator, actor } = await bareCreator();
    const upload = await insertUploadVideo(creator);

    await saveOk(actor, upload.id, [FACEBOOK, X_POST, vimeo(5)]);
    expect(
      (await postingsOf(upload.id)).map((p) => [p.position, p.platform]),
    ).toEqual([
      [1, "facebook"],
      [2, "x"],
      [3, "other"],
    ]);

    await saveOk(actor, upload.id, [X_POST]);
    expect(
      (await postingsOf(upload.id)).map((p) => [p.position, p.platform]),
    ).toEqual([[1, "x"]]);
  });

  it("collapses duplicate links to the first before any check", async () => {
    const { d, upload, post } = await syncedUpload();
    const getPost = spyGetPost();

    await saveOk(d.actor, upload.id, [
      demoPaste(post.permalink),
      FACEBOOK,
      demoPaste(`${post.permalink}/?utm_source=copy`, { showLink: false }),
      { platform: "facebook", link: FB_URL },
    ]);

    expect(getPost).toHaveBeenCalledTimes(1);
    expect(
      (await postingsOf(upload.id)).map((p) => [
        p.position,
        p.platform,
        p.verification,
        p.showLink,
      ]),
    ).toEqual([
      [1, "mock", "verified", true],
      [2, "facebook", "unverified", true],
    ]);
  });

  it("keeps the same-video tick while the verified set is unchanged, and clears it when a verified link is added", async () => {
    const { d, videoId } = await libraryVideo();
    const post02 = await postNumber(d.account.id, "02");
    await markOriginalReady({ id: videoId, creatorId: d.account.creatorId });
    await confirmSameVideo(d.actor, videoId);
    const tick = await confirmedAt(videoId);
    expect(tick).toBeInstanceOf(Date);

    await saveOk(d.actor, videoId, [FACEBOOK]);
    expect(await confirmedAt(videoId)).toEqual(tick);

    await saveOk(d.actor, videoId, [FACEBOOK, demoPaste(post02.permalink)]);
    expect(await confirmedAt(videoId)).toBeNull();

    // The same verified set in another order is no change.
    await confirmSameVideo(d.actor, videoId);
    const again = await confirmedAt(videoId);
    await saveOk(d.actor, videoId, [demoPaste(post02.permalink), FACEBOOK]);
    expect(await confirmedAt(videoId)).toEqual(again);
  });

  it("audits video.postings_saved with exactly { platforms, verified }: positions in order with the source, no URL or key", async () => {
    const { d, post, videoId } = await libraryVideo();
    const post02 = await postNumber(d.account.id, "02");

    await saveOk(d.actor, videoId, [
      FACEBOOK,
      demoPaste(post02.permalink),
      vimeo(9),
    ]);

    const audits = await auditsOf(videoId, "video.postings_saved");
    expect(audits).toEqual([
      {
        actorType: "creator",
        data: { platforms: ["mock", "facebook", "mock", "other"], verified: 2 },
      },
    ]);
    const json = JSON.stringify(audits);
    for (const hidden of [
      "https://",
      post.linkKey,
      post02.linkKey,
      FB_ID,
      "vimeo",
    ]) {
      expect(json).not.toContain(hidden);
    }
  });

  it("refuses nothing chosen on an upload (InvalidPostingsError nothing_chosen) before any call or write", async () => {
    const { d, upload, post } = await syncedUpload();
    const getPost = spyGetPost();

    const error = await save(d.actor, upload.id, []).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InvalidPostingsError);
    expect(error).toMatchObject({ code: "nothing_chosen" });
    expect((await videoRow(upload.id)).postingsConfirmedAt).toBeNull();
    expect(await auditsOf(upload.id, "video.postings_saved")).toEqual([]);

    // Saved postings stay when a later save sends none.
    await saveOk(d.actor, upload.id, [demoPaste(post.permalink), FACEBOOK]);
    const saved = await postingsOf(upload.id);
    getPost.mockClear();
    await expect(save(d.actor, upload.id, [])).rejects.toMatchObject({
      code: "nothing_chosen",
    });
    expect(getPost).not.toHaveBeenCalled();
    expect(await postingsOf(upload.id)).toEqual(saved);
  });

  it("returns the step facts its write left, as getVideoStepFacts reads them right after", async () => {
    const { d, upload, post } = await syncedUpload();
    await markOriginalReady(upload);

    const first = await savedResult(d.actor, upload.id, [
      demoPaste(post.permalink),
    ]);
    expect(first.facts).toStrictEqual(
      await getVideoStepFacts(d.actor, upload.id),
    );
    expect(first.facts).toMatchObject({
      status: "draft",
      originalStatus: "ready",
      source: "upload",
      postingsConfirmedAt: expect.any(String),
      sameVideoConfirmed: false,
      hasVerifiedPosting: true,
    });

    // The verified post dropped: ownership and the tick go in the same write.
    await confirmSameVideo(d.actor, upload.id);
    const second = await savedResult(d.actor, upload.id, [FACEBOOK]);
    expect(second.facts).toStrictEqual(
      await getVideoStepFacts(d.actor, upload.id),
    );
    expect(second.facts).toMatchObject({
      sameVideoConfirmed: false,
      hasVerifiedPosting: false,
    });
  });
});

describe("saveVideoPostings: one deadline for a save's checks (owner answer Q-82 a)", () => {
  it("checks rows until the budget runs out; the rest save as check_failed with no call, and the save succeeds", async () => {
    const { d, upload, post } = await syncedUpload();
    const post02 = await postNumber(d.account.id, "02");
    const elsewhere = await demoAccount();
    const { timeout, getPost } = deadlineAfterFirstGetPost();
    const find = spyFind();

    const postings = await saveOk(d.actor, upload.id, [
      demoPaste(post.permalink),
      demoPaste(post02.permalink),
      FACEBOOK,
      demoPaste(mockLink(elsewhere.account, "03")),
    ]);

    expect(timeout).toHaveBeenCalledWith(POSTING_CHECKS_BUDGET_MS);
    expect(getPost).toHaveBeenCalledTimes(1);
    expect(find).not.toHaveBeenCalled();
    // Not reached, so not checked: no checked_at, and the next Continue or Check again asks at once.
    expect(
      (await postingsOf(upload.id)).map((p) => [
        p.platform,
        p.verification,
        p.unverifiedReason,
        p.checkedAt === null,
      ]),
    ).toEqual([
      ["mock", "verified", null, false],
      ["mock", "unverified", "check_failed", true],
      ["facebook", "unverified", "unverifiable", true],
      ["mock", "unverified", "check_failed", true],
    ]);
    expect(postings).toHaveLength(4);
    const saved = await videoRow(upload.id);
    expect(saved.ownership).toBe("verified_owner");
    expect(saved.postingsConfirmedAt).toBeInstanceOf(Date);
  });

  it("keeps a verified link verified when the budget runs out before its turn (Q-69 a), its checked_at unmoved", async () => {
    const { d, upload, post, row: before } = await pastedOnUpload();
    const checkedBefore = await backdateCheckedAt(before.id);
    const post02 = await postNumber(d.account.id, "02");
    const { getPost } = deadlineAfterFirstGetPost();

    await saveOk(d.actor, upload.id, [
      demoPaste(post02.permalink),
      demoPaste(post.permalink),
    ]);

    expect(getPost).toHaveBeenCalledTimes(1);
    expect(await postingAt(upload.id, 1)).toMatchObject({
      verification: "verified",
      socialPostId: post02.id,
    });
    const kept = await postingAt(upload.id, 2);
    expect(verifiedFields(kept)).toEqual(verifiedFields(before));
    expect(kept.checkedAt).toEqual(checkedBefore);
  });

  it("asks nothing when the budget is spent before the first check: every row that needs a call is check_failed", async () => {
    const { d, upload, post } = await syncedUpload();
    const elsewhere = await demoAccount();
    vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(AbortSignal.abort());
    const getPost = spyGetPost();
    const find = spyFind();

    await saveOk(d.actor, upload.id, [
      demoPaste(post.permalink),
      demoPaste(mockLink(elsewhere.account, "03")),
      { platform: "instagram", link: IG_LINK },
      X_POST,
    ]);

    expect(getPost).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    // Answers that need no call still come: no Instagram account, an X link.
    expect(
      (await postingsOf(upload.id)).map((p) => [
        p.platform,
        p.unverifiedReason,
      ]),
    ).toEqual([
      ["mock", "check_failed"],
      ["mock", "check_failed"],
      ["instagram", "no_account"],
      ["x", "unverifiable"],
    ]);
  });

  it("gives Check again its own budget: a deadline that cuts its call is check_failed, checked now", async () => {
    const { d, row } = await pastedOnUpload("01", {
      failWith: new SocialUpstreamError(),
    });
    const checkedBefore = await backdateCheckedAt(row.id);
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValueOnce(AbortSignal.abort());
    const getPost = spyGetPost();

    expect(await recheckPosting(d.actor, { postingId: row.id })).toMatchObject({
      verification: "unverified",
      unverifiedReason: "check_failed",
    });

    expect(timeout).toHaveBeenCalledWith(POSTING_CHECKS_BUDGET_MS);
    expect(getPost).not.toHaveBeenCalled();
    expect((await postingRow(row.id)).checkedAt?.getTime()).toBeGreaterThan(
      checkedBefore.getTime(),
    );
  });
});

describe("saveVideoPostings and Check again: a check in the last 30 seconds stands (owner answer Q-84 a)", () => {
  it("re-saves unchanged links with no platform call: each keeps its last result, whatever it was", async () => {
    const { d, upload, post } = await syncedUpload();
    const elsewhere = await demoAccount();
    const links = [
      demoPaste(post.permalink),
      demoPaste(mockLink(elsewhere.account, "03")),
      FACEBOOK,
    ];
    await saveOk(d.actor, upload.id, links);
    const before = await postingsOf(upload.id);
    expect(before.map((p) => p.unverifiedReason)).toEqual([
      null,
      "not_found",
      "unverifiable",
    ]);
    const getPost = spyGetPost();
    const find = spyFind();

    await saveOk(d.actor, upload.id, [...links, X_POST]);

    expect(getPost).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    const after = await postingsOf(upload.id);
    expect(after.slice(0, 3).map(lastResult)).toEqual(before.map(lastResult));
    expect((await videoRow(upload.id)).ownership).toBe("verified_owner");
  });

  it("asks the platform again once the last check is over 30 seconds old, for a save and for Check again", async () => {
    const { d, upload, post, row } = await pastedOnUpload();
    await linkedLongAgo(d.account.id);
    const getPost = spyGetPost();
    const age = (ms: number) => async () =>
      backdateCheckedAt((await postingAt(upload.id, 1)).id, ms);
    const within = age(POSTING_CHECK_COOLDOWN_MS - 5_000);
    const past = age(POSTING_CHECK_COOLDOWN_MS + 5_000);

    await within();
    await saveOk(d.actor, upload.id, [demoPaste(post.permalink)]);
    expect(getPost).not.toHaveBeenCalled();
    await past();
    await saveOk(d.actor, upload.id, [demoPaste(post.permalink)]);
    expect(getPost).toHaveBeenCalledTimes(1);

    const saved = await postingAt(upload.id, 1);
    expect(saved.id).not.toBe(row.id);
    await within();
    const before = await postingRow(saved.id);
    await expect(
      recheckPosting(d.actor, { postingId: saved.id }),
    ).rejects.toBeInstanceOf(CheckedRecentlyError);
    expect(getPost).toHaveBeenCalledTimes(1);
    expect(await postingRow(saved.id)).toEqual(before);
    await past();
    expect(
      await recheckPosting(d.actor, { postingId: saved.id }),
    ).toMatchObject({ verification: "verified" });
    expect(getPost).toHaveBeenCalledTimes(2);
  });

  it("refuses Check again right after a save's check with CheckedRecentlyError, asking nothing and writing nothing", async () => {
    const { d, row } = await pastedOnUpload("01", {
      failWith: new SocialUpstreamError(),
    });
    const getPost = spyGetPost();

    await expect(
      recheckPosting(d.actor, { postingId: row.id }),
    ).rejects.toBeInstanceOf(CheckedRecentlyError);

    expect(getPost).not.toHaveBeenCalled();
    expect(await postingRow(row.id)).toEqual(row);
  });

  it("asks again once an account on the platform was linked since the check (Q-74 a), and that new check stands", async () => {
    const { creator, actor } = await bareCreator();
    const upload = await insertUploadVideo(creator);
    const elsewhere = await demoAccount();
    const link = demoPaste(mockLink(elsewhere.account, "02"));
    await saveOk(actor, upload.id, [link]);
    const row = await postingAt(upload.id, 1);
    expect(row.unverifiedReason).toBe("no_account");
    await extraDemoAccount(creator, new Date());
    const find = spyFind();

    await saveOk(actor, upload.id, [link]);

    expect(find).toHaveBeenCalledTimes(1);
    const checked = await postingAt(upload.id, 1);
    expect(checked.unverifiedReason).toBe("not_found");
    await expect(
      recheckPosting(actor, { postingId: checked.id }),
    ).rejects.toBeInstanceOf(CheckedRecentlyError);
    expect(find).toHaveBeenCalledTimes(1);
  });

  it("asks again once an account on the platform synced since the check (Sync and check again)", async () => {
    const { d, upload, post } = await syncedUpload("05");
    setMockScenarioForTests("post_removed");
    await saveOk(d.actor, upload.id, [demoPaste(post.permalink)]);
    const row = await postingAt(upload.id, 1);
    expect(row.unverifiedReason).toBe("not_found");
    setMockScenarioForTests(null);
    await expect(
      recheckPosting(d.actor, { postingId: row.id }),
    ).rejects.toBeInstanceOf(CheckedRecentlyError);
    // As a finished sync stamps it.
    await db
      .update(socialAccount)
      .set({ lastSyncedAt: new Date() })
      .where(eq(socialAccount.id, d.account.id));
    const getPost = spyGetPost();

    expect(await recheckPosting(d.actor, { postingId: row.id })).toMatchObject({
      verification: "verified",
    });
    expect(getPost).toHaveBeenCalledTimes(1);
  });
});

describe('saveVideoPostings: "Show buyers this link" follows the post (owner answer Q-86 a)', () => {
  const X2_LINK = "https://x.com/mayafilms/status/1790000000000000002";

  it("keeps a link saved hidden hidden when a re-save sends no Switch, verified or not", async () => {
    const { d, upload, post } = await syncedUpload();
    await saveOk(d.actor, upload.id, [
      vimeo(1, { showLink: false }),
      { ...FACEBOOK, showLink: false },
      demoPaste(post.permalink, { showLink: false }),
    ]);
    // The verified one is checked again too.
    await backdateCheckedAt((await postingAt(upload.id, 3)).id);
    const getPost = spyGetPost();

    await saveOk(d.actor, upload.id, [
      vimeo(1),
      FACEBOOK,
      demoPaste(post.permalink),
      X_POST,
    ]);

    expect(getPost).toHaveBeenCalledTimes(1);
    expect(
      (await postingsOf(upload.id)).map((p) => [
        p.platform,
        p.verification,
        p.showLink,
      ]),
    ).toEqual([
      ["other", "unverified", false],
      ["facebook", "unverified", false],
      ["mock", "verified", false],
      ["x", "unverified", true],
    ]);
  });

  it("hides a link saved shown but unverified once a re-save verifies it as an unlisted post, with no Switch sent (07 D18)", async () => {
    const { d, upload, post, row } = await pastedOnUpload("01", {
      failWith: new SocialUpstreamError(),
    });
    expect(row).toMatchObject({ verification: "unverified", showLink: true });
    await backdateCheckedAt(row.id);
    liveGetPost({ visibility: "unlisted" });

    await saveOk(d.actor, upload.id, [demoPaste(post.permalink)]);

    expect(await postingAt(upload.id, 1)).toMatchObject({
      verification: "verified",
      showLink: false,
    });
  });

  it("keeps each choice with its post when two links swap fields", async () => {
    const { creator, actor } = await bareCreator();
    const upload = await insertUploadVideo(creator);
    fetches.remember("x", X2_LINK);
    await saveOk(actor, upload.id, [
      { ...X_POST, showLink: false },
      { platform: "x", link: X2_LINK },
      vimeo(1, { showLink: false }),
      vimeo(2),
    ]);

    await saveOk(actor, upload.id, [
      { platform: "x", link: X2_LINK },
      X_POST,
      vimeo(2),
      vimeo(1),
    ]);

    expect(
      (await postingsOf(upload.id)).map((p) => [p.url, p.showLink]),
    ).toEqual([
      ["https://x.com/i/status/1790000000000000002", true],
      [X_URL, false],
      ["https://vimeo.com/2", true],
      ["https://vimeo.com/1", false],
    ]);
  });
});

describe("verifyPostingLink (07 D68)", () => {
  it("answers unverifiable and no_link from the link alone (any creator id), and gives a DB match's full result", async () => {
    expect(
      await verifyPostingLink(randomUUID(), {
        platform: "facebook",
        linkKey: FB_ID,
        url: FB_URL,
      }),
    ).toEqual(notVerified("unverifiable"));
    expect(
      await verifyPostingLink(randomUUID(), {
        platform: "other",
        linkKey: null,
        url: "https://vimeo.com/1",
      }),
    ).toEqual(notVerified("unverifiable"));
    expect(
      await verifyPostingLink(randomUUID(), {
        platform: "mock",
        linkKey: null,
        url: null,
      }),
    ).toEqual(notVerified("no_link"));

    const d = await syncedDemo();
    const post = await postNumber(d.account.id, "01");
    const getPost = spyGetPost();
    expect(
      await verifyPostingLink(d.account.creatorId, {
        platform: "mock",
        linkKey: post.linkKey,
        url: post.permalink,
      }),
    ).toStrictEqual({
      verification: "verified",
      socialAccountId: d.account.id,
      socialPostId: post.id,
      verifiedUsername: "@demo.creator",
      verifiedAccountLinkedAt: d.account.connectedAt,
      visibility: "public",
    });
    expect(getPost).toHaveBeenCalledTimes(1);
  });

  it("looks a post up on at most 3 connected accounts, newest connected_at first; the first find wins", async () => {
    const { creator } = await bareCreator();
    const now = Date.now();
    const accounts: SocialAccount[] = [];
    for (const hoursAgo of [4, 3, 2, 1]) {
      accounts.push(
        await extraDemoAccount(creator, new Date(now - hoursAgo * HOUR_MS)),
      );
    }
    const [oldest, third, second, newest] = accounts as [
      SocialAccount,
      SocialAccount,
      SocialAccount,
      SocialAccount,
    ];
    const find = spyFind();
    const triedAccounts = () =>
      find.mock.calls.map(([, , providerAccountId]) => providerAccountId);

    // The oldest account's post is past the cap.
    expect(await verifyPostingLink(creator.id, demoLink(oldest, "06"))).toEqual(
      notVerified("not_found"),
    );
    expect(triedAccounts()).toEqual(
      [newest, second, third].map((a) => a.providerAccountId),
    );

    find.mockClear();
    expect(
      await verifyPostingLink(creator.id, demoLink(second, "06")),
    ).toMatchObject({ verification: "verified", socialAccountId: second.id });
    expect(triedAccounts()).toEqual(
      [newest, second].map((a) => a.providerAccountId),
    );
    expect(await postsOf(second.id)).toMatchObject([
      { providerPostId: mockPostId(second, "06"), status: "available" },
    ]);
  });

  it("gives check_failed when one lookup account fails and no other finds the post", async () => {
    const { creator } = await bareCreator();
    await extraDemoAccount(creator, new Date(Date.now() - HOUR_MS));
    await extraDemoAccount(creator, new Date());
    const elsewhere = await demoAccount();
    const find = spyFind().mockRejectedValueOnce(new SocialUpstreamError());

    expect(
      await verifyPostingLink(creator.id, demoLink(elsewhere.account, "09")),
    ).toEqual(notVerified("check_failed"));
    expect(find).toHaveBeenCalledTimes(2);
  });

  it("gives check_failed, not not_found, when a connected account that can't verify (no name) was left out of the lookup", async () => {
    const { creator } = await bareCreator();
    const nameless = await extraDemoAccount(
      creator,
      new Date(Date.now() - HOUR_MS),
    );
    await db
      .update(socialAccount)
      .set({ username: null, displayName: null })
      .where(eq(socialAccount.id, nameless.id));
    const named = await extraDemoAccount(creator, new Date());
    const find = spyFind();

    // The post is the nameless account's, which only a reconnect can ask.
    expect(
      await verifyPostingLink(creator.id, demoLink(nameless, "06")),
    ).toEqual(notVerified("check_failed"));
    expect(
      find.mock.calls.map(([, , providerAccountId]) => providerAccountId),
    ).toEqual([named.providerAccountId]);
    expect(await postsOf(named.id)).toEqual([]);
  });

  it("counts a lookup answer for another link key as not found, and adds nothing to the Library", async () => {
    const d = await demoAccount();
    const realFind = mockProvider.findPostByLinkKey.bind(mockProvider);
    spyFind().mockImplementation(async (...args) => {
      const post = await realFind(...args);
      return post && { ...post, linkKey: "mock_post_00000000_99" };
    });

    expect(
      await verifyPostingLink(d.account.creatorId, demoLink(d.account, "04")),
    ).toEqual(notVerified("not_found"));
    expect(await postsOf(d.account.id)).toEqual([]);
  });

  it("throws NotPublicError for a private post found by lookup, before anything is written", async () => {
    const d = await demoAccount();
    liveGetPost({ visibility: "private" });

    await expect(
      verifyPostingLink(d.account.creatorId, demoLink(d.account, "04")),
    ).rejects.toBeInstanceOf(NotPublicError);
    expect(await postsOf(d.account.id)).toEqual([]);
  });

  it("asks nothing once its signal has aborted: a DB match or a lookup is check_failed and not reached, never not_found (Q-82 a)", async () => {
    const d = await syncedDemo();
    const post = await postNumber(d.account.id, "01");
    const elsewhere = await demoAccount();
    const getPost = spyGetPost();
    const find = spyFind();
    const opts = { signal: AbortSignal.abort() };

    for (const link of [
      { platform: "mock" as const, linkKey: post.linkKey, url: post.permalink },
      demoLink(elsewhere.account, "03"),
    ]) {
      expect(await verifyPostingLink(d.account.creatorId, link, opts)).toEqual({
        ...notVerified("check_failed"),
        notReached: true,
      });
    }
    expect(getPost).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
  });

  it("starts no token refresh that couldn't end before the deadline: not reached, nothing asked, the account still connected (Q-82 a)", async () => {
    const d = await syncedDemo();
    const post = await postNumber(d.account.id, "01");
    await db
      .update(socialAccount)
      .set({ accessTokenExpiresAt: new Date(Date.now() - HOUR_MS) })
      .where(eq(socialAccount.id, d.account.id));
    const getPost = spyGetPost();
    const refresh = vi.spyOn(mockProvider, "refreshToken");
    const link = {
      platform: "mock" as const,
      linkKey: post.linkKey,
      url: post.permalink,
    };

    expect(
      await verifyPostingLink(d.account.creatorId, link, {
        refreshBy: Date.now() + 1_000,
      }),
    ).toEqual({ ...notVerified("check_failed"), notReached: true });
    expect(refresh).not.toHaveBeenCalled();
    expect(getPost).not.toHaveBeenCalled();
    expect((await accountRow(d.account.id)).status).toBe("connected");

    // With time left, the refresh runs and the link verifies.
    expect(
      await verifyPostingLink(d.account.creatorId, link, {
        refreshBy: Date.now() + 60_000,
      }),
    ).toMatchObject({ verification: "verified" });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stops a lookup at the deadline: no call on the next account (Q-82 a)", async () => {
    const { creator } = await bareCreator();
    await extraDemoAccount(creator, new Date(Date.now() - HOUR_MS));
    await extraDemoAccount(creator, new Date());
    const elsewhere = await demoAccount();
    const deadline = new AbortController();
    const realFind = mockProvider.findPostByLinkKey.bind(mockProvider);
    const find = spyFind().mockImplementation(async (...args) => {
      const found = await realFind(...args);
      deadline.abort();
      return found;
    });

    expect(
      await verifyPostingLink(creator.id, demoLink(elsewhere.account, "09"), {
        signal: deadline.signal,
      }),
    ).toEqual(notVerified("check_failed"));
    expect(find).toHaveBeenCalledTimes(1);
  });
});

describe("recheckPosting (Check again)", () => {
  it("turns a check_failed row verified once the platform answers, and moves checked_at", async () => {
    const { d, upload, post, row } = await pastedOnUpload("01", {
      failWith: new SocialUpstreamError(),
    });
    expect(row).toMatchObject({
      verification: "unverified",
      unverifiedReason: "check_failed",
    });
    expect((await videoRow(upload.id)).ownership).toBe("self_attested");
    const checkedBefore = await backdateCheckedAt(row.id);
    await setSameVideoConfirmed(upload.id);
    const getPost = spyGetPost();

    const dto = await recheckPosting(d.actor, { postingId: row.id });

    expect(getPost).toHaveBeenCalledTimes(1);
    expect(dto).toMatchObject({
      id: row.id,
      position: 1,
      verification: "verified",
      unverifiedReason: null,
      verifiedUsername: "@demo.creator",
      accountStatus: "connected",
    });
    const after = await postingRow(row.id);
    expect(after).toMatchObject({
      verification: "verified",
      unverifiedReason: null,
      socialAccountId: d.account.id,
      socialPostId: post.id,
      verifiedUsername: "@demo.creator",
      verifiedAccountLinkedAt: d.account.connectedAt,
    });
    expect(after.verifiedAt).toBeInstanceOf(Date);
    expect(after.checkedAt?.getTime()).toBeGreaterThan(checkedBefore.getTime());
    const saved = await videoRow(upload.id);
    expect(saved.ownership).toBe("verified_owner");
    // The set of verified posts changed: the same-video tick is cleared (07 D69).
    expect(saved.sameVideoConfirmedAt).toBeNull();
  });

  it("hides the link of a row Check again verifies as an unlisted post, as a save would (07 D18)", async () => {
    const { d, row } = await pastedOnUpload("01", {
      failWith: new SocialUpstreamError(),
    });
    expect(row).toMatchObject({ verification: "unverified", showLink: true });
    await backdateCheckedAt(row.id);
    liveGetPost({ visibility: "unlisted" });

    await recheckPosting(d.actor, { postingId: row.id });

    expect(await postingRow(row.id)).toMatchObject({
      verification: "verified",
      showLink: false,
    });
  });

  it("audits other creators' unverified pastes when Check again verifies a row (video_posting.conflict)", async () => {
    const {
      d,
      post,
      row: mine,
    } = await pastedOnUpload("08", { failWith: new SocialRateLimitError(900) });
    const b = await bareCreator();
    const bUpload = await insertUploadVideo(b.creator);
    await saveOk(b.actor, bUpload.id, [demoPaste(post.permalink)]);
    const theirs = await postingAt(bUpload.id, 1);
    // Neither unverified paste is audited.
    expect(await conflictAuditsNaming([mine.id, theirs.id])).toEqual([]);
    await backdateCheckedAt(mine.id);

    await recheckPosting(d.actor, { postingId: mine.id });

    expect(await auditsOf(mine.id, "video_posting.conflict")).toEqual([
      {
        actorType: "creator",
        data: {
          videoPostingId: mine.id,
          platform: "mock",
          conflictingPostingIds: [theirs.id],
        },
      },
    ]);
    expect(await auditsOf(theirs.id, "video_posting.conflict")).toEqual([]);
    expect(await conflictAuditsNaming([mine.id, theirs.id])).toHaveLength(1);
    expect(await postingsOf(bUpload.id)).toEqual([theirs]);
  });

  it("turns released rows verified again (after admin Enable), the source posting included", async () => {
    const { d, post, videoId } = await libraryVideo("01");
    const post02 = await postNumber(d.account.id, "02");
    await saveOk(d.actor, videoId, [demoPaste(post02.permalink)]);
    const [source, extra] = (await postingsOf(videoId)) as [
      VideoPosting,
      VideoPosting,
    ];
    await releasePosting(source);
    await releasePosting(extra);
    expect((await videoRow(videoId)).ownership).toBe("self_attested");
    for (const row of [source, extra]) await backdateCheckedAt(row.id);

    for (const row of [source, extra]) {
      await setSameVideoConfirmed(videoId);
      expect(
        await recheckPosting(d.actor, { postingId: row.id }),
      ).toMatchObject({
        id: row.id,
        verification: "verified",
        unverifiedReason: null,
      });
      // The set of verified posts changed: the same-video tick is cleared (07 D69).
      expect(await confirmedAt(videoId)).toBeNull();
    }

    expect(await postingsOf(videoId)).toMatchObject([
      {
        position: 0,
        isSource: true,
        verification: "verified",
        socialPostId: post.id,
      },
      { position: 1, verification: "verified", socialPostId: post02.id },
    ]);
    expect((await videoRow(videoId)).ownership).toBe("verified_owner");
  });

  it("keeps a released row's audit ids when Check again doesn't verify it (post_removed)", async () => {
    const { d, upload, post, row } = await pastedOnUpload("05");
    await releasePosting(row);
    await backdateCheckedAt(row.id);
    setMockScenarioForTests("post_removed");

    expect(await recheckPosting(d.actor, { postingId: row.id })).toMatchObject({
      verification: "unverified",
      unverifiedReason: "not_found",
    });

    expect(await postingRow(row.id)).toMatchObject({
      verification: "unverified",
      unverifiedReason: "not_found",
      socialAccountId: d.account.id,
      socialPostId: post.id,
      verifiedUsername: row.verifiedUsername,
      verifiedAt: row.verifiedAt,
    });
    expect((await videoRow(upload.id)).ownership).toBe("self_attested");
  });

  it("refuses a released row whose post another creator verified meanwhile, with no call", async () => {
    const { d, post, row } = await pastedOnUpload();
    await releasePosting(row);
    const released = await postingRow(row.id);
    await insertVerifiedElsewhere(post.linkKey);
    const getPost = spyGetPost();

    const error = await recheckPosting(d.actor, { postingId: row.id }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AlreadyLicensableElsewhereError);
    // Check again names no input row (Q-78 a is the save's).
    expect(error).toMatchObject({ index: undefined });

    expect(getPost).not.toHaveBeenCalled();
    expect(await postingRow(row.id)).toEqual(released);
  });

  it("re-checks inside the transaction: a post verified elsewhere during the check refuses Check again on an unverified row, writing nothing", async () => {
    const { d, post, row } = await pastedOnUpload("01", {
      failWith: new SocialUpstreamError(),
    });
    expect(row).toMatchObject({
      verification: "unverified",
      unverifiedReason: "check_failed",
    });
    await backdateCheckedAt(row.id);
    const before = await postingRow(row.id);
    // The check fails again (check_failed): the row would stay unverified, so only the re-check can refuse it.
    const getPost = spyGetPost().mockImplementation(async () => {
      await insertVerifiedElsewhere(post.linkKey);
      throw new SocialUpstreamError();
    });

    await expect(
      recheckPosting(d.actor, { postingId: row.id }),
    ).rejects.toBeInstanceOf(AlreadyLicensableElsewhereError);

    expect(getPost).toHaveBeenCalledTimes(1);
    expect(await postingRow(row.id)).toEqual(before);
  });

  it("answers another creator's posting, an unknown id and a non-uuid as not found (VideoNotFoundError)", async () => {
    const owner = await bareCreator();
    const upload = await insertUploadVideo(owner.creator);
    await saveOk(owner.actor, upload.id, [FACEBOOK]);
    const row = await postingAt(upload.id, 1);
    const other = await bareCreator();

    for (const [actor, postingId] of [
      [other.actor, row.id],
      [owner.actor, randomUUID()],
      [owner.actor, "not-a-uuid"],
    ] as const) {
      await expect(recheckPosting(actor, { postingId })).rejects.toBeInstanceOf(
        VideoNotFoundError,
      );
    }
    expect(await postingRow(row.id)).toEqual(row);
  });

  it("refuses Check again on a locked video (PostingsLockedError), with no call", async () => {
    const d = await demoAccount();
    const upload = await insertUploadVideo({ id: d.account.creatorId });
    const posting = await insertVideoPosting(upload, {
      platform: "mock",
      url: mockLink(d.account, "01"),
      linkKey: mockPostId(d.account, "01"),
      unverifiedReason: "check_failed",
    });
    await publishVideo(upload);
    const getPost = spyGetPost();

    await expect(
      recheckPosting(d.actor, { postingId: posting.id }),
    ).rejects.toBeInstanceOf(PostingsLockedError);

    expect(getPost).not.toHaveBeenCalled();
    expect(await postingRow(posting.id)).toEqual(posting);
  });

  it("returns an unverifiable or link-less row unchanged, with no call", async () => {
    const d = await demoAccount();
    const upload = await insertUploadVideo({ id: d.account.creatorId });
    await saveOk(d.actor, upload.id, [FACEBOOK, { platform: "tiktok" }]);
    const rows = await postingsOf(upload.id);
    const listed = await listVideoPostings(d.actor, upload.id);
    const getPost = spyGetPost();
    const find = spyFind();

    for (const [i, row] of rows.entries()) {
      expect(await recheckPosting(d.actor, { postingId: row.id })).toEqual(
        listed[i],
      );
    }

    expect(getPost).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    expect(await postingsOf(upload.id)).toEqual(rows);
  });

  it("keeps a verified row verified when Check again's call fails (Q-69 a): only checked_at moves", async () => {
    const { d, upload, row: before } = await pastedOnUpload();
    const checkedBefore = await backdateCheckedAt(before.id);
    const tick = await setSameVideoConfirmed(upload.id);
    const getPost = spyGetPost().mockRejectedValue(new SocialUpstreamError());

    expect(
      await recheckPosting(d.actor, { postingId: before.id }),
    ).toMatchObject({ verification: "verified", unverifiedReason: null });

    expect(getPost).toHaveBeenCalledTimes(1);
    const after = await postingRow(before.id);
    expect(verifiedFields(after)).toEqual(verifiedFields(before));
    expect(after.checkedAt?.getTime()).toBeGreaterThan(checkedBefore.getTime());
    const saved = await videoRow(upload.id);
    expect(saved.ownership).toBe("verified_owner");
    expect(saved.sameVideoConfirmedAt).toEqual(tick);
  });

  it("keeps a verified row verified when Check again finds its account disconnected (Q-70 a): no call, checked_at kept", async () => {
    const { d, upload, row: before } = await pastedOnUpload();
    const checkedBefore = await backdateCheckedAt(before.id);
    await disconnectSocialAccount(d.account.id, d.actor);
    const getPost = spyGetPost();

    expect(
      await recheckPosting(d.actor, { postingId: before.id }),
    ).toMatchObject({
      verification: "verified",
      accountStatus: "disconnected",
      checkedAt: checkedBefore.toISOString(),
    });

    expect(getPost).not.toHaveBeenCalled();
    const after = await postingRow(before.id);
    expect(verifiedFields(after)).toEqual(verifiedFields(before));
    // No check ran, so none is recorded.
    expect(after.checkedAt).toEqual(checkedBefore);
    expect((await videoRow(upload.id)).ownership).toBe("verified_owner");
  });

  it("keeps the verified source posting verified when Check again finds its account disconnected, with another account connected (Q-70 a)", async () => {
    const { d, videoId } = await libraryVideo("01");
    const [source] = (await postingsOf(videoId)) as [VideoPosting];
    expect(source).toMatchObject({ isSource: true, verification: "verified" });
    const checkedBefore = await backdateCheckedAt(source.id);
    const tick = await setSameVideoConfirmed(videoId);
    // The other account can't see this post: its lookup would answer not_found, which is no answer here.
    await extraDemoAccount({ id: d.account.creatorId }, new Date());
    await disconnectSocialAccount(d.account.id, d.actor);
    const getPost = spyGetPost();
    const find = spyFind();

    expect(
      await recheckPosting(d.actor, { postingId: source.id }),
    ).toMatchObject({
      id: source.id,
      isSource: true,
      verification: "verified",
      accountStatus: "disconnected",
    });

    expect(getPost).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    const after = await postingRow(source.id);
    expect(verifiedFields(after)).toEqual(verifiedFields(source));
    expect(after.checkedAt).toEqual(checkedBefore);
    const saved = await videoRow(videoId);
    expect(saved.ownership).toBe("verified_owner");
    expect(saved.sameVideoConfirmedAt).toEqual(tick);
  });
});

describe("confirmSameVideo: the tick on Where posted (02 §5.6; 07 D69)", () => {
  it("lets an upload with a verified link confirm once its original is ready; confirming again keeps the first time", async () => {
    const { d, upload } = await pastedOnUpload();
    expect((await videoRow(upload.id)).ownership).toBe("verified_owner");
    await markOriginalReady(upload);

    await confirmSameVideo(d.actor, upload.id);
    const first = await confirmedAt(upload.id);
    expect(first).toBeInstanceOf(Date);

    await confirmSameVideo(d.actor, upload.id);
    expect(await confirmedAt(upload.id)).toEqual(first);
  });

  it("refuses a video with no verified posting (NoVerifiedPostingError), any source, and stores nothing", async () => {
    const { creator, actor } = await bareCreator();
    const bare = await insertUploadVideo(creator);
    const unverified = await insertUploadVideo(creator);
    await saveOk(actor, unverified.id, [FACEBOOK, vimeo(31)]);
    // A Library video whose source posting an admin Disable released (07 D66).
    const { d, videoId } = await libraryVideo();
    const [source] = await postingsOf(videoId);
    if (!source) throw new Error("no source posting");
    await releasePosting(source);
    const library = await videoRow(videoId);
    for (const v of [bare, unverified, library]) await markOriginalReady(v);

    for (const [who, id] of [
      [actor, bare.id],
      [actor, unverified.id],
      [d.actor, library.id],
    ] as const) {
      await expect(confirmSameVideo(who, id)).rejects.toBeInstanceOf(
        NoVerifiedPostingError,
      );
      expect(await confirmedAt(id)).toBeNull();
    }
  });

  it("refuses before the original is ready (OriginalNotReadyError) and stores nothing", async () => {
    const { d, upload } = await pastedOnUpload();

    await expect(confirmSameVideo(d.actor, upload.id)).rejects.toBeInstanceOf(
      OriginalNotReadyError,
    );
    expect(await confirmedAt(upload.id)).toBeNull();
  });

  it("answers another creator's video, an unknown id and a non-uuid as not found", async () => {
    const { d, upload } = await pastedOnUpload();
    await markOriginalReady(upload);
    const other = await bareCreator();

    for (const [actor, id] of [
      [other.actor, upload.id],
      [d.actor, randomUUID()],
      [d.actor, "not-a-uuid"],
    ] as const) {
      await expect(confirmSameVideo(actor, id)).rejects.toBeInstanceOf(
        VideoNotFoundError,
      );
    }
    expect(await confirmedAt(upload.id)).toBeNull();
  });

  it("refuses a video that isn't draft or unpublished (PostingsLockedError) first, confirming or withdrawing", async () => {
    const { d, upload } = await pastedOnUpload();
    await markOriginalReady(upload);
    await confirmSameVideo(d.actor, upload.id);
    const tick = await confirmedAt(upload.id);
    await publishVideo(upload);
    // No verified posting either: the locked status still answers first.
    const bare = await publishVideo(
      await insertUploadVideo({ id: d.account.creatorId }),
    );

    for (const id of [upload.id, bare.id]) {
      await expect(confirmSameVideo(d.actor, id)).rejects.toBeInstanceOf(
        PostingsLockedError,
      );
      await expect(withdrawSameVideo(d.actor, id)).rejects.toBeInstanceOf(
        PostingsLockedError,
      );
    }
    expect(await confirmedAt(upload.id)).toEqual(tick);
    expect(await confirmedAt(bare.id)).toBeNull();
  });

  it("takes the tick back with withdrawSameVideo (owner answer Q-83 a); on a clear tick it writes nothing", async () => {
    const { d, upload } = await pastedOnUpload();
    await markOriginalReady(upload);
    await confirmSameVideo(d.actor, upload.id);
    expect(await confirmedAt(upload.id)).toBeInstanceOf(Date);

    await withdrawSameVideo(d.actor, upload.id);
    expect(await confirmedAt(upload.id)).toBeNull();
    const cleared = await videoRow(upload.id);
    await withdrawSameVideo(d.actor, upload.id);
    expect(await videoRow(upload.id)).toEqual(cleared);

    const unpublished = await insertUploadVideo(
      { id: d.account.creatorId },
      { status: "unpublished" },
    );
    await setSameVideoConfirmed(unpublished.id);
    await withdrawSameVideo(d.actor, unpublished.id);
    expect(await confirmedAt(unpublished.id)).toBeNull();
  });

  it("withdrawSameVideo answers another creator's video, an unknown id and a non-uuid as not found", async () => {
    const { d, upload } = await pastedOnUpload();
    const tick = await setSameVideoConfirmed(upload.id);
    const other = await bareCreator();

    for (const [actor, id] of [
      [other.actor, upload.id],
      [d.actor, randomUUID()],
      [d.actor, "not-a-uuid"],
    ] as const) {
      await expect(withdrawSameVideo(actor, id)).rejects.toBeInstanceOf(
        VideoNotFoundError,
      );
    }
    expect(await confirmedAt(upload.id)).toEqual(tick);
  });
});

describe("listVideoPostings (the owner's DTOs)", () => {
  it("lists every posting by position with labels, account status, and thumbnails on verified rows only; admins too", async () => {
    const { d, post, videoId } = await libraryVideo("01");
    const post02 = await postNumber(d.account.id, "02");
    await saveOk(d.actor, videoId, [
      demoPaste(post02.permalink),
      FACEBOOK,
      vimeo(123, { otherLabel: "  Vimeo  " }),
      { platform: "tiktok" },
    ]);
    const rows = (await postingsOf(videoId)) as [
      VideoPosting,
      VideoPosting,
      VideoPosting,
      VideoPosting,
      VideoPosting,
    ];
    const thumbnail = (p: SocialPostRow) =>
      expect.stringMatching(
        new RegExp(`^/api/library/thumbnails/${p.id}(\\?v=.+)?$`),
      );
    const verifiedRow = (
      row: VideoPosting,
      p: SocialPostRow,
      isSource: boolean,
    ) => ({
      id: row.id,
      platform: "mock",
      label: "Demo",
      url: p.permalink,
      isSource,
      verification: "verified",
      unverifiedReason: null,
      verifiedUsername: "@demo.creator",
      accountStatus: "connected",
      thumbnailSrc: thumbnail(p),
      durationSec: p.durationSec,
      visibility: "public",
      showLink: true,
      checkedAt: row.checkedAt?.toISOString() ?? null,
      position: row.position,
    });
    const unverifiedRow = (
      row: VideoPosting,
      fields: { label: string; url: string | null; reason: string },
    ) => ({
      id: row.id,
      platform: row.platform,
      label: fields.label,
      url: fields.url,
      isSource: false,
      verification: "unverified",
      unverifiedReason: fields.reason,
      verifiedUsername: null,
      accountStatus: null,
      thumbnailSrc: null,
      durationSec: null,
      visibility: null,
      showLink: true,
      checkedAt: null,
      position: row.position,
    });
    const expected = [
      verifiedRow(rows[0], post, true),
      verifiedRow(rows[1], post02, false),
      unverifiedRow(rows[2], {
        label: "Facebook",
        url: FB_URL,
        reason: "unverifiable",
      }),
      unverifiedRow(rows[3], {
        label: "Vimeo",
        url: "https://vimeo.com/123",
        reason: "unverifiable",
      }),
      unverifiedRow(rows[4], { label: "TikTok", url: null, reason: "no_link" }),
    ];

    expect(await listVideoPostings(d.actor, videoId)).toStrictEqual(expected);
    expect(await listVideoPostings(adminActor(), videoId)).toStrictEqual(
      expected,
    );
  });

  it("gives a verified row its post's visibility (an unlisted post's D18 note) and an unverified row none; Check again too", async () => {
    const { d, upload, post } = await syncedUpload();
    liveGetPost({ visibility: "unlisted" });

    await saveOk(d.actor, upload.id, [demoPaste(post.permalink), FACEBOOK]);

    const dtos = await listVideoPostings(d.actor, upload.id);
    expect(dtos).toMatchObject([
      {
        platform: "mock",
        verification: "verified",
        visibility: "unlisted",
        showLink: false,
      },
      {
        platform: "facebook",
        verification: "unverified",
        visibility: null,
        showLink: true,
      },
    ]);
    const [verified] = dtos;
    if (!verified) throw new Error("no verified posting");
    await backdateCheckedAt(verified.id);
    expect(
      await recheckPosting(d.actor, { postingId: verified.id }),
    ).toMatchObject({ verification: "verified", visibility: "unlisted" });
  });

  it("answers another creator and an unknown video as not found (VideoNotFoundError)", async () => {
    const { videoId } = await libraryVideo();
    const other = await bareCreator();

    await expect(
      listVideoPostings(other.actor, videoId),
    ).rejects.toBeInstanceOf(VideoNotFoundError);
    await expect(
      listVideoPostings(adminActor(), randomUUID()),
    ).rejects.toBeInstanceOf(VideoNotFoundError);
  });
});

describe("getPublicPostings (the buyer's DTOs, 07 D70)", () => {
  it("puts verified postings first, then the rest, by position; the source is primary; links follow show_link and removal", async () => {
    const { d, post, videoId } = await libraryVideo("01");
    const post02 = await postNumber(d.account.id, "02");
    const post03 = await postNumber(d.account.id, "03");
    await saveOk(d.actor, videoId, [
      FACEBOOK,
      demoPaste(post02.permalink, { showLink: false }),
      {
        platform: "other",
        otherLabel: "Vimeo",
        link: "https://www.vimeo.com/1",
      },
      { platform: "tiktok" },
      demoPaste(post03.permalink),
    ]);
    await removePost(post03.id);
    await publishVideo(await videoRow(videoId));

    const verified = (url: string | null) => ({
      platform: "mock",
      label: "Demo",
      verified: true,
      verifiedUsername: "@demo.creator",
      linkedAt: d.account.connectedAt.toISOString(),
      noLongerLinked: false,
      url,
      hostLabel: null,
    });
    const unverified = (
      platform: string,
      label: string,
      url: string | null,
      hostLabel: string | null = null,
    ) => ({
      platform,
      label,
      verified: false,
      verifiedUsername: null,
      linkedAt: null,
      noLongerLinked: false,
      url,
      hostLabel,
    });
    const result = await getPublicPostings(videoId);
    expect(result).toStrictEqual({
      primary: verified(post.permalink),
      postings: [
        verified(post.permalink),
        verified(null), // show_link off
        verified(null), // the post is removed
        unverified("facebook", "Facebook", FB_URL),
        unverified("other", "Vimeo", "https://www.vimeo.com/1", "vimeo.com"),
        unverified("tiktok", "TikTok", null),
      ],
    });
    const json = JSON.stringify(result);
    const postingIds = (await postingsOf(videoId)).map((p) => p.id);
    for (const hidden of [
      d.account.id,
      d.account.providerAccountId,
      d.account.creatorId,
      post.id,
      post02.id,
      post03.id,
      ...postingIds,
    ]) {
      expect(json).not.toContain(hidden);
    }
  });

  it("makes the lowest-position verified posting primary on an upload, and gives no primary without one", async () => {
    const { d, upload, post: post02 } = await syncedUpload("02");
    const post03 = await postNumber(d.account.id, "03");
    await saveOk(d.actor, upload.id, [
      FACEBOOK,
      demoPaste(post02.permalink),
      demoPaste(post03.permalink),
    ]);
    await publishVideo(upload);

    const { primary, postings } = await getPublicPostings(upload.id);
    expect(primary).toMatchObject({ verified: true, url: post02.permalink });
    expect(postings.map((p) => [p.platform, p.verified, p.url])).toEqual([
      ["mock", true, post02.permalink],
      ["mock", true, post03.permalink],
      ["facebook", false, FB_URL],
    ]);

    const unverifiedOnly = await insertUploadVideo({
      id: d.account.creatorId,
    });
    await saveOk(d.actor, unverifiedOnly.id, [FACEBOOK]);
    await publishVideo(unverifiedOnly);
    expect(await getPublicPostings(unverifiedOnly.id)).toMatchObject({
      primary: null,
      postings: [{ platform: "facebook", verified: false, url: FB_URL }],
    });
  });

  it("marks a verified posting noLongerLinked after Disconnect; it stays verified with its link", async () => {
    const { d, upload, post } = await pastedOnUpload();
    await publishVideo(upload);

    await disconnectSocialAccount(d.account.id, d.actor);

    const shown = {
      platform: "mock",
      label: "Demo",
      verified: true,
      verifiedUsername: "@demo.creator",
      linkedAt: d.account.connectedAt.toISOString(),
      noLongerLinked: true,
      url: post.permalink,
      hostLabel: null,
    };
    expect(await getPublicPostings(upload.id)).toStrictEqual({
      primary: shown,
      postings: [shown],
    });
  });

  it("gives nothing for a draft, an unpublished or a disabled video, or an unknown id", async () => {
    const { creator, actor } = await bareCreator();
    const draft = await insertUploadVideo(creator);
    const unpublished = await insertUploadVideo(creator, {
      status: "unpublished",
    });
    for (const v of [draft, unpublished]) {
      await saveOk(actor, v.id, [FACEBOOK]);
    }
    const disabled = await insertUploadVideo(creator, {
      status: "disabled",
      disabledAt: new Date(),
      disabledReason: "other",
    });
    await insertVideoPosting(disabled, {
      platform: "facebook",
      url: FB_URL,
      linkKey: FB_ID,
      unverifiedReason: "unverifiable",
    });

    for (const id of [draft.id, unpublished.id, disabled.id, randomUUID()]) {
      expect(await getPublicPostings(id)).toEqual({
        primary: null,
        postings: [],
      });
    }
  });
});
