import { describe, expect, it } from "vitest";
import { PUBLISH_BLOCKERS, type PublishBlocker } from "@/lib/videos/review";
import { effectiveOptions } from "../pricing/rate-card";
import { rateCardFixture } from "../pricing/rate-card-fixtures";
import { computePublishBlockers, type PublishFacts } from "./publish";

const ALL_ON = effectiveOptions(rateCardFixture(), {
  disabledUses: [],
  basePriceOverrideCents: null,
});

/** A video nothing blocks: original ready, a cover, postings and the tick saved, rights answered, a valid link. */
const READY: PublishFacts = {
  status: "draft",
  originalStatus: "ready",
  source: "library",
  hasPoster: true,
  postingsConfirmedAt: "2026-10-24T12:00:00.000Z",
  hasVerifiedPosting: true,
  sameVideoConfirmed: true,
  rightsAnswered: true,
  slug: "he-saw-snow",
  options: ALL_ON,
  verifiedPostings: [{ platform: "mock", reconnect: false }],
};

/** Each blocker's facts, changed from READY so that it alone applies. */
const ALONE: Record<PublishBlocker, Partial<PublishFacts>> = {
  original_not_ready: { originalStatus: "uploading" },
  poster_required: { hasPoster: false },
  postings_unconfirmed: { postingsConfirmedAt: null },
  same_video_unconfirmed: { sameVideoConfirmed: false },
  not_attested: { rightsAnswered: false },
  no_enabled_option: {
    options: {
      ...ALL_ON,
      term: ALL_ON.term.map((t) => ({ ...t, enabled: false })),
    },
  },
  invalid_slug: { slug: "Not A Slug" },
  disabled_by_admin: { status: "disabled" },
  reconnect_account: {
    verifiedPostings: [{ platform: "mock", reconnect: true }],
  },
};

describe("computePublishBlockers (02 §5.6; 07 §8.2)", () => {
  it("is empty for a video nothing blocks", () => {
    expect(computePublishBlockers(READY)).toEqual([]);
  });

  it.each(PUBLISH_BLOCKERS)("finds %s alone", (blocker) => {
    expect(computePublishBlockers({ ...READY, ...ALONE[blocker] })).toEqual([
      blocker,
    ]);
  });

  it("lists every blocker in the Review's order", () => {
    const all: PublishFacts = Object.assign({}, READY, ...Object.values(ALONE));
    expect(computePublishBlockers(all)).toEqual([...PUBLISH_BLOCKERS]);
  });

  it("asks for the same-video tick only once a posting is verified", () => {
    expect(
      computePublishBlockers({
        ...READY,
        sameVideoConfirmed: false,
        hasVerifiedPosting: false,
        verifiedPostings: [],
      }),
    ).toEqual([]);
  });

  it("finds no_enabled_option once music turns off the only uses left on", () => {
    const musicOnly = effectiveOptions(
      rateCardFixture((o) =>
        o.key === "organic_social" ? { enabled: false } : {},
      ),
      {
        disabledUses: ["paid_social", "broadcast"],
        basePriceOverrideCents: null,
      },
    );
    expect(computePublishBlockers({ ...READY, options: musicOnly })).toEqual([
      "no_enabled_option",
    ]);
  });

  it("takes a link of 61 characters as invalid, and 60 as valid", () => {
    expect(computePublishBlockers({ ...READY, slug: "a".repeat(60) })).toEqual(
      [],
    );
    expect(computePublishBlockers({ ...READY, slug: "a".repeat(61) })).toEqual([
      "invalid_slug",
    ]);
  });
});
