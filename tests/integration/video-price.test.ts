import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { db } from "../../src/db/client";
import { auditEvent, licenseRequest, video } from "../../src/db/schema";
import type {
  LicenseRequest,
  NewCreatorProfile,
  NewVideo,
} from "../../src/db/schema/types";
import { LicenseSnapshotV1Schema } from "../../src/lib/licensing/snapshot";
import { StartCheckoutSchema } from "../../src/lib/validation/checkout";
import {
  MUSIC_DISABLED_USES,
  type MusicUseKey,
} from "../../src/lib/videos/rights";
import { type Actor, WEBHOOK } from "../../src/server/auth/actor";
import { approveLicenseRequest } from "../../src/server/licensing/approve";
import {
  createLicenseRequest,
  markAuthorized,
} from "../../src/server/licensing/requests";
import {
  setVideoBasePrice,
  setVideoUseEnabled,
} from "../../src/server/pricing/video-overrides";
import type { RequestContext } from "../../src/server/request-context";
import { attestRights } from "../../src/server/videos/edit";
import {
  NoMusicError,
  VideoDisabledError,
  VideoNotFoundError,
} from "../../src/server/videos/errors";
import {
  listPublicVideos,
  readLicensePageData,
} from "../../src/server/videos/public";
import { getPublishBlockers } from "../../src/server/videos/publish";
import { listCreatorVideos } from "../../src/server/videos/queries";
import { flushAfter } from "../helpers/after";
import { approvingCreatorWithVideo } from "../helpers/approval-fixtures";
import { DEMO_REQUEST } from "../helpers/checkout-fixtures";
import { expectDbError, PG_ERROR, waitForLockWaiter } from "../helpers/db";
import {
  insertUploadVideo,
  publishVideo,
  requestRow,
  videoRow,
} from "../helpers/factories";
import { AFTER_FAILED, recordStderr } from "../helpers/logs";
import { pricedCreator, readyUpload } from "../helpers/ready-videos";
import { onlyLicense } from "../helpers/request-outcomes";
import type { ScriptedPayments } from "../helpers/scripted-payments";
import {
  finishScriptedTest,
  installScriptedPayments,
} from "../helpers/scripted-suite";
import {
  auditsInOrder,
  MUSIC_YES,
  priceSet,
  toggled,
} from "../helpers/video-price-fixtures";

// Per-video base price and music re-enable (P19d; 02 §5.5; 07 D82, D97; 01 J4.8, J5.14, J7.4; owner answers Q-158,
// Q-161; AD-01, AD-02, AD-04, AD-05, AD-21, AD-22) against the test database: setVideoBasePrice and setVideoUseEnabled
// under the video row lock, what the license page, the Review, the cards and a new request read after them, what a
// request made before keeps (its quote and its use, approved by the creator or by auto-approve), attestRights' music
// Switches and their audits (the rule as built: on a video already stored music Yes, every music use that flips is
// audited, a No included), the refusals, and the lock's races. The Server Actions are in video-price-actions.test.ts.
// The payments driver is the scripted double. A music video is published first and answered Yes after, since the
// factory's publishVideo writes music No.

vi.mock("@/server/payments/registry", async (importOriginal) =>
  (await import("../helpers/scripted-suite")).scriptedRegistry(
    await importOriginal<typeof import("@/server/payments/registry")>(),
  ),
);

// after() runs at once: auto-approve's run and the creator transfer, which each test waits for (finishScriptedTest).
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

const CTX: RequestContext = {
  ip: "203.0.113.7",
  userAgent: "Mozilla/5.0 (test)",
};

/** The Rights answers besides music: the rights are the creator's, no identifiable people. */
const NO_PEOPLE = { ownsRights: true, identifiablePeople: false } as const;

/** The J4.7 quote at the rate card's CA$150: CA$1,575.00 + CA$157.50 = CA$1,732.50. */
const RATE_CARD_AMOUNTS = {
  licensePriceCents: 157500,
  platformFeeCents: 15750,
  amountTotalCents: 173250,
} as const;

