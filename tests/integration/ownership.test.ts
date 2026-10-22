import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { db } from "../../src/db/client";
import { socialAccount, socialPost } from "../../src/db/schema";
import {
  AlreadyLicensableElsewhereError,
  NotPublicError,
} from "../../src/server/postings/errors";
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
import { confirmSameVideo } from "../../src/server/videos/edit";
import {
  makeLicensableErrorCode,
  NeedsReconnectError,
  NotFromLibraryError,
  NotOnAccountError,
  OriginalNotReadyError,
  PostNotFoundError,
  VideoNotFoundError,
} from "../../src/server/videos/errors";
import { getVideoForCreator } from "../../src/server/videos/queries";
import { mockNextHeaders, signedInCreator } from "../helpers/auth";
import { accountRow, auditsOf, postNumber } from "../helpers/connect-flow";
import { resetDb } from "../helpers/db";
import {
  insertCreator,
  insertUploadVideo,
  insertVideoPosting,
  markOriginalReady,
  videoRow,
} from "../helpers/factories";
import { syncedDemo } from "../helpers/library";
import {
  confirmedAt,
  expectNothingWritten,
  libraryDraft,
  liveGetPost,
  postingsOn,
  spyGetPost,
  twoCreatorsOnOneAccount,
  videosOf,
} from "../helpers/library-videos";
import { captureLogEvents } from "../helpers/logs";
import { postingRow, SNOW_TITLE } from "../helpers/postings";

// Making a Library post licensable (P11; 02 §5.6, §7.7; 06 §4; 07 D12 b, D18, D36, D39, D43, D65, D66, D68, D72) against
// the test database and the mock provider. The live check is counted on the raw adapter (mockProvider): the registry
// hands out a wrapper that cleans its reads and calls the adapter's getPost at each call, as P07's suites rely on.
vi.mock("next/headers", () => import("../helpers/next-headers"));

afterAll(resetDb);
beforeEach(() => mockNextHeaders(null));
afterEach(() => {
  vi.restoreAllMocks();
  setMockScenarioForTests(null);
});

/** A synced Demo creator and its post `nn`. */
async function demoPost(nn = "01") {
  const d = await syncedDemo();
  return { d, post: await postNumber(d.account.id, nn) };
}

