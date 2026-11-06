import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { db } from "../../src/db/client";
import { rateCard, video } from "../../src/db/schema";
import {
  EXCLUSIVE_TERM_KEYS,
  type RateOptionKey,
  type VideoExclusiveMode,
} from "../../src/lib/domain/values";
import { chosenMultipliers, feeTerms } from "../../src/lib/licensing/selection";
import { computeQuote } from "../../src/lib/pricing/compute-quote";
import type {
  ExclusiveOffer,
  VideoExclusiveColumns,
} from "../../src/lib/pricing/exclusive";
import type { Actor } from "../../src/server/auth/actor";
import {
  getRateCard,
  InvalidRateCardError,
  saveRateCard,
} from "../../src/server/pricing/rate-card";
import {
  setVideoBasePrice,
  setVideoExclusiveOffer,
} from "../../src/server/pricing/video-overrides";
import {
  VideoDisabledError,
  VideoNotFoundError,
} from "../../src/server/videos/errors";
import { readLicensePageData } from "../../src/server/videos/public";
import { getPublishBlockers } from "../../src/server/videos/publish";
import { listCreatorVideos } from "../../src/server/videos/queries";
import { flushAfter } from "../helpers/after";
import { approvingCreatorWithVideo } from "../helpers/approval-fixtures";
import { DEMO_REQUEST } from "../helpers/checkout-fixtures";
import { expectDbError, PG_ERROR, waitForLockWaiter } from "../helpers/db";
import {
  insertUploadVideo,
  publishVideo,
  rateCardRow,
  requestRow,
  videoRow,
} from "../helpers/factories";
import { AFTER_FAILED, recordStderr } from "../helpers/logs";
import { cardOnWithout, cardWith } from "../helpers/rate-card-fixtures";
import {
  pricedCreator,
  pricedLiveVideo,
  readyUpload,
} from "../helpers/ready-videos";
import {
  approve,
  authorize,
  quoted,
  RATE_CARD_AMOUNTS,
  requested,
  settled,
} from "../helpers/request-flow";
import { onlyLicense } from "../helpers/request-outcomes";
import type { ScriptedPayments } from "../helpers/scripted-payments";
import {
  finishScriptedTest,
  installScriptedPayments,
} from "../helpers/scripted-suite";
import {
  anyAuditsOf,
  auditsInOrder,
  exclusiveSet,
} from "../helpers/video-price-fixtures";

// Offering exclusive licenses (P19e; 02 §5.5; 07 D109, D127; 01 J12.1, J12.2, J12.13, J12.15; owner answer Q-164; AD-27,
// AD-33, AD-38, AD-39) against the test database: the rate card's offer, each video's three modes and what the license
// page reads after them, the rule that a 30-day, 6-month or 1-year term must be on, the premium's price, standard prices
// and From prices staying the same, what a request made before keeps through its approval and license, the refusals, the
// audits and the video row lock. Buying an exclusive license is P19f and P19g: no request here is exclusive. The Server
// Actions are in video-price-actions.test.ts and rate-card.test.ts. The payments driver is the scripted double.

vi.mock("@/server/payments/registry", async (importOriginal) =>
  (await import("../helpers/scripted-suite")).scriptedRegistry(
    await importOriginal<typeof import("@/server/payments/registry")>(),
  ),
);

// after() runs at once: the creator transfer after an approval, which each test waits for (finishScriptedTest).
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (await import("../helpers/after")).runAfter,
}));

let scripted: ScriptedPayments;
beforeEach(() => {
  scripted = installScriptedPayments();
  recordStderr(AFTER_FAILED);
});
afterEach(finishScriptedTest);

/** What a standard request stores for the exclusive pair (07 D109). */
const NOT_EXCLUSIVE = {
  exclusive: false,
  exclusiveMultiplierBps: 10000,
} as const;

/** pricedLiveVideo with what its license page reads now: its options, failing the test when the page 404s, and its offer. */
async function pricedVideo(off: readonly RateOptionKey[] = []) {
  const owner = await pricedLiveVideo(off);
  const pageOptions = async () => {
    const page = await readLicensePageData(
      owner.creator.handle,
      owner.live.slug,
    );
    if (!page) throw new Error("no license page");
    return page.options;
  };
  const offerNow = async () => (await pageOptions()).exclusive;
  return { ...owner, pageOptions, offerNow };
}

/** The domain's save of the video's offer, with no premium unless given. */
const setOffer = (
  a: Actor,
  videoId: string,
  mode: VideoExclusiveMode,
  multiplierBps: number | null = null,
) => setVideoExclusiveOffer(a, { videoId, mode, multiplierBps });