const OPTION_DISABLED = { ok: false, reason: "option_disabled" } as const;

/** A published upload (no postings) of a creator with onboarding's rate card, `extra` on top: no payment runs on it. */
async function pricedVideo(extra: Partial<NewVideo> = {}) {
  const owner = await pricedCreator();
  const live = await publishVideo(await readyUpload(owner.creator.id), extra);
  return { ...owner, live };
}

/**
 * A creator who can approve (`creator` overrides the profile) and their published video, then music Yes on its Rights
 * step: paid social and broadcast off, and nothing audited, since it was stored No.
 */
async function musicVideo(creator: Partial<NewCreatorProfile> = {}) {
  const approver = await approvingCreatorWithVideo(creator);
  await attestRights(approver.actor, {
    ...NO_PEOPLE,
    videoId: approver.live.id,
    containsMusic: true,
  });
  return approver;
}

/** The demo request (Paid social ads · 1 year · Worldwide at CA$1,732.50) for `videoId`, as the action parses it. */
const checkoutInput = (videoId: string, change: Record<string, unknown> = {}) =>
  StartCheckoutSchema.parse({
    ...DEMO_REQUEST,
    videoId,
    submissionId: randomUUID(),
    ...change,
  });

/** checkoutInput's request, which the server must take: the checkout_pending row it saved. */
async function requested(
  videoId: string,
  change: Record<string, unknown> = {},
): Promise<LicenseRequest> {
  const input = checkoutInput(videoId, change);
  const result = await createLicenseRequest(input, CTX);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  const [row] = await db
    .select()
    .from(licenseRequest)
    .where(eq(licenseRequest.checkoutSubmissionId, input.submissionId));
  if (!row) throw new Error("no request");
  return row;
}

/** T2 as Stripe's webhook brings it (markAuthorized): the request now waits for the creator. */
async function authorize(id: string): Promise<LicenseRequest> {
  await markAuthorized(id, WEBHOOK);
  const row = await requestRow(id);
  expect(row.status).toBe("awaiting_approval");
  return row;
}

/** The creator's Approve, which must succeed. */
async function approve(id: string, actor: Actor): Promise<void> {
  const result = await approveLicenseRequest(id, actor);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
}

/** The request's one license's snapshot, parsed. */
const snapshotOf = async (requestId: string) =>
  LicenseSnapshotV1Schema.parse((await onlyLicense(requestId)).snapshot);

/** What a request was quoted and stores: the base, the multipliers, the fee's terms and the three amounts. */
const quoted = (r: LicenseRequest) => ({
  basePriceCents: r.basePriceCents,
  useMultiplierBps: r.useMultiplierBps,
  termMultiplierBps: r.termMultiplierBps,
  territoryMultiplierBps: r.territoryMultiplierBps,
  platformFeeBps: r.platformFeeBps,
  platformFeeMinCents: r.platformFeeMinCents,
  licensePriceCents: r.licensePriceCents,
  platformFeeCents: r.platformFeeCents,
  amountTotalCents: r.amountTotalCents,
});

const requestsOf = (videoId: string) =>
  db
    .select({ id: licenseRequest.id })
    .from(licenseRequest)
    .where(eq(licenseRequest.videoId, videoId));

/** Every audit row on the video, any action. */
const anyAuditsOf = (videoId: string) =>
  db
    .select({ action: auditEvent.action })
    .from(auditEvent)
    .where(eq(auditEvent.entityId, videoId));

/** Each card's From price by video id. */
const fromPrices = (
  cards: readonly { id: string; fromPriceCents: number | null }[],
) => Object.fromEntries(cards.map((c) => [c.id, c.fromPriceCents]));

/** What the license page offers for each use, or null when the page 404s. */
const usesOn = async (handle: string, slug: string) =>
  (await readLicensePageData(handle, slug))?.options.use.map(
    ({ key, enabled, disabledReason }) => ({ key, enabled, disabledReason }),
  ) ?? null;

