import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  attestRights as attestRightsAction,
  refreshPayoutsStatus as refreshPayoutsStatusAction,
  updateVideoDetails as updateVideoDetailsAction,
} from "../../src/app/(dashboard)/dashboard/videos/[id]/review-actions";
import { GET as setUpPayouts } from "../../src/app/api/stripe/onboarding/route";
import { db } from "../../src/db/client";
import { creatorProfile, video, videoPosting } from "../../src/db/schema";
import { GENERIC_ERROR_MESSAGE } from "../../src/lib/result";
import { SLUG_COPY } from "../../src/lib/validation/video";
import { RIGHTS_COPY, RIGHTS_LOCK_COPY } from "../../src/lib/videos/rights";
import { videoHref, videoStepHref } from "../../src/lib/videos/steps";
import { TITLE_COPY } from "../../src/lib/videos/title";
import type { Actor } from "../../src/server/auth/actor";
import { env } from "../../src/server/env";
import { attestRights, updateVideoDetails } from "../../src/server/videos/edit";
import {
  RightsLockedError,
  SlugLockedError,
  SlugTakenError,
  VideoDisabledError,
  VideoNotFoundError,
} from "../../src/server/videos/errors";
import {
  getPublishBlockers,
  getPublishFacts,
} from "../../src/server/videos/publish";
import { formOf, redirectTo } from "../helpers/actions";
import { bareCreator, mockNextHeaders, signedInCreator } from "../helpers/auth";
import { waitForLockWaiter } from "../helpers/db";
import {
  insertCreator,
  insertLibraryVideo,
  insertLicense,
  insertLicenseRequest,
  insertSocialAccount,
  insertSocialPost,
  insertUploadVideo,
  insertVideoPosting,
  publishVideo,
  videoRow,
} from "../helpers/factories";
import { onboardingRequest } from "../helpers/payouts";
import {
  pricedCreator,
  readyLibraryVideo,
  readyUpload,
} from "../helpers/ready-videos";

// The Rights and Review steps (P13; 02 §5.6, §6.1; 07 §8.2, D09, D66, D74, D82; owner answers Q-94–Q-96) against the
// test database: attestRights and its music rule and locks, updateVideoDetails' title and link rules,
// getPublishBlockers over real rows (payouts never block), the three Server Actions, and payout setup's way back.
vi.mock("next/headers", () => import("../helpers/next-headers"));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));

beforeEach(() => {
  mockNextHeaders(null);
  vi.mocked(refresh).mockClear();
});

const ANSWERS = {
  ownsRights: true,
  containsMusic: false,
  identifiablePeople: false,
} as const;

/** Rights' form as posted: both boxes ticked and both answers No, with `change` on top. */
const rightsForm = (videoId: string, change: Record<string, string> = {}) =>
  formOf({
    videoId,
    ownsRights: "on",
    notReupload: "on",
    containsMusic: "no",
    identifiablePeople: "no",
    ...change,
  });

const blockersOf = async (actor: Actor, videoId: string) =>
  (await getPublishBlockers(actor, videoId)).blockers;