describe("createVideoFromPost: the draft and its source posting", () => {
  it("checks the post live once, then writes one verified_owner draft and one source posting with every field", async () => {
    const { d, post } = await demoPost();
    const getPost = spyGetPost();

    const { videoId } = await createVideoFromPost(d.actor, post.id);

    expect(getPost).toHaveBeenCalledTimes(1);
    expect(getPost).toHaveBeenCalledWith(
      expect.any(String),
      post.providerPostId,
      d.account.providerAccountId,
    );
    const [row, ...others] = await videosOf(d.account.creatorId);
    expect(others).toEqual([]);
    expect(row).toMatchObject({
      id: videoId,
      title: SNOW_TITLE,
      slug: "he-saw-snow-for-the-first-time-and-lost-it",
      source: "library",
      ownership: "verified_owner",
      status: "draft",
      originalStatus: "none",
      postingsConfirmedAt: null,
      sameVideoConfirmedAt: null,
      originalObjectKey: null,
      posterObjectKey: null,
    });

    const postings = await postingsOn(post.id);
    expect(postings).toHaveLength(1);
    const [posting] = postings;
    expect(posting).toMatchObject({
      videoId,
      creatorId: d.account.creatorId,
      isSource: true,
      position: 0,
      platform: "mock",
      verification: "verified",
      unverifiedReason: null,
      otherLabel: null,
      linkKey: post.linkKey,
      url: `https://example.com/mock/${post.providerPostId}`,
      socialPostId: post.id,
      socialAccountId: d.account.id,
      verifiedUsername: "@demo.creator",
      verifiedAccountLinkedAt: d.account.connectedAt,
      showLink: true,
    });
    expect(posting?.url).toBe(post.permalink);
    expect(posting?.verifiedAt).toBeInstanceOf(Date);
    expect(posting?.checkedAt).toEqual(posting?.verifiedAt);

    expect(await auditsOf(videoId, "video.created")).toEqual([
      { actorType: "creator", data: { socialPostId: post.id } },
    ]);
  });

  it("opens the same video on a second press: no second live check, still one video and one posting", async () => {
    const { d, post } = await demoPost();
    const first = await createVideoFromPost(d.actor, post.id);
    const getPost = spyGetPost();

    expect(await createVideoFromPost(d.actor, post.id)).toEqual(first);
    expect(getPost).not.toHaveBeenCalled();
    expect(await videosOf(d.account.creatorId)).toHaveLength(1);
    expect(await postingsOn(post.id)).toHaveLength(1);
    expect(await auditsOf(first.videoId, "video.created")).toHaveLength(1);
  });

  it("gives a double tap one video: the press that loses video_posting_verified_uidx returns the winner's id", async () => {
    const { d, post } = await demoPost();
    // Both presses pass the idempotency lookup and wait at the live check, so both reach the insert.
    const realGet = mockProvider.getPost.bind(mockProvider);
    let arrived = 0;
    let release = () => {};
    const bothChecking = new Promise<void>((resolve) => {
      release = resolve;
    });
    const getPost = spyGetPost().mockImplementation(async (...args) => {
      arrived += 1;
      if (arrived === 2) release();
      await bothChecking;
      return realGet(...args);
    });

    const [a, b] = await Promise.all([
      createVideoFromPost(d.actor, post.id),
      createVideoFromPost(d.actor, post.id),
    ]);

    expect(getPost).toHaveBeenCalledTimes(2);
    expect(b).toEqual(a);
    const videos = await videosOf(d.account.creatorId);
    expect(videos.map((v) => v.id)).toEqual([a.videoId]);
    expect(await postingsOn(post.id)).toHaveLength(1);
    expect(await auditsOf(a.videoId, "video.created")).toHaveLength(1);
  });

  it("titles a post with no words left after hashtags and emoji from its platform and date (01 J5.12)", async () => {
    const { d, post } = await demoPost("02");
    await db
      .update(socialPost)
      .set({ caption: "🌊🌅 #surf #sunrise" })
      .where(eq(socialPost.id, post.id));

    const { videoId } = await createVideoFromPost(d.actor, post.id);

    const [row] = await videosOf(d.account.creatorId);
    expect(row).toMatchObject({
      id: videoId,
      title: "Demo video · 24 Sep 2026",
      slug: "demo-video-24-sep-2026",
    });
  });

  it("hides the link of a post cached as unlisted (07 D18 per posting)", async () => {
    const { d, post } = await demoPost();
    await db
      .update(socialPost)
      .set({ visibility: "unlisted" })
      .where(eq(socialPost.id, post.id));

    await createVideoFromPost(d.actor, post.id);

    const [posting] = await postingsOn(post.id);
    expect(posting).toMatchObject({
      verification: "verified",
      showLink: false,
    });
  });

  it("hides the link of a post the live check finds unlisted, though cached as public", async () => {
    const { d, post } = await demoPost();
    liveGetPost({ visibility: "unlisted" });

    await createVideoFromPost(d.actor, post.id);

    const [posting] = await postingsOn(post.id);
    expect(posting).toMatchObject({
      verification: "verified",
      showLink: false,
    });
  });

  it("audits another creator's unverified paste of the post by id once it verifies here (video_posting.conflict, 07 D68)", async () => {
    const { d, post } = await demoPost("07");
    const pasted = {
      platform: "mock",
      url: post.permalink,
      linkKey: post.linkKey,
      unverifiedReason: "no_account",
    } as const;
    const other = await insertCreator();
    const theirs = await insertVideoPosting(
      await insertUploadVideo(other),
      pasted,
    );
    // The creator's own unverified paste on an upload is no conflict.
    await insertVideoPosting(
      await insertUploadVideo({ id: d.account.creatorId }),
      pasted,
    );

    const { videoId } = await createVideoFromPost(d.actor, post.id);

    const [source] = await postingsOn(post.id);
    expect(source).toMatchObject({ videoId, verification: "verified" });
    expect(await auditsOf(source?.id ?? "", "video_posting.conflict")).toEqual([
      {
        actorType: "creator",
        data: {
          videoPostingId: source?.id,
          platform: "mock",
          conflictingPostingIds: [theirs.id],
        },
      },
    ]);
    // Nothing else changes: their paste stays as it was, and the new video is verified_owner.
    expect(await postingRow(theirs.id)).toEqual(theirs);
    expect((await videoRow(videoId)).ownership).toBe("verified_owner");
  });
});

