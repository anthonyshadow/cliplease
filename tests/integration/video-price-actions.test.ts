import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  setVideoBasePrice as setVideoBasePriceAction,
  setVideoExclusiveOffer as setVideoExclusiveOfferAction,
  setVideoUseEnabled as setVideoUseEnabledAction,
} from "../../src/app/(dashboard)/dashboard/videos/[id]/actions";
import { attestRights as attestRightsAction } from "../../src/app/(dashboard)/dashboard/videos/[id]/review-actions";
import { GENERIC_ERROR_MESSAGE } from "../../src/lib/result";
import { signInPath } from "../../src/lib/sign-in";
import { RIGHTS_LOCK_COPY } from "../../src/lib/videos/rights";
import { videoHref, videoStepHref } from "../../src/lib/videos/steps";
import { NOT_FOUND, redirectTo, rightsForm } from "../helpers/actions";
import { mockNextHeaders, signedInCreator } from "../helpers/auth";
import {
  insertCreator,
  insertLicenseRequest,
  insertUploadVideo,
  publishVideo,
  videoRow,
} from "../helpers/factories";
import { readyUpload } from "../helpers/ready-videos";
import {
  anyAuditsOf,
  auditsInOrder,
  exclusiveSet,
  MUSIC_YES,
  priceSet,
  toggled,
} from "../helpers/video-price-fixtures";

// The Prices section's Server Actions and the Rights step's music Switches (P19d, P19e; 02 §6.1; 07 D82, D97, D109; owner
// answers Q-158, Q-159, Q-161, Q-163; AD-01, AD-06, AD-07, AD-40) against the test database: setVideoBasePrice's bounds
// as the field's error, setVideoUseEnabled's music rule, setVideoExclusiveOffer's premium bound as the field's error and
// its crafted input as the generic one, the generic refusals that refresh() and the 404s that don't, and attestRights
// reading allowPaidSocial / allowBroadcast into its own transaction (on a video already stored music Yes, each music use
// that flips is audited, a No included). The domain's own cases are in video-price.test.ts and exclusive-pricing.test.ts.
// Outside a request refresh() has no router to refresh, so it is a spy here.
vi.mock("next/headers", () => import("../helpers/next-headers"));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));

beforeEach(() => {
  mockNextHeaders(null);
  vi.mocked(refresh).mockClear();
});

const disabledVideo = (creatorId: string) =>
  insertUploadVideo(
    { id: creatorId },
    { status: "disabled", disabledReason: "other", ...MUSIC_YES },
  );

/** The action's save of the video's own offer at ×4.00. */
const offerAt4 = (videoId: string) =>
  setVideoExclusiveOfferAction({ videoId, mode: "on", multiplierBps: 40000 });