/** The schema refuses a premium with 'off' and one out of bounds. */
async function expectCraftedOffersRefused(a: Actor, videoId: string) {
  await expect(setOffer(a, videoId, "off", 40000)).rejects.toBeInstanceOf(
    ZodError,
  );
  await expect(setOffer(a, videoId, "on", 100500)).rejects.toBeInstanceOf(
    ZodError,
  );
}

const offer = (
  offered: boolean,
  multiplierBps: number,
  source: ExclusiveOffer["source"],
): ExclusiveOffer => ({ offered, multiplierBps, source });

/** The exclusive pair as a card or a video stores it. */
const columns = (
  exclusiveEnabled: boolean | null,
  exclusiveMultiplierBps: number | null,
): VideoExclusiveColumns => ({ exclusiveEnabled, exclusiveMultiplierBps });

describe("the defaults (07 D109)", () => {
  it("a card starts off at ×3.00 and a video follows it", async () => {
    const { creator, actor, live, offerNow } = await pricedVideo();
    expect(await getRateCard(creator.id)).toMatchObject(columns(false, 30000));
    expect(await offerNow()).toEqual(offer(false, 30000, "rate_card"));
    expect((await getPublishBlockers(actor, live.id)).videoExclusive).toEqual(
      columns(null, null),
    );
  });
});

describe("saveRateCard's exclusive offer (01 J12.1; 07 D109)", () => {
  it("on at ×3.00 round-trips and the video offers it; the same save again changes nothing, and no save touches a video", async () => {
    const { creator, actor, live, offerNow } = await pricedVideo();
    const untouched = await videoRow(live.id);

    await saveRateCard(actor, cardWith(true, 30000));
    const saved = await getRateCard(creator.id);
    expect(saved).toMatchObject(columns(true, 30000));
    expect(await offerNow()).toEqual(offer(true, 30000, "rate_card"));

    await saveRateCard(actor, cardWith(true, 30000));
    expect(await getRateCard(creator.id)).toEqual(saved);
    expect(await videoRow(live.id)).toEqual(untouched);
  });

  it("off at ×4.00 keeps the premium, and on again offers ×4.00", async () => {
    const { creator, actor, live, offerNow } = await pricedVideo();
    const untouched = await videoRow(live.id);

    await saveRateCard(actor, cardWith(false, 40000));
    expect(await getRateCard(creator.id)).toMatchObject(columns(false, 40000));
    expect(await offerNow()).toEqual(offer(false, 40000, "rate_card"));

    await saveRateCard(actor, cardWith(true, 40000));
    expect(await offerNow()).toEqual(offer(true, 40000, "rate_card"));
    expect(await videoRow(live.id)).toEqual(untouched);
  });

  it.each([
    [9500, "Minimum is ×1.00."],
    [100500, "Maximum is ×10.00."],
    [30250, "Use steps of 0.05."],
  ])(
    "refuses a crafted premium of %i bps, naming its field, and stores nothing",
    async (bps, message) => {
      const { creator, actor } = await pricedCreator();
      const before = await rateCardRow(creator.id);
      const attempt = saveRateCard(actor, cardWith(true, bps));
      await expect(attempt).rejects.toBeInstanceOf(InvalidRateCardError);
      await expect(attempt).rejects.toMatchObject({
        fields: { exclusiveMultiplierBps: message },
      });
      expect(await rateCardRow(creator.id)).toEqual(before);
    },
  );

  it("the CHECK backs the bound", async () => {
    const { creator } = await pricedCreator();
    await expectDbError(
      db
        .update(rateCard)
        .set({ exclusiveMultiplierBps: 9999 })
        .where(eq(rateCard.creatorId, creator.id)),
      {
        code: PG_ERROR.check,
        constraint: "rate_card_exclusive_multiplier_range",
      },
    );
  });
});