describe("createVideoFromPost: refusals write nothing", () => {
  it("refuses a post the live check finds private (NotPublicError, 07 D18)", async () => {
    const { d, post } = await demoPost();
    const getPost = liveGetPost({ visibility: "private" });

    await expect(createVideoFromPost(d.actor, post.id)).rejects.toBeInstanceOf(
      NotPublicError,
    );
    expect(getPost).toHaveBeenCalledTimes(1);
    await expectNothingWritten(d.account.creatorId, post.id);
  });

  it("refuses a needs_reconnect account before any platform call (NeedsReconnectError)", async () => {
    const { d, post } = await demoPost();
    await db
      .update(socialAccount)
      .set({ status: "needs_reconnect" })
      .where(eq(socialAccount.id, d.account.id));
    const getPost = spyGetPost();

    await expect(createVideoFromPost(d.actor, post.id)).rejects.toBeInstanceOf(
      NeedsReconnectError,
    );
    expect(getPost).not.toHaveBeenCalled();
    await expectNothingWritten(d.account.creatorId, post.id);
  });

  it("refuses an account with neither a handle nor a name before any platform call (NeedsReconnectError)", async () => {
    const { d, post } = await demoPost();
    await db
      .update(socialAccount)
      .set({ username: null, displayName: null })
      .where(eq(socialAccount.id, d.account.id));
    const getPost = spyGetPost();

    await expect(createVideoFromPost(d.actor, post.id)).rejects.toBeInstanceOf(
      NeedsReconnectError,
    );
    expect(getPost).not.toHaveBeenCalled();
    await expectNothingWritten(d.account.creatorId, post.id);
  });

  it("turns a refused token into NeedsReconnectError and marks the account (07 D12 b)", async () => {
    const { d, post } = await demoPost();
    const getPost = spyGetPost().mockRejectedValue(new SocialAuthError());

    await expect(createVideoFromPost(d.actor, post.id)).rejects.toBeInstanceOf(
      NeedsReconnectError,
    );
    // No refresh happened meanwhile, so withAccessToken doesn't retry.
    expect(getPost).toHaveBeenCalledTimes(1);
    expect((await accountRow(d.account.id)).status).toBe("needs_reconnect");
    expect(
      await auditsOf(d.account.id, "social_account.needs_reconnect"),
    ).toHaveLength(1);
    await expectNothingWritten(d.account.creatorId, post.id);
  });

  it.each([
    ["a platform failure", new SocialUpstreamError()],
    ["a rate limit", new SocialRateLimitError(900)],
  ])(
    "lets %s out as it is: the generic retry, the account still connected",
    async (_, failure) => {
      const { d, post } = await demoPost();
      spyGetPost().mockRejectedValue(failure);

      const error = await createVideoFromPost(d.actor, post.id).catch(
        (e: unknown) => e,
      );
      expect(error).toBe(failure);
      expect(makeLicensableErrorCode(error)).toBe("upstream");
      expect((await accountRow(d.account.id)).status).toBe("connected");
      await expectNothingWritten(d.account.creatorId, post.id);
    },
  );

  it("refuses post 05 once the platform no longer has it (post_removed: NotOnAccountError)", async () => {
    const { d, post } = await demoPost("05");
    setMockScenarioForTests("post_removed");
    const getPost = spyGetPost();

    await expect(createVideoFromPost(d.actor, post.id)).rejects.toBeInstanceOf(
      NotOnAccountError,
    );
    expect(getPost).toHaveBeenCalledTimes(1);
    await expectNothingWritten(d.account.creatorId, post.id);
  });

  it.each([
    { kind: "another post's link", reason: "link_key_mismatch", other: "02" },
    { kind: "not a link", reason: "not_a_url", other: null },
  ])(
    "refuses a synced permalink that is $kind before any platform call: nothing written, ids only in the log",
    async ({ reason, other }) => {
      const { d, post } = await demoPost();
      const permalink =
        other === null
          ? "not a link"
          : (await postNumber(d.account.id, other)).permalink;
      await db
        .update(socialPost)
        .set({ permalink })
        .where(eq(socialPost.id, post.id));
      const getPost = spyGetPost();
      const logged = captureLogEvents("videos.source_link_invalid");

      const error = await createVideoFromPost(d.actor, post.id).catch(
        (e: unknown) => e,
      );

      const { written, events } = logged();
      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({ message: "source_link_invalid" });
      expect(getPost).not.toHaveBeenCalled();
      await expectNothingWritten(d.account.creatorId, post.id);
      expect(events).toMatchObject([
        {
          level: "error",
          event: "videos.source_link_invalid",
          socialPostId: post.id,
          platform: "mock",
          reason,
        },
      ]);
      expect(written).not.toContain("https://");
      expect(written).not.toContain(permalink);
      expect(written).not.toContain(post.permalink);
    },
  );

  it("answers another creator's post, an unknown id, a non-uuid and a removed post as not found, with no platform call", async () => {
    const { d, post } = await demoPost();
    const other = await syncedDemo();
    const removed = await postNumber(d.account.id, "03");
    await db
      .update(socialPost)
      .set({ status: "removed", removedAt: new Date() })
      .where(eq(socialPost.id, removed.id));
    const getPost = spyGetPost();

    for (const [actor, id] of [
      [other.actor, post.id],
      [d.actor, randomUUID()],
      [d.actor, "not-a-uuid"],
      [d.actor, ""],
      [d.actor, removed.id],
    ] as const) {
      await expect(createVideoFromPost(actor, id)).rejects.toBeInstanceOf(
        PostNotFoundError,
      );
    }
    expect(getPost).not.toHaveBeenCalled();
    await expectNothingWritten(other.account.creatorId, post.id);
    expect(await videosOf(d.account.creatorId)).toEqual([]);
  });

  it("refuses a post another creator already made licensable: two creators on one Demo account (shared_account)", async () => {
    const {
      a,
      aPost,
      made: { videoId },
      b,
      bAccount,
      bPost,
    } = await twoCreatorsOnOneAccount((creator, id) =>
      createVideoFromPost(creator.actor, id),
    );

    // B linked the same platform account (mock_acct_shared), synced, and tries the same post 01.
    expect(bAccount).toMatchObject({
      providerAccountId: "mock_acct_shared",
      status: "connected",
    });
    expect(bPost.id).not.toBe(aPost.id);
    expect(bPost.linkKey).toBe(aPost.linkKey);

    const error = await createVideoFromPost(b.actor, bPost.id).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AlreadyLicensableElsewhereError);
    expect(makeLicensableErrorCode(error)).toBe("already_licensable_elsewhere");
    await expectNothingWritten(b.creatorId, bPost.id);
    // A's video and its verified posting are untouched.
    expect((await videosOf(a.creatorId)).map((v) => v.id)).toEqual([videoId]);
    expect(await postingsOn(aPost.id)).toMatchObject([
      { videoId, verification: "verified" },
    ]);
  });
});