describe("setVideoBasePrice (the action; 07 D82, D97; owner answer Q-161)", () => {
  it("sends a signed-out visitor to sign in, back to the video; a bad id is the 404", async () => {
    const id = randomUUID();
    await expect(
      setVideoBasePriceAction({ videoId: id, basePriceCents: 30000 }),
    ).rejects.toMatchObject(redirectTo(signInPath(videoHref(id))));
    await expect(
      setVideoBasePriceAction({ videoId: "x", basePriceCents: 30000 }),
    ).rejects.toMatchObject(NOT_FOUND);
  });

  it("names the field for a bound it refuses, writing nothing and not refreshing", async () => {
    const owner = await signedInCreator();
    const draft = await insertUploadVideo({ id: owner.creatorId });
    for (const [basePriceCents, message] of [
      [900, "Minimum is CA$10."],
      [1_000_100, "Maximum is CA$10,000."],
      [15050, "Use whole dollars."],
    ] as const) {
      expect(
        await setVideoBasePriceAction({ videoId: draft.id, basePriceCents }),
      ).toEqual({
        ok: false,
        error: {
          code: "invalid_input",
          message,
          fields: { basePriceCents: [message] },
        },
      });
    }
    expect((await videoRow(draft.id)).basePriceOverrideCents).toBeNull();
    expect(await auditsInOrder(draft.id, "video.price_set")).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("saves the video's own base, then the rate card's again (null), refreshing after each", async () => {
    const owner = await signedInCreator();
    const draft = await insertUploadVideo({ id: owner.creatorId });

    expect(
      await setVideoBasePriceAction({
        videoId: draft.id,
        basePriceCents: 30000,
      }),
    ).toEqual({ ok: true, data: undefined });
    expect((await videoRow(draft.id)).basePriceOverrideCents).toBe(30000);
    expect(refresh).toHaveBeenCalledOnce();

    expect(
      await setVideoBasePriceAction({
        videoId: draft.id,
        basePriceCents: null,
      }),
    ).toEqual({ ok: true, data: undefined });
    expect((await videoRow(draft.id)).basePriceOverrideCents).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(2);

    // The session's creator is the actor; the currency is their payout currency.
    expect(await auditsInOrder(draft.id, "video.price_set")).toEqual([
      priceSet(null, 30000),
      priceSet(30000, null),
    ]);
  });

  it("refuses a disabled video with the generic message and refreshes; another creator's video is the 404", async () => {
    const owner = await signedInCreator();
    const disabled = await disabledVideo(owner.creatorId);
    expect(
      await setVideoBasePriceAction({
        videoId: disabled.id,
        basePriceCents: 30000,
      }),
    ).toEqual({
      ok: false,
      error: { code: "video_disabled", message: GENERIC_ERROR_MESSAGE },
    });
    expect(refresh).toHaveBeenCalledOnce();

    const theirs = await insertUploadVideo(await insertCreator());
    await expect(
      setVideoBasePriceAction({ videoId: theirs.id, basePriceCents: 30000 }),
    ).rejects.toMatchObject(NOT_FOUND);
    expect(refresh).toHaveBeenCalledOnce();

    for (const id of [disabled.id, theirs.id]) {
      expect((await videoRow(id)).basePriceOverrideCents).toBeNull();
      expect(await auditsInOrder(id, "video.price_set")).toEqual([]);
    }
  });
});

describe("setVideoUseEnabled (the action; 07 D82; owner answer Q-159)", () => {
  it("sends a signed-out visitor to sign in, back to the video; a bad id is the 404", async () => {
    const id = randomUUID();
    await expect(
      setVideoUseEnabledAction({
        videoId: id,
        useKey: "paid_social",
        enabled: true,
      }),
    ).rejects.toMatchObject(redirectTo(signInPath(videoHref(id))));
    await expect(
      setVideoUseEnabledAction({
        videoId: "x",
        useKey: "paid_social",
        enabled: true,
      }),
    ).rejects.toMatchObject(NOT_FOUND);
  });

  it("turns a music use back on for a video with music, then refreshes", async () => {
    const owner = await signedInCreator();
    const music = await readyUpload(owner.creatorId, MUSIC_YES);
    expect(
      await setVideoUseEnabledAction({
        videoId: music.id,
        useKey: "paid_social",
        enabled: true,
      }),
    ).toEqual({ ok: true, data: undefined });
    expect((await videoRow(music.id)).disabledUses).toEqual(["broadcast"]);
    expect(refresh).toHaveBeenCalledOnce();
    expect(await auditsInOrder(music.id, "video.use_toggled")).toEqual([
      toggled("paid_social", true),
    ]);
  });

  it("refuses a video without music and a disabled one with the generic message and refreshes; another creator's is the 404", async () => {
    const owner = await signedInCreator();
    // The music answer No (completeSteps' false), and not answered yet (null).
    const noMusic = await readyUpload(owner.creatorId);
    const unanswered = await insertUploadVideo({ id: owner.creatorId });
    for (const id of [noMusic.id, unanswered.id]) {
      expect(
        await setVideoUseEnabledAction({
          videoId: id,
          useKey: "paid_social",
          enabled: true,
        }),
      ).toEqual({
        ok: false,
        error: { code: "no_music", message: GENERIC_ERROR_MESSAGE },
      });
    }
    expect(refresh).toHaveBeenCalledTimes(2);

    // Disabled comes before the music rule: this one has music Yes.
    const disabled = await disabledVideo(owner.creatorId);
    expect(
      await setVideoUseEnabledAction({
        videoId: disabled.id,
        useKey: "paid_social",
        enabled: true,
      }),
    ).toEqual({
      ok: false,
      error: { code: "video_disabled", message: GENERIC_ERROR_MESSAGE },
    });
    expect(refresh).toHaveBeenCalledTimes(3);

    const theirs = await readyUpload((await insertCreator()).id, MUSIC_YES);
    await expect(
      setVideoUseEnabledAction({
        videoId: theirs.id,
        useKey: "paid_social",
        enabled: true,
      }),
    ).rejects.toMatchObject(NOT_FOUND);
    expect(refresh).toHaveBeenCalledTimes(3);

    expect((await videoRow(noMusic.id)).disabledUses).toEqual([]);
    expect((await videoRow(unanswered.id)).disabledUses).toEqual([]);
    for (const id of [disabled.id, theirs.id]) {
      expect((await videoRow(id)).disabledUses).toEqual([
        "paid_social",
        "broadcast",
      ]);
    }
    for (const id of [noMusic.id, unanswered.id, disabled.id, theirs.id]) {
      expect(await auditsInOrder(id, "video.use_toggled")).toEqual([]);
    }
  });
});

describe("setVideoExclusiveOffer (the action; 07 D109; owner answers Q-159, Q-163)", () => {
  it("sends a signed-out visitor to sign in, back to the video; a bad id is the 404", async () => {
    const id = randomUUID();
    await expect(offerAt4(id)).rejects.toMatchObject(
      redirectTo(signInPath(videoHref(id))),
    );
    await expect(offerAt4("x")).rejects.toMatchObject(NOT_FOUND);
  });

  it("names the field for a premium it refuses, writing nothing and not refreshing", async () => {
    const owner = await signedInCreator();
    const draft = await insertUploadVideo({ id: owner.creatorId });
    expect(
      await setVideoExclusiveOfferAction({
        videoId: draft.id,
        mode: "on",
        multiplierBps: 100500,
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid_input",
        message: "Maximum is ×10.00.",
        fields: { multiplierBps: ["Maximum is ×10.00."] },
      },
    });
    expect(await videoRow(draft.id)).toEqual(draft);
    expect(await anyAuditsOf(draft.id)).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("gives crafted input the generic message and no field: a premium with 'off', a mode that doesn't exist", async () => {
    const owner = await signedInCreator();
    const draft = await insertUploadVideo({ id: owner.creatorId });
    for (const crafted of [
      { mode: "off", multiplierBps: 40000 },
      { mode: "maybe", multiplierBps: null },
    ]) {
      expect(
        await setVideoExclusiveOfferAction({
          videoId: draft.id,
          ...crafted,
        } as unknown as Parameters<typeof setVideoExclusiveOfferAction>[0]),
      ).toEqual({
        ok: false,
        error: { code: "invalid_input", message: GENERIC_ERROR_MESSAGE },
      });
    }
    expect(await videoRow(draft.id)).toEqual(draft);
    expect(await anyAuditsOf(draft.id)).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("saves the video's own offer as the session's creator and refreshes once", async () => {
    const owner = await signedInCreator();
    const draft = await insertUploadVideo({ id: owner.creatorId });
    expect(await offerAt4(draft.id)).toEqual({ ok: true, data: undefined });
    expect(await videoRow(draft.id)).toMatchObject({
      exclusiveEnabled: true,
      exclusiveMultiplierBps: 40000,
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(await auditsInOrder(draft.id, "video.exclusive_set")).toEqual([
      exclusiveSet("rate_card", null, "on", 40000),
    ]);
  });

  it("refuses a disabled video with the generic message and refreshes; another creator's video is the 404", async () => {
    const owner = await signedInCreator();
    const disabled = await disabledVideo(owner.creatorId);
    expect(await offerAt4(disabled.id)).toEqual({
      ok: false,
      error: { code: "video_disabled", message: GENERIC_ERROR_MESSAGE },
    });
    expect(refresh).toHaveBeenCalledOnce();

    const theirs = await insertUploadVideo(await insertCreator());
    await expect(offerAt4(theirs.id)).rejects.toMatchObject(NOT_FOUND);
    expect(refresh).toHaveBeenCalledOnce();

    for (const v of [disabled, theirs]) {
      expect(await videoRow(v.id)).toEqual(v);
      expect(await anyAuditsOf(v.id)).toEqual([]);
    }
  });
});

describe("attestRights' music Switches (the action; 07 D82; owner answer Q-158; AD-01, AD-07)", () => {
  it("a draft: Switches left out or posted off keep both uses off, one posted on turns it back on", async () => {
    const owner = await signedInCreator();
    const draft = await insertUploadVideo({ id: owner.creatorId });
    const review = redirectTo(videoStepHref(draft.id, "review"));

    // No Switch fields (the music answer wasn't Yes when the step rendered): both uses off.
    await expect(
      attestRightsAction(null, rightsForm(draft.id, { containsMusic: "yes" })),
    ).rejects.toMatchObject(review);
    expect(await videoRow(draft.id)).toMatchObject({
      containsMusic: true,
      disabledUses: ["paid_social", "broadcast"],
    });
    // The stored answer wasn't Yes: nothing flipped from a stored Yes, so nothing is audited.
    expect(await auditsInOrder(draft.id, "video.use_toggled")).toEqual([]);

    await expect(
      attestRightsAction(
        null,
        rightsForm(draft.id, { containsMusic: "yes", allowPaidSocial: "on" }),
      ),
    ).rejects.toMatchObject(review);
    expect((await videoRow(draft.id)).disabledUses).toEqual(["broadcast"]);

    await expect(
      attestRightsAction(
        null,
        rightsForm(draft.id, {
          containsMusic: "yes",
          allowPaidSocial: "off",
          allowBroadcast: "off",
        }),
      ),
    ).rejects.toMatchObject(review);
    expect((await videoRow(draft.id)).disabledUses).toEqual([
      "paid_social",
      "broadcast",
    ]);

    // Stored Yes since the first Continue: each flip of a Switch is audited.
    expect(await auditsInOrder(draft.id, "video.use_toggled")).toEqual([
      toggled("paid_social", true),
      toggled("paid_social", false),
    ]);
  });

  it("a published video stored music Yes: back to its page, each music use that flips audited, a No included", async () => {
    const owner = await signedInCreator();
    const live = await publishVideo(
      await readyUpload(owner.creatorId),
      MUSIC_YES,
    );
    const page = redirectTo(videoHref(live.id));

    await expect(
      attestRightsAction(
        null,
        rightsForm(live.id, { containsMusic: "yes", allowBroadcast: "on" }),
      ),
    ).rejects.toMatchObject(page);
    expect(await videoRow(live.id)).toMatchObject({
      status: "published",
      containsMusic: true,
      disabledUses: ["paid_social"],
    });
    expect(await auditsInOrder(live.id, "video.use_toggled")).toEqual([
      toggled("broadcast", true),
    ]);

    // Music No ignores the Switches posted with it; paid social comes back on, so it is audited (AD-01's rule as built).
    await expect(
      attestRightsAction(
        null,
        rightsForm(live.id, {
          containsMusic: "no",
          allowPaidSocial: "on",
          allowBroadcast: "on",
        }),
      ),
    ).rejects.toMatchObject(page);
    expect(await videoRow(live.id)).toMatchObject({
      containsMusic: false,
      disabledUses: [],
    });
    expect(await auditsInOrder(live.id, "video.use_toggled")).toEqual([
      toggled("broadcast", true),
      toggled("paid_social", true),
    ]);
  });

  it("a waiting request locks the Switches with the answers (one transaction); the video page's Switch stays open", async () => {
    const owner = await signedInCreator();
    const live = await publishVideo(
      await readyUpload(owner.creatorId),
      MUSIC_YES,
    );
    await insertLicenseRequest(live, { status: "awaiting_approval" });

    expect(
      await attestRightsAction(
        null,
        rightsForm(live.id, { containsMusic: "yes", allowPaidSocial: "on" }),
      ),
    ).toEqual({
      ok: false,
      error: { code: "rights_locked", message: RIGHTS_LOCK_COPY.request },
    });
    expect((await videoRow(live.id)).disabledUses).toEqual([
      "paid_social",
      "broadcast",
    ]);
    expect(await auditsInOrder(live.id, "video.use_toggled")).toEqual([]);

    // setVideoUseEnabled isn't locked by requests or licenses (07 D82): the waiting request keeps its snapshot.
    expect(
      await setVideoUseEnabledAction({
        videoId: live.id,
        useKey: "paid_social",
        enabled: true,
      }),
    ).toEqual({ ok: true, data: undefined });
    expect((await videoRow(live.id)).disabledUses).toEqual(["broadcast"]);
  });
});