/** `p` settled: null once it resolves, else what it threw, so a race's loser is never an unhandled rejection. */
const settled = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (error: unknown) => error,
  );

describe("setVideoBasePrice: new requests only (02 §5.5; 07 D82, D97; 01 J4.8)", () => {
  it("J4.8: the video's own base prices the license page, the Review and a new request; the old total is refused", async () => {
    const { creator, actor, live } = await pricedVideo();
    await setVideoBasePrice(actor, { videoId: live.id, basePriceCents: 30000 });

    expect(
      (await readLicensePageData(creator.handle, live.slug))?.options,
    ).toMatchObject({ basePriceCents: 30000, basePriceSource: "video" });
    const review = await getPublishBlockers(actor, live.id);
    expect(review.options).toMatchObject({
      basePriceCents: 30000,
      basePriceSource: "video",
    });
    // The rate card itself, for the editor's "Use my rate card (CA$150)" (AD-04).
    expect(review.rateCard.basePriceCents).toBe(15000);

    expect(
      quoted(await requested(live.id, { expectedTotalCents: 346500 })),
    ).toMatchObject({
      basePriceCents: 30000,
      licensePriceCents: 315000,
      platformFeeCents: 31500,
      amountTotalCents: 346500,
    });
    expect(await createLicenseRequest(checkoutInput(live.id), CTX)).toEqual({
      ok: false,
      reason: "price_changed",
      totalCents: 346500,
    });
    expect(await requestsOf(live.id)).toHaveLength(1);
  });

  it("charges the CA$2.00 fee floor on a CA$10 video: Organic · 30 days · One country", async () => {
    const { actor, live } = await pricedVideo();
    await setVideoBasePrice(actor, { videoId: live.id, basePriceCents: 1000 });
    expect(
      await requested(live.id, {
        useKey: "organic_social",
        termKey: "d30",
        territoryKey: "country",
        territoryCode: "CA",
        expectedTotalCents: 1200,
      }),
    ).toMatchObject({
      basePriceCents: 1000,
      licensePriceCents: 1000,
      platformFeeCents: 200,
      amountTotalCents: 1200,
    });
  });

  it("cleared, the video follows the rate card again", async () => {
    const { creator, actor, live } = await pricedVideo();
    await setVideoBasePrice(actor, { videoId: live.id, basePriceCents: 30000 });
    await setVideoBasePrice(actor, { videoId: live.id, basePriceCents: null });
    expect((await videoRow(live.id)).basePriceOverrideCents).toBeNull();
    expect(
      (await readLicensePageData(creator.handle, live.slug))?.options,
    ).toMatchObject({ basePriceCents: 15000, basePriceSource: "rate_card" });
    expect(await requested(live.id)).toMatchObject({
      basePriceCents: 15000,
      ...RATE_CARD_AMOUNTS,
    });
  });

  it("changes that video's From price alone, on the creator's cards and the public grid", async () => {
    const { creator, actor, live: a } = await pricedVideo();
    const b = await publishVideo(await readyUpload(creator.id));
    await setVideoBasePrice(actor, { videoId: a.id, basePriceCents: 30000 });
    const want = { [a.id]: 30000, [b.id]: 15000 };
    expect(fromPrices((await listCreatorVideos(actor)).videos)).toEqual(want);
    expect(fromPrices(await listPublicVideos(creator.id))).toEqual(want);
  });

  it("J4.8: a waiting request keeps its quote through a price change, and Approve captures and licenses it as quoted", async () => {
    const { actor, live } = await approvingCreatorWithVideo();
    const { id } = await requested(live.id);
    const waiting = await authorize(id);
    expect(quoted(waiting)).toMatchObject({
      basePriceCents: 15000,
      ...RATE_CARD_AMOUNTS,
    });

    await setVideoBasePrice(actor, { videoId: live.id, basePriceCents: 30000 });
    // Not written at all: updated_at included.
    expect(await requestRow(id)).toEqual(waiting);

    await approve(id, actor);
    expect(quoted(await requestRow(id))).toEqual(quoted(waiting));
    expect(scripted.keys("capture")).toEqual([`pi-capture:${id}:1`]);
    expect((await snapshotOf(id)).amounts).toEqual({
      ...RATE_CARD_AMOUNTS,
      currency: "cad",
    });
  });
});