describe("confirmSameVideo (07 D39; P11c moves it to Where posted)", () => {
  it("sets same_video_confirmed_at once the original is ready; confirming again keeps the first time", async () => {
    const me = await signedInCreator();
    const draft = await libraryDraft(me);

    await confirmSameVideo(me.actor, draft.id);
    const first = await confirmedAt(draft.id);
    expect(first).toBeInstanceOf(Date);

    await confirmSameVideo(me.actor, draft.id);
    expect(await confirmedAt(draft.id)).toEqual(first);
  });

  it("refuses before the original is ready (OriginalNotReadyError) and stores nothing", async () => {
    const me = await signedInCreator();
    const draft = await libraryDraft(me, { ready: false });

    await expect(confirmSameVideo(me.actor, draft.id)).rejects.toBeInstanceOf(
      OriginalNotReadyError,
    );
    expect(await confirmedAt(draft.id)).toBeNull();
  });

  it("refuses a plain upload (NotFromLibraryError), even with its original ready", async () => {
    const me = await signedInCreator();
    const upload = await insertUploadVideo({ id: me.creatorId });
    await markOriginalReady(upload);

    await expect(confirmSameVideo(me.actor, upload.id)).rejects.toBeInstanceOf(
      NotFromLibraryError,
    );
    expect(await confirmedAt(upload.id)).toBeNull();
  });

  it("answers another creator's video, an unknown id and a non-uuid as not found", async () => {
    const owner = await signedInCreator();
    const draft = await libraryDraft(owner);
    const other = await signedInCreator();

    for (const [actor, id] of [
      [other.actor, draft.id],
      [owner.actor, randomUUID()],
      [owner.actor, "not-a-uuid"],
    ] as const) {
      await expect(confirmSameVideo(actor, id)).rejects.toBeInstanceOf(
        VideoNotFoundError,
      );
    }
    expect(await confirmedAt(draft.id)).toBeNull();
  });
});

describe("getVideoForCreator: a Library draft's source post (the File step's data)", () => {
  it("gives the source, the tick and the source post with the Library's thumbnail URL; no account or platform ids", async () => {
    const { d, post } = await demoPost();
    const { videoId } = await createVideoFromPost(d.actor, post.id);
    const [posting] = await postingsOn(post.id);

    const dto = await getVideoForCreator(d.actor, videoId);
    expect(dto).toMatchObject({
      id: videoId,
      source: "library",
      sameVideoConfirmed: false,
    });
    expect(dto?.sourcePost).toStrictEqual({
      platform: "mock",
      verified: true,
      verifiedUsername: "@demo.creator",
      postedAt: "2026-10-01T15:00:00.000Z",
      durationSec: 14,
      thumbnailSrc: `/api/library/thumbnails/${post.id}?v=${encodeURIComponent(post.thumbnailFetchedAt?.toISOString() ?? "")}`,
      width: post.width,
      height: post.height,
    });
    const json = JSON.stringify(dto);
    for (const hidden of [
      d.account.id,
      d.account.providerAccountId,
      post.providerPostId,
      d.account.creatorId,
      posting?.id ?? "",
    ]) {
      expect(json).not.toContain(hidden);
    }

    await markOriginalReady({ id: videoId, creatorId: d.account.creatorId });
    await confirmSameVideo(d.actor, videoId);
    expect(await getVideoForCreator(d.actor, videoId)).toMatchObject({
      sameVideoConfirmed: true,
    });
  });
});