describe("setVideoExclusiveOffer (01 J12.2; 07 D109, D127; owner answer Q-164)", () => {
  it("each mode on one video: its own switch beats the card's, a null premium is the card's, and only 'on' stores a premium", async () => {
    const { actor, live, offerNow } = await pricedVideo();
    const stored = () => videoRow(live.id);

    await saveRateCard(actor, cardWith(true, 30000));
    await setOffer(actor, live.id, "off");
    expect(await offerNow()).toEqual(offer(false, 30000, "video"));
    expect(await stored()).toMatchObject(columns(false, null));

    await saveRateCard(actor, cardWith(false, 30000));
    await setOffer(actor, live.id, "on");
    expect(await offerNow()).toEqual(offer(true, 30000, "video"));
    expect(await stored()).toMatchObject(columns(true, null));

    await setOffer(actor, live.id, "on", 40000);
    expect(await offerNow()).toEqual(offer(true, 40000, "video"));
    expect(await stored()).toMatchObject(columns(true, 40000));

    await setOffer(actor, live.id, "rate_card");
    expect(await offerNow()).toEqual(offer(false, 30000, "rate_card"));
    expect(await stored()).toMatchObject(columns(null, null));
    await saveRateCard(actor, cardWith(true, 35000));
    expect(await offerNow()).toEqual(offer(true, 35000, "rate_card"));

    // 'off' drops a stored premium.
    await setOffer(actor, live.id, "on", 40000);
    await setOffer(actor, live.id, "off");
    expect(await stored()).toMatchObject(columns(false, null));
    expect(await offerNow()).toEqual(offer(false, 35000, "video"));
  });

  it("refuses a premium with 'off' and one out of bounds, changing nothing, and the CHECK backs the bound", async () => {
    const { actor, live } = await pricedVideo();
    await setOffer(actor, live.id, "on", 40000);
    const before = await videoRow(live.id);

    await expectCraftedOffersRefused(actor, live.id);
    expect(await videoRow(live.id)).toEqual(before);

    await expectDbError(
      db
        .update(video)
        .set({ exclusiveMultiplierBps: 9999 })
        .where(eq(video.id, live.id)),
      { code: PG_ERROR.check, constraint: "video_exclusive_multiplier_range" },
    );
  });
});

describe("when it is offered (07 D109)", () => {
  it("needs a 30-day, 6-month or 1-year term on: with Perpetual alone it isn't, also with 'on'; one of them back on offers it", async () => {
    const { actor, live, offerNow } = await pricedVideo(EXCLUSIVE_TERM_KEYS);

    await saveRateCard(actor, cardOnWithout(EXCLUSIVE_TERM_KEYS));
    expect(await offerNow()).toEqual(offer(false, 30000, "rate_card"));
    await setOffer(actor, live.id, "on");
    expect(await offerNow()).toEqual(offer(false, 30000, "video"));

    await saveRateCard(actor, cardOnWithout(["d30", "y1"]));
    expect(await offerNow()).toEqual(offer(true, 30000, "video"));
    await setOffer(actor, live.id, "rate_card");
    expect(await offerNow()).toEqual(offer(true, 30000, "rate_card"));
  });

  it("the premium multiplies the video's own base: CA$300 × Paid social ads · 1 year · Worldwide × ×3.00 is CA$9,450.00 + CA$945.00", async () => {
    const { actor, live, pageOptions } = await pricedVideo();
    await saveRateCard(actor, cardWith(true, 30000));
    await setVideoBasePrice(actor, { videoId: live.id, basePriceCents: 30000 });

    const options = await pageOptions();
    const multipliers = chosenMultipliers(options, {
      use: DEMO_REQUEST.useKey,
      term: DEMO_REQUEST.termKey,
      territory: DEMO_REQUEST.territoryKey,
    });
    if (!multipliers) throw new Error("the demo selection isn't offered");
    expect(
      computeQuote({
        currency: options.currency,
        basePriceCents: options.basePriceCents,
        ...multipliers,
        ...feeTerms(options, 1000),
        exclusiveBps: options.exclusive.multiplierBps,
      }),
    ).toMatchObject({
      ok: true,
      quote: {
        licensePriceCents: 945000,
        platformFeeCents: 94500,
        totalCents: 1039500,
      },
    });
  });
});

describe("standard prices stay the same (01 J12.15; 07 D109)", () => {
  it("a request and the From price ignore the card's ×10.00 and the video's own ×5.00", async () => {
    const { actor, live } = await pricedVideo();
    const expectStandardPrices = async () => {
      expect(await requested(live.id)).toMatchObject({
        ...RATE_CARD_AMOUNTS,
        ...NOT_EXCLUSIVE,
      });
      const { videos } = await listCreatorVideos(actor);
      expect(videos.map((card) => card.fromPriceCents)).toEqual([15000]);
    };

    await saveRateCard(actor, cardWith(true, 100000));
    await expectStandardPrices();

    await setOffer(actor, live.id, "on", 50000);
    await expectStandardPrices();
  });
});

describe("a request and a license made before keep their snapshot (01 J12.13)", () => {
  it("a waiting request isn't written by the card or the video, Approve captures it as quoted, and the license isn't written either", async () => {
    const { actor, live } = await approvingCreatorWithVideo();
    const { id } = await requested(live.id);
    const waiting = await authorize(id);
    expect(waiting).toMatchObject({ ...RATE_CARD_AMOUNTS, ...NOT_EXCLUSIVE });

    await saveRateCard(actor, cardWith(true, 40000));
    await setOffer(actor, live.id, "on", 50000);
    await setOffer(actor, live.id, "off");
    // Not written at all: updated_at included.
    expect(await requestRow(id)).toEqual(waiting);

    await approve(id, actor);
    expect(scripted.keys("capture")).toEqual([`pi-capture:${id}:1`]);
    // The creator transfer runs after the response: nothing is left to write these rows once it has.
    await flushAfter();
    const approved = await requestRow(id);
    expect(approved.status).toBe("approved");
    expect(quoted(approved)).toEqual(quoted(waiting));
    const issued = await onlyLicense(id);
    expect(issued.exclusive).toBe(false);

    await saveRateCard(actor, cardWith(false, 50000));
    await setOffer(actor, live.id, "on", 60000);
    await setOffer(actor, live.id, "rate_card");
    expect(await onlyLicense(id)).toEqual(issued);
  });
});