describe("setVideoUseEnabled: a music use back on (07 D82; 01 J5.14, J7.4; AD-22)", () => {
  it("J5.14: paid social back on sells with music excluded, broadcast stays off, and off again keeps USE_KEYS' order", async () => {
    const { creator, actor, live } = await musicVideo();
    expect((await videoRow(live.id)).disabledUses).toEqual([
      "paid_social",
      "broadcast",
    ]);
    expect(await auditsInOrder(live.id, "video.use_toggled")).toEqual([]);
    expect(await createLicenseRequest(checkoutInput(live.id), CTX)).toEqual(
      OPTION_DISABLED,
    );

    await setVideoUseEnabled(actor, {
      videoId: live.id,
      useKey: "paid_social",
      enabled: true,
    });
    expect((await videoRow(live.id)).disabledUses).toEqual(["broadcast"]);
    expect(await usesOn(creator.handle, live.slug)).toEqual([
      { key: "organic_social", enabled: true, disabledReason: undefined },
      { key: "paid_social", enabled: true, disabledReason: undefined },
      { key: "broadcast", enabled: false, disabledReason: "music" },
    ]);
    const { id } = await requested(live.id);
    await authorize(id);
    await approve(id, actor);
    expect(await snapshotOf(id)).toMatchObject({
      scope: { useKey: "paid_social" },
      exclusions: { music: true },
    });
    expect(
      await createLicenseRequest(
        checkoutInput(live.id, {
          useKey: "broadcast",
          expectedTotalCents: 288750,
        }),
        CTX,
      ),
    ).toEqual(OPTION_DISABLED);

    // Off again, with a license already sold: the Switch isn't locked; the key goes back in USE_KEYS' place.
    await setVideoUseEnabled(actor, {
      videoId: live.id,
      useKey: "paid_social",
      enabled: false,
    });
    expect((await videoRow(live.id)).disabledUses).toEqual([
      "paid_social",
      "broadcast",
    ]);
    expect(await createLicenseRequest(checkoutInput(live.id), CTX)).toEqual(
      OPTION_DISABLED,
    );
  });

  it("a request made before the Switch goes off keeps its use: authorized, approved and licensed with music excluded", async () => {
    const { actor, live } = await musicVideo();
    await setVideoUseEnabled(actor, {
      videoId: live.id,
      useKey: "paid_social",
      enabled: true,
    });
    const made = await requested(live.id);
    await setVideoUseEnabled(actor, {
      videoId: live.id,
      useKey: "paid_social",
      enabled: false,
    });
    // Not written at all: updated_at included.
    expect(await requestRow(made.id)).toEqual(made);

    await authorize(made.id);
    await approve(made.id, actor);
    expect(await snapshotOf(made.id)).toMatchObject({
      scope: { useKey: "paid_social" },
      exclusions: { music: true },
      amounts: { ...RATE_CARD_AMOUNTS, currency: "cad" },
    });
    expect(quoted(await requestRow(made.id))).toEqual(quoted(made));
    expect(await auditsInOrder(live.id, "video.use_toggled")).toEqual([
      toggled("paid_social", true),
      toggled("paid_social", false),
    ]);
  });

  it("the same under auto-approve: a Switch-off and a new price before authorization change nothing it approves", async () => {
    const { actor, live } = await musicVideo({ autoApprove: true });
    await setVideoUseEnabled(actor, {
      videoId: live.id,
      useKey: "paid_social",
      enabled: true,
    });
    const made = await requested(live.id);
    expect(made.autoApprove).toBe(true);
    await setVideoUseEnabled(actor, {
      videoId: live.id,
      useKey: "paid_social",
      enabled: false,
    });
    await setVideoBasePrice(actor, { videoId: live.id, basePriceCents: 30000 });

    // T2 schedules the auto-approval after the response; runAfter starts it at once.
    await markAuthorized(made.id, WEBHOOK);
    await flushAfter();
    expect((await requestRow(made.id)).status).toBe("approved");
    expect(scripted.keys("capture")).toEqual([`pi-capture:${made.id}:1`]);
    expect(await snapshotOf(made.id)).toMatchObject({
      scope: { useKey: "paid_social" },
      exclusions: { music: true },
      amounts: { ...RATE_CARD_AMOUNTS, currency: "cad" },
    });
  });
});