describe("attestRights (02 §5.6; 07 D82)", () => {
  it("stores the answers; music Yes turns off paid social and broadcast, and effectiveOptions drops them", async () => {
    const { creator, actor } = await pricedCreator();
    const draft = await insertUploadVideo(creator);

    await attestRights(actor, {
      ...ANSWERS,
      videoId: draft.id,
      containsMusic: true,
      identifiablePeople: true,
    });
    const row = await videoRow(draft.id);
    expect(row).toMatchObject({
      containsMusic: true,
      identifiablePeople: true,
      attestationVersion: "v1",
      disabledUses: ["paid_social", "broadcast"],
    });
    expect(row.rightsAttestedAt).toBeInstanceOf(Date);
    const read = await getPublishFacts(creator.id, draft.id);
    expect(
      read?.facts.options.use.filter((u) => u.enabled).map((u) => u.key),
    ).toEqual(["organic_social"]);
    expect(
      read?.facts.options.use
        .filter((u) => u.disabledReason === "music")
        .map((u) => u.key),
    ).toEqual(["paid_social", "broadcast"]);

    // Answering again overwrites: music No turns them back on.
    await attestRights(actor, { ...ANSWERS, videoId: draft.id });
    expect(await videoRow(draft.id)).toMatchObject({
      containsMusic: false,
      identifiablePeople: false,
      disabledUses: [],
    });
  });

  it("locks the answers while a request waits, and once a license is sold (owner answer Q-96 a)", async () => {
    const { creator, actor } = await bareCreator();
    const waiting = await insertUploadVideo(creator);
    await insertLicenseRequest(waiting);
    await expect(
      attestRights(actor, { ...ANSWERS, videoId: waiting.id }),
    ).rejects.toEqual(new RightsLockedError("request"));

    const sold = await insertUploadVideo(creator);
    const request = await insertLicenseRequest(sold, { status: "approved" });
    await insertLicense(request);
    await expect(
      attestRights(actor, { ...ANSWERS, videoId: sold.id }),
    ).rejects.toEqual(new RightsLockedError("license"));
    expect((await videoRow(sold.id)).rightsAttestedAt).toBeNull();

    // A request that's over doesn't lock them.
    const expired = await insertUploadVideo(creator);
    await insertLicenseRequest(expired, { status: "expired" });
    await attestRights(actor, { ...ANSWERS, videoId: expired.id });
  });

  it("sees a license committed while it waited for the video lock (07 D110)", async () => {
    const { creator, actor } = await bareCreator();
    const draft = await insertUploadVideo(creator);
    const request = await insertLicenseRequest(draft, { status: "approved" });
    let attempt: Promise<unknown> = Promise.resolve();
    // A licensing transaction: the video row locked (lockVideoForLicensing), then a license written and committed.
    await db.transaction(async (tx) => {
      await tx
        .select({ id: video.id })
        .from(video)
        .where(eq(video.id, draft.id))
        .for("update");
      attempt = attestRights(actor, { ...ANSWERS, videoId: draft.id }).then(
        () => null,
        (error: unknown) => error,
      );
      await waitForLockWaiter("select %for update");
      await insertLicense(request, {}, tx);
    });
    expect(await attempt).toEqual(new RightsLockedError("license"));
    expect((await videoRow(draft.id)).rightsAttestedAt).toBeNull();
  });

  it("refuses a disabled video, and another creator's", async () => {
    const { creator, actor } = await bareCreator();
    const disabled = await insertUploadVideo(creator, {
      status: "disabled",
      disabledReason: "rights_claim",
    });
    await expect(
      attestRights(actor, { ...ANSWERS, videoId: disabled.id }),
    ).rejects.toBeInstanceOf(VideoDisabledError);
    const theirs = await insertUploadVideo(await insertCreator());
    await expect(
      attestRights(actor, { ...ANSWERS, videoId: theirs.id }),
    ).rejects.toBeInstanceOf(VideoNotFoundError);
  });
});

describe("updateVideoDetails (02 §5.6; 07 D09, D23)", () => {
  it("saves the title (1–100) and the trimmed, lowercased link", async () => {
    const { creator, actor } = await bareCreator();
    const draft = await insertUploadVideo(creator);
    await updateVideoDetails(actor, {
      videoId: draft.id,
      title: " Snow  day ",
      slug: " Snow-Day ",
    });
    expect(await videoRow(draft.id)).toMatchObject({
      title: "Snow day",
      slug: "snow-day",
    });
    await updateVideoDetails(actor, {
      videoId: draft.id,
      title: "x".repeat(100),
      slug: "snow-day",
    });
    for (const title of ["", "x".repeat(101)]) {
      await expect(
        updateVideoDetails(actor, {
          videoId: draft.id,
          title,
          slug: "snow-day",
        }),
      ).rejects.toThrow();
    }
    expect((await videoRow(draft.id)).title).toBe("x".repeat(100));
  });

  it("refuses a link another of the creator's videos uses, never suffixing it; another creator's is fine", async () => {
    const { creator, actor } = await bareCreator();
    await insertUploadVideo(creator, { slug: "taken" });
    const draft = await insertUploadVideo(creator);
    await expect(
      updateVideoDetails(actor, {
        videoId: draft.id,
        title: "Snow",
        slug: "Taken",
      }),
    ).rejects.toBeInstanceOf(SlugTakenError);
    expect((await videoRow(draft.id)).slug).toBe(draft.slug);

    const other = await insertCreator();
    await insertUploadVideo(other, { slug: "theirs" });
    await updateVideoDetails(actor, {
      videoId: draft.id,
      title: "Snow",
      slug: "theirs",
    });
    expect((await videoRow(draft.id)).slug).toBe("theirs");
  });

  it("refuses another creator's video and a disabled one, changing nothing", async () => {
    const { creator, actor } = await bareCreator();
    const theirs = await insertUploadVideo(await insertCreator());
    await expect(
      updateVideoDetails(actor, { videoId: theirs.id, title: "Mine now" }),
    ).rejects.toBeInstanceOf(VideoNotFoundError);
    const disabled = await insertUploadVideo(creator, {
      status: "disabled",
      disabledReason: "rights_claim",
    });
    await expect(
      updateVideoDetails(actor, { videoId: disabled.id, title: "Renamed" }),
    ).rejects.toBeInstanceOf(VideoDisabledError);
    expect((await videoRow(theirs.id)).title).toBe(theirs.title);
    expect((await videoRow(disabled.id)).title).toBe(disabled.title);
  });

  it("refuses a new link once the video was published; the title still changes", async () => {
    const { creator, actor } = await bareCreator();
    const live = await publishVideo(await insertUploadVideo(creator));
    await expect(
      updateVideoDetails(actor, {
        videoId: live.id,
        title: live.title,
        slug: "new-link",
      }),
    ).rejects.toBeInstanceOf(SlugLockedError);
    await updateVideoDetails(actor, {
      videoId: live.id,
      title: "Renamed",
      slug: live.slug,
    });
    expect(await videoRow(live.id)).toMatchObject({
      title: "Renamed",
      slug: live.slug,
    });
  });
});