describe("refusals: nothing written, nothing audited (AD-39)", () => {
  it("refuses a disabled video, another creator's actor, an unknown id and an id that isn't a uuid", async () => {
    const { creator, actor, live } = await pricedVideo();
    const disabled = await insertUploadVideo(creator, {
      status: "disabled",
      disabledReason: "rights_claim",
    });
    const other = await pricedCreator();
    const liveBefore = await videoRow(live.id);
    const disabledBefore = await videoRow(disabled.id);

    const cases = [
      { a: actor, videoId: disabled.id, refusal: VideoDisabledError },
      { a: other.actor, videoId: live.id, refusal: VideoNotFoundError },
      { a: actor, videoId: randomUUID(), refusal: VideoNotFoundError },
      { a: actor, videoId: "not-a-uuid", refusal: VideoNotFoundError },
    ];
    for (const { a, videoId, refusal } of cases) {
      await expect(setOffer(a, videoId, "on", 40000)).rejects.toBeInstanceOf(
        refusal,
      );
    }

    expect(await videoRow(live.id)).toEqual(liveBefore);
    expect(await videoRow(disabled.id)).toEqual(disabledBefore);
    for (const v of [live, disabled]) {
      expect(await anyAuditsOf(v.id)).toEqual([]);
    }
  });

  it("allows a draft, a published and an unpublished video", async () => {
    const { creator, actor } = await pricedCreator();
    const videos = [
      await insertUploadVideo(creator),
      await publishVideo(await readyUpload(creator.id)),
      await readyUpload(creator.id, {
        status: "unpublished",
        publishedAt: new Date(),
      }),
    ];
    expect(videos.map((v) => v.status)).toEqual([
      "draft",
      "published",
      "unpublished",
    ]);
    for (const v of videos) {
      await setOffer(actor, v.id, "on", 40000);
      expect(await videoRow(v.id)).toMatchObject(columns(true, 40000));
      expect(await auditsInOrder(v.id, "video.exclusive_set")).toEqual([
        exclusiveSet("rate_card", null, "on", 40000),
      ]);
    }
  });
});

describe("audits (07 §7.2; AD-39)", () => {
  it("video.exclusive_set { fromMode, fromMultiplierBps, toMode, toMultiplierBps } on a change; the same value again writes nothing, and a rejected call adds no row", async () => {
    const { actor, live } = await pricedVideo();
    const steps = [
      ["off", null],
      ["on", null],
      ["on", 40000],
      ["rate_card", null],
    ] as const;
    for (const [mode, multiplierBps] of steps) {
      await setOffer(actor, live.id, mode, multiplierBps);
      const saved = await videoRow(live.id);
      await setOffer(actor, live.id, mode, multiplierBps);
      // No write at all: updated_at unchanged.
      expect(await videoRow(live.id)).toEqual(saved);
    }

    await expectCraftedOffersRefused(actor, live.id);

    expect(await auditsInOrder(live.id, "video.exclusive_set")).toEqual([
      exclusiveSet("rate_card", null, "off", null),
      exclusiveSet("off", null, "on", null),
      exclusiveSet("on", null, "on", 40000),
      exclusiveSet("on", 40000, "rate_card", null),
    ]);
  });
});

describe("the video row lock (AD-39)", () => {
  it("a save that waited builds on what was committed before it: its audit says where the video really was", async () => {
    const { actor, live } = await pricedVideo();
    let attempt: Promise<unknown> = Promise.resolve();
    // Another transaction holds the video row (a licensing one, or another save) while the save arrives.
    await db.transaction(async (tx) => {
      await tx
        .select({ id: video.id })
        .from(video)
        .where(eq(video.id, live.id))
        .for("update");
      attempt = settled(setOffer(actor, live.id, "on", 40000));
      await waitForLockWaiter("select %for update");
      await tx
        .update(video)
        .set({ exclusiveEnabled: false })
        .where(eq(video.id, live.id));
    });
    expect(await attempt).toBeNull();
    expect(await videoRow(live.id)).toMatchObject(columns(true, 40000));
    expect(await auditsInOrder(live.id, "video.exclusive_set")).toEqual([
      exclusiveSet("off", null, "on", 40000),
    ]);
  });
});