describe("attestRights' music Switches (07 D82; owner answer Q-158; AD-01)", () => {
  it("stores the uses not allowed; on a video already stored music Yes each use that flips is audited, a No included", async () => {
    const { creator, actor } = await pricedCreator();
    // A draft with every step done, stored music No (completeSteps writes it) and no request to lock its answers.
    const draft = await readyUpload(creator.id);
    const attest = (
      containsMusic: boolean,
      allowMusicUses?: readonly MusicUseKey[],
    ) =>
      attestRights(actor, {
        ...NO_PEOPLE,
        videoId: draft.id,
        containsMusic,
        allowMusicUses,
      });
    const offNow = async () => (await videoRow(draft.id)).disabledUses;
    const toggles = () => auditsInOrder(draft.id, "video.use_toggled");

    // Stored No: a Yes is no Switch flipping.
    await attest(true);
    expect(await offNow()).toEqual(["paid_social", "broadcast"]);
    expect(await toggles()).toEqual([]);

    await attest(true, ["paid_social"]);
    expect(await offNow()).toEqual(["broadcast"]);
    expect(await toggles()).toEqual([toggled("paid_social", true)]);
    await attest(true, ["paid_social"]);
    expect(await toggles()).toHaveLength(1);

    await attest(true, []);
    expect(await offNow()).toEqual(["paid_social", "broadcast"]);
    expect(await toggles()).toEqual([
      toggled("paid_social", true),
      toggled("paid_social", false),
    ]);

    // Music No ignores the Switches posted with it and turns both uses back on: one row each, written in one
    // transaction (one created_at), so compared as a set.
    await attest(false, ["paid_social", "broadcast"]);
    expect(await offNow()).toEqual([]);
    const afterNo = await toggles();
    expect(afterNo.slice(0, 2)).toEqual([
      toggled("paid_social", true),
      toggled("paid_social", false),
    ]);
    expect(afterNo.slice(2)).toHaveLength(2);
    expect(afterNo.slice(2)).toEqual(
      expect.arrayContaining([
        toggled("paid_social", true),
        toggled("broadcast", true),
      ]),
    );

    // Stored No again: Yes with a Switch on audits nothing.
    await attest(true, ["broadcast"]);
    expect(await offNow()).toEqual(["paid_social"]);
    expect(await toggles()).toHaveLength(4);
  });
});