describe("getPublishBlockers (07 §8.2, D66, D74)", () => {
  it("lists a fresh Library draft's steps still to do", async () => {
    const { creator, actor } = await pricedCreator();
    const account = await insertSocialAccount(creator);
    const { video: draft } = await insertLibraryVideo(
      account,
      await insertSocialPost(account),
    );
    expect(await blockersOf(actor, draft.id)).toEqual([
      "original_not_ready",
      "poster_required",
      "postings_unconfirmed",
      "same_video_unconfirmed",
      "not_attested",
    ]);
  });

  it("is empty for an upload with every step done while payouts aren't set up: payouts never block", async () => {
    const { creator, actor } = await pricedCreator();
    expect(creator.payoutsStatus).toBe("not_started");
    const ready = await readyUpload(creator.id);
    expect(await getPublishBlockers(actor, ready.id)).toMatchObject({
      blockers: [],
      reconnectPlatforms: [],
      disabledReason: null,
    });
  });

  it("finds each missing step alone", async () => {
    const { creator, actor } = await pricedCreator();
    const unsaid = await readyUpload(creator.id);
    await db
      .update(video)
      .set({ postingsConfirmedAt: null })
      .where(eq(video.id, unsaid.id));
    expect(await blockersOf(actor, unsaid.id)).toEqual([
      "postings_unconfirmed",
    ]);

    const noCover = await readyUpload(creator.id);
    await db
      .update(video)
      .set({ posterObjectKey: null, posterOrigin: null })
      .where(eq(video.id, noCover.id));
    expect(await blockersOf(actor, noCover.id)).toEqual(["poster_required"]);

    const unticked = await readyLibraryVideo(creator.id);
    await db
      .update(video)
      .set({ sameVideoConfirmedAt: null })
      .where(eq(video.id, unticked.id));
    expect(await blockersOf(actor, unticked.id)).toEqual([
      "same_video_unconfirmed",
    ]);
  });

  it("asks for a reconnect when a verified posting's account needs one, naming the platform", async () => {
    const { creator, actor } = await pricedCreator();
    const row = await readyLibraryVideo(creator.id, "needs_reconnect");
    expect(await getPublishBlockers(actor, row.id)).toMatchObject({
      blockers: ["reconnect_account"],
      reconnectPlatforms: ["mock"],
    });
  });

  it("asks for a reconnect when a verified posting's account is another creator's, never for an unverified posting", async () => {
    const { creator, actor } = await pricedCreator();
    const row = await readyLibraryVideo(creator.id);
    const someoneElse = await insertSocialAccount(await insertCreator());
    await db
      .update(videoPosting)
      .set({ socialAccountId: someoneElse.id })
      .where(eq(videoPosting.videoId, row.id));
    expect(await getPublishBlockers(actor, row.id)).toMatchObject({
      blockers: ["reconnect_account"],
      reconnectPlatforms: ["mock"],
    });

    const upload = await readyUpload(creator.id);
    const stale = await insertSocialAccount(creator, {
      status: "needs_reconnect",
    });
    await insertVideoPosting(upload, {
      platform: "mock",
      socialAccountId: stale.id,
    });
    expect(await blockersOf(actor, upload.id)).toEqual([]);
  });

  it("finds no_enabled_option when organic social is off and music turns off the other uses", async () => {
    const { creator, actor } = await pricedCreator(["organic_social"]);
    const ready = await readyUpload(creator.id);
    expect(await blockersOf(actor, ready.id)).toEqual([]);
    await attestRights(actor, {
      ...ANSWERS,
      videoId: ready.id,
      containsMusic: true,
    });
    expect(await blockersOf(actor, ready.id)).toEqual(["no_enabled_option"]);
  });

  it("finds disabled_by_admin with the admin's reason, and refuses another creator's video", async () => {
    const { creator, actor } = await pricedCreator();
    const ready = await readyUpload(creator.id);
    await db
      .update(video)
      .set({ status: "disabled", disabledReason: "prohibited_content" })
      .where(eq(video.id, ready.id));
    expect(await getPublishBlockers(actor, ready.id)).toMatchObject({
      blockers: ["disabled_by_admin"],
      disabledReason: "prohibited_content",
    });

    const theirs = await pricedCreator();
    await expect(
      getPublishBlockers(theirs.actor, ready.id),
    ).rejects.toBeInstanceOf(VideoNotFoundError);
  });
});