describe("refusals: nothing written, nothing audited (AD-02, AD-03)", () => {
  it("setVideoUseEnabled refuses a video whose music answer isn't Yes: No, or not answered yet", async () => {
    const { creator, actor } = await pricedCreator();
    const no = await readyUpload(creator.id);
    const unanswered = await insertUploadVideo(creator);
    expect([no.containsMusic, unanswered.containsMusic]).toEqual([false, null]);
    for (const v of [no, unanswered]) {
      await expect(
        setVideoUseEnabled(actor, {
          videoId: v.id,
          useKey: "paid_social",
          enabled: true,
        }),
      ).rejects.toBeInstanceOf(NoMusicError);
      expect((await videoRow(v.id)).disabledUses).toEqual([]);
      expect(await anyAuditsOf(v.id)).toEqual([]);
    }
  });

  it("both refuse a disabled video, another creator's actor and an id that isn't a uuid", async () => {
    const { creator, actor, live } = await pricedVideo(MUSIC_YES);
    // Music not answered: VideoDisabledError comes before NoMusicError.
    const disabled = await insertUploadVideo(creator, {
      status: "disabled",
      disabledReason: "rights_claim",
    });
    const other = await pricedCreator();
    const cases = [
      { a: actor, videoId: disabled.id, refusal: VideoDisabledError },
      { a: other.actor, videoId: live.id, refusal: VideoNotFoundError },
      { a: actor, videoId: "not-a-uuid", refusal: VideoNotFoundError },
    ];
    for (const { a, videoId, refusal } of cases) {
      await expect(
        setVideoBasePrice(a, { videoId, basePriceCents: 30000 }),
      ).rejects.toBeInstanceOf(refusal);
      await expect(
        setVideoUseEnabled(a, {
          videoId,
          useKey: "paid_social",
          enabled: true,
        }),
      ).rejects.toBeInstanceOf(refusal);
    }
    expect(await videoRow(disabled.id)).toMatchObject({
      basePriceOverrideCents: null,
      disabledUses: [],
    });
    expect(await videoRow(live.id)).toMatchObject({
      basePriceOverrideCents: null,
      disabledUses: ["paid_social", "broadcast"],
    });
    for (const v of [disabled, live]) {
      expect(await anyAuditsOf(v.id)).toEqual([]);
    }
  });

  it("setVideoBasePrice refuses a price outside the bounds or not in whole dollars, and the CHECK backs it", async () => {
    const { actor, live } = await pricedVideo();
    await setVideoBasePrice(actor, { videoId: live.id, basePriceCents: 30000 });
    for (const [basePriceCents, message] of [
      [999, "Minimum is CA$10."],
      [1_000_100, "Maximum is CA$10,000."],
      [15050, "Use whole dollars."],
    ] as const) {
      const refused = setVideoBasePrice(actor, {
        videoId: live.id,
        basePriceCents,
      });
      await expect(refused).rejects.toBeInstanceOf(ZodError);
      // The bounds are the creator's payout currency's, read in the transaction (07 D97).
      await expect(refused).rejects.toThrow(message);
    }
    // The stored price stays, with only its own audit.
    expect((await videoRow(live.id)).basePriceOverrideCents).toBe(30000);
    expect(await auditsInOrder(live.id, "video.price_set")).toEqual([
      priceSet(null, 30000),
    ]);
    await expectDbError(
      db
        .update(video)
        .set({ basePriceOverrideCents: 15050 })
        .where(eq(video.id, live.id)),
      { code: PG_ERROR.check, constraint: "video_price_override_range" },
    );
  });
});

describe("audits (07 §7.2; AD-05)", () => {
  it("video.price_set { fromCents, toCents, currency } and video.use_toggled { useKey, enabled } on a change; the same value again writes nothing", async () => {
    const { actor, live } = await pricedVideo(MUSIC_YES);
    await setVideoBasePrice(actor, { videoId: live.id, basePriceCents: 30000 });
    const saved = await videoRow(live.id);
    await setVideoBasePrice(actor, { videoId: live.id, basePriceCents: 30000 });
    // No write at all: updated_at unchanged.
    expect(await videoRow(live.id)).toEqual(saved);
    await setVideoBasePrice(actor, { videoId: live.id, basePriceCents: null });
    expect(await auditsInOrder(live.id, "video.price_set")).toEqual([
      priceSet(null, 30000),
      priceSet(30000, null),
    ]);

    const on = {
      videoId: live.id,
      useKey: "paid_social",
      enabled: true,
    } as const;
    await setVideoUseEnabled(actor, on);
    const toggledOn = await videoRow(live.id);
    await setVideoUseEnabled(actor, on);
    expect(await videoRow(live.id)).toEqual(toggledOn);
    expect(await auditsInOrder(live.id, "video.use_toggled")).toEqual([
      toggled("paid_social", true),
    ]);
  });
});

describe("what a Switch changes for Publish and for buyers (07 §8.2, D82; AD-21)", () => {
  /** A draft with every step done and music Yes, on a card with Organic off: no use left on. */
  async function organicOffMusicDraft() {
    const owner = await pricedCreator(["organic_social"]);
    const draft = await readyUpload(owner.creator.id);
    await attestRights(owner.actor, {
      ...NO_PEOPLE,
      videoId: draft.id,
      containsMusic: true,
    });
    return { ...owner, draft };
  }

  it("a music Switch clears no_enabled_option on a draft", async () => {
    const { actor, draft } = await organicOffMusicDraft();
    expect((await getPublishBlockers(actor, draft.id)).blockers).toEqual([
      "no_enabled_option",
    ]);
    await setVideoUseEnabled(actor, {
      videoId: draft.id,
      useKey: "paid_social",
      enabled: true,
    });
    expect((await getPublishBlockers(actor, draft.id)).blockers).toEqual([]);
  });

  it("off on a live video's last buyable use takes it off its license page and the public grid at once; on brings it back", async () => {
    const { creator, actor, draft } = await organicOffMusicDraft();
    const paidSocial = (enabled: boolean) =>
      setVideoUseEnabled(actor, {
        videoId: draft.id,
        useKey: "paid_social",
        enabled,
      });
    await paidSocial(true);
    // The factory's publish writes music No: Yes again on top (disabled_uses isn't touched).
    const live = await publishVideo(draft, { containsMusic: true });
    expect(live.disabledUses).toEqual(["broadcast"]);
    const offered = async () => ({
      page: (await readLicensePageData(creator.handle, live.slug)) !== null,
      grid: (await listPublicVideos(creator.id)).map((card) => card.id),
    });
    expect(await offered()).toEqual({ page: true, grid: [live.id] });

    await paidSocial(false);
    expect(await offered()).toEqual({ page: false, grid: [] });
    await paidSocial(true);
    expect(await offered()).toEqual({ page: true, grid: [live.id] });
  });
});

describe("the video row lock (AD-02)", () => {
  it("two Switches saved at once both land: the second waits for the row and builds on the first's write", async () => {
    const { actor, live } = await pricedVideo(MUSIC_YES);
    const attempts: Promise<unknown>[] = [];
    // Another transaction holds the video row (a licensing one, or a Rights save) while both Switches arrive.
    await db.transaction(async (tx) => {
      await tx
        .select({ id: video.id })
        .from(video)
        .where(eq(video.id, live.id))
        .for("update");
      for (const useKey of MUSIC_DISABLED_USES) {
        attempts.push(
          settled(
            setVideoUseEnabled(actor, {
              videoId: live.id,
              useKey,
              enabled: true,
            }),
          ),
        );
      }
      await waitForLockWaiter("select %for update", 2);
    });
    expect(await Promise.all(attempts)).toEqual([null, null]);
    expect((await videoRow(live.id)).disabledUses).toEqual([]);
    const rows = await auditsInOrder(live.id, "video.use_toggled");
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        toggled("paid_social", true),
        toggled("broadcast", true),
      ]),
    );
  });

  it("a Switch that waited sees the music No committed before it, and is refused", async () => {
    const { actor, live } = await pricedVideo(MUSIC_YES);
    let attempt: Promise<unknown> = Promise.resolve();
    await db.transaction(async (tx) => {
      await tx
        .select({ id: video.id })
        .from(video)
        .where(eq(video.id, live.id))
        .for("update");
      attempt = settled(
        setVideoUseEnabled(actor, {
          videoId: live.id,
          useKey: "paid_social",
          enabled: true,
        }),
      );
      await waitForLockWaiter("select %for update");
      await tx
        .update(video)
        .set({ containsMusic: false, disabledUses: [] })
        .where(eq(video.id, live.id));
    });
    expect(await attempt).toBeInstanceOf(NoMusicError);
    expect((await videoRow(live.id)).disabledUses).toEqual([]);
    expect(await auditsInOrder(live.id, "video.use_toggled")).toEqual([]);
  });
});