describe("the Rights and Review Server Actions (02 §6.1)", () => {
  it("attestRights: the four answers go to Review; a missing one, or a lock, says why", async () => {
    const owner = await signedInCreator();
    const draft = await insertUploadVideo({ id: owner.creatorId });
    const answers = rightsForm(draft.id, { containsMusic: "yes" });

    const unticked = rightsForm(draft.id, { containsMusic: "yes" });
    unticked.delete("notReupload");
    expect(await attestRightsAction(null, unticked)).toEqual({
      ok: false,
      error: { code: "invalid_input", message: RIGHTS_COPY.answerAll },
    });
    expect((await videoRow(draft.id)).rightsAttestedAt).toBeNull();

    await expect(attestRightsAction(null, answers)).rejects.toMatchObject(
      redirectTo(videoStepHref(draft.id, "review")),
    );
    expect(await videoRow(draft.id)).toMatchObject({
      containsMusic: true,
      disabledUses: ["paid_social", "broadcast"],
    });

    await insertLicenseRequest(draft, { status: "awaiting_approval" });
    expect(await attestRightsAction(null, answers)).toEqual({
      ok: false,
      error: { code: "rights_locked", message: RIGHTS_LOCK_COPY.request },
    });
  });

  it("attestRights on a video past its draft (the video page's Rights Edit): back to its page", async () => {
    const owner = await signedInCreator();
    const live = await readyUpload(owner.creatorId, {
      status: "published",
      publishedAt: new Date(),
    });
    await expect(
      attestRightsAction(null, rightsForm(live.id, { containsMusic: "yes" })),
    ).rejects.toMatchObject(redirectTo(videoHref(live.id)));
    expect(await videoRow(live.id)).toMatchObject({
      status: "published",
      containsMusic: true,
    });
  });

  it("attestRights: a sold license says so", async () => {
    const owner = await signedInCreator();
    const sold = await insertUploadVideo({ id: owner.creatorId });
    await insertLicense(
      await insertLicenseRequest(sold, { status: "approved" }),
    );
    expect(await attestRightsAction(null, rightsForm(sold.id))).toEqual({
      ok: false,
      error: { code: "rights_locked", message: RIGHTS_LOCK_COPY.license },
    });
  });

  it("updateVideoDetails: each field's first message, a taken link, then the page again", async () => {
    const owner = await signedInCreator();
    await insertUploadVideo({ id: owner.creatorId }, { slug: "taken" });
    const draft = await insertUploadVideo({ id: owner.creatorId });

    expect(
      await updateVideoDetailsAction({
        videoId: draft.id,
        title: "",
        slug: "Not a link!",
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "invalid_input",
        fields: { title: [TITLE_COPY.empty], slug: [SLUG_COPY.format] },
      },
    });
    expect(
      await updateVideoDetailsAction({
        videoId: draft.id,
        title: "Snow",
        slug: "taken",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "slug_taken", fields: { slug: [SLUG_COPY.taken] } },
    });
    expect(refresh).not.toHaveBeenCalled();

    expect(
      await updateVideoDetailsAction({
        videoId: draft.id,
        title: "Snow",
        slug: "snow",
      }),
    ).toEqual({ ok: true, data: undefined });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("updateVideoDetails: saving one row leaves the other as stored (another tab's change stays)", async () => {
    const owner = await signedInCreator();
    const draft = await insertUploadVideo({ id: owner.creatorId });
    // Another tab changed the link; this one saves the title only.
    await updateVideoDetailsAction({ videoId: draft.id, slug: "storm-roofs" });
    expect(
      await updateVideoDetailsAction({ videoId: draft.id, title: "Renamed" }),
    ).toEqual({ ok: true, data: undefined });
    expect(await videoRow(draft.id)).toMatchObject({
      title: "Renamed",
      slug: "storm-roofs",
    });
  });

  it("updateVideoDetails: a crafted call is refused, not a crash", async () => {
    const owner = await signedInCreator();
    const draft = await insertUploadVideo({ id: owner.creatorId });
    const generic = {
      ok: false,
      error: { code: "invalid_input", message: GENERIC_ERROR_MESSAGE },
    };
    for (const crafted of [
      null,
      { videoId: draft.id, title: 42 },
      { videoId: draft.id },
    ]) {
      expect(
        await updateVideoDetailsAction(
          crafted as unknown as Parameters<typeof updateVideoDetailsAction>[0],
        ),
      ).toEqual(generic);
    }
    expect(await videoRow(draft.id)).toMatchObject({
      title: draft.title,
      slug: draft.slug,
    });
  });

  it("updateVideoDetails: a published video's link says it can't change", async () => {
    const owner = await signedInCreator();
    const live = await publishVideo(
      await insertUploadVideo({ id: owner.creatorId }),
    );
    expect(
      await updateVideoDetailsAction({ videoId: live.id, slug: "new-link" }),
    ).toMatchObject({
      ok: false,
      error: { code: "slug_locked", fields: { slug: [SLUG_COPY.locked] } },
    });
    expect((await videoRow(live.id)).slug).toBe(live.slug);
  });

  it("both actions refuse a disabled video with the generic message, changing nothing", async () => {
    const owner = await signedInCreator();
    const disabled = await insertUploadVideo(
      { id: owner.creatorId },
      { status: "disabled", disabledReason: "other" },
    );
    const refused = {
      ok: false,
      error: { code: "video_disabled", message: GENERIC_ERROR_MESSAGE },
    };
    expect(await attestRightsAction(null, rightsForm(disabled.id))).toEqual(
      refused,
    );
    expect(
      await updateVideoDetailsAction({ videoId: disabled.id, title: "New" }),
    ).toEqual(refused);
    expect(await videoRow(disabled.id)).toMatchObject({
      title: disabled.title,
      rightsAttestedAt: null,
    });
  });

  it("refreshPayoutsStatus says what it read, and fetches the page again only when it changed", async () => {
    const owner = await signedInCreator();
    expect(await refreshPayoutsStatusAction()).toEqual({
      ok: true,
      data: { payoutsStatus: "not_started" },
    });
    expect(refresh).not.toHaveBeenCalled();

    // Stripe was checking; the fake driver now reads the account as active.
    await db
      .update(creatorProfile)
      .set({
        stripeAccountId: `acct_fake_${owner.creatorId}`,
        payoutsStatus: "pending",
      })
      .where(eq(creatorProfile.id, owner.creatorId));
    expect(await refreshPayoutsStatusAction()).toEqual({
      ok: true,
      data: { payoutsStatus: "active" },
    });
    expect(refresh).toHaveBeenCalledOnce();
  });
});

describe("payout setup's way back (owner answer Q-94 a)", () => {
  const setUp = (returnTo?: string) =>
    setUpPayouts(onboardingRequest("same-origin", returnTo));

  it("comes back to the draft's Review, and to Settings for a target 07 D37 refuses", async () => {
    const owner = await signedInCreator();
    const draft = await insertUploadVideo({ id: owner.creatorId });
    const review = videoStepHref(draft.id, "review");

    const back = await setUp(review);
    expect(back.status).toBe(303);
    expect(back.headers.get("location")).toBe(
      `${env.APP_URL}${review}&payouts=returned`,
    );

    for (const refused of ["//evil.com", "https://evil.com/x", "/admin"]) {
      expect((await setUp(refused)).headers.get("location")).toBe(
        `${env.APP_URL}/dashboard/settings?payouts=returned`,
      );
    }
    expect((await setUp()).headers.get("location")).toBe(
      `${env.APP_URL}/dashboard/settings?payouts=returned`,
    );
  });
});
