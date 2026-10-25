import { describe, expect, it } from "vitest";
import {
  disabledLine,
  editRowLabel,
  PUBLISH_BLOCKERS,
  postingSummaryLine,
  publishBlockerRows,
} from "./review";

const ID = "00000000-0000-4000-8000-000000000002";
const STEP = `/dashboard/videos/${ID}?step=`;

describe("publishBlockerRows (05 §6.5 callout 51; owner answer Q-98 a)", () => {
  it("gives each blocker its row and where it is fixed, in blocker order", () => {
    expect(publishBlockerRows(PUBLISH_BLOCKERS, ID, ["instagram"])).toEqual([
      {
        key: "original_not_ready",
        kind: "page",
        label: "Attach the original file",
        href: `${STEP}file`,
      },
      {
        key: "poster_required",
        kind: "anchor",
        label: "Add a cover image for buyers",
        href: "#cover-image",
      },
      {
        key: "postings_unconfirmed",
        kind: "page",
        label: "Say where it was posted",
        href: `${STEP}postings`,
      },
      {
        key: "same_video_unconfirmed",
        kind: "page",
        label: "Confirm these posts show this same video",
        href: `${STEP}postings`,
      },
      {
        key: "not_attested",
        kind: "page",
        label: "Answer the rights questions",
        href: `${STEP}rights`,
      },
      {
        key: "no_enabled_option",
        kind: "page",
        label: "Turn on at least one use, term and territory",
        href: "/dashboard/pricing",
      },
      {
        key: "invalid_slug",
        kind: "anchor",
        label: "Fix the link",
        href: "#video-link",
      },
      {
        key: "reconnect:instagram",
        kind: "reconnect",
        label: "Reconnect Instagram to publish.",
        platform: "instagram",
        returnTo: `${STEP}review`,
      },
    ]);
  });

  it("gives disabled_by_admin no row (its Banner says it)", () => {
    expect(publishBlockerRows(["disabled_by_admin"], ID, [])).toEqual([]);
  });

  it("gives one reconnect row per platform, named", () => {
    expect(
      publishBlockerRows(["reconnect_account"], ID, ["mock", "tiktok"]).map(
        (row) => row.label,
      ),
    ).toEqual(["Reconnect Demo to publish.", "Reconnect TikTok to publish."]);
  });

  it("on the video page, jumps to its Original file section and reconnects back to the page (Turn on, P14b)", () => {
    expect(
      publishBlockerRows(
        ["original_not_ready", "reconnect_account"],
        ID,
        ["mock"],
        "video_page",
      ),
    ).toEqual([
      {
        key: "original_not_ready",
        kind: "anchor",
        label: "Attach the original file",
        href: "#original-file",
      },
      {
        key: "reconnect:mock",
        kind: "reconnect",
        label: "Reconnect Demo to publish.",
        platform: "mock",
        returnTo: `/dashboard/videos/${ID}`,
      },
    ]);
  });
});

describe("editRowLabel", () => {
  it("names the row an Edit acts on", () => {
    expect(editRowLabel("Cover image")).toBe("Edit cover image");
  });
});

describe("postingSummaryLine (05 §6.5 callout 46)", () => {
  const posting = {
    platform: "instagram" as const,
    label: "Instagram",
    verification: "unverified" as const,
    verifiedUsername: null,
    url: null,
  };

  it("reads verified, not verified, link-less and Other postings", () => {
    expect(
      postingSummaryLine({
        ...posting,
        verification: "verified",
        verifiedUsername: "@maya.films",
        url: "https://www.instagram.com/reel/C0dEaBcDeF1/",
      }),
    ).toBe("Instagram · @maya.films · Verified");
    expect(
      postingSummaryLine({
        ...posting,
        url: "https://www.instagram.com/reel/C0dEaBcDeF1/",
      }),
    ).toBe("Instagram · Not verified");
    expect(postingSummaryLine(posting)).toBe("Also posted on Instagram");
    expect(
      postingSummaryLine({ ...posting, platform: "other", label: "Vimeo" }),
    ).toBe("Vimeo");
  });

  it("never shows the link itself", () => {
    const url = "https://www.tiktok.com/@maya/video/7300000000000000000";
    expect(
      postingSummaryLine({
        ...posting,
        platform: "tiktok",
        label: "TikTok",
        url,
      }),
    ).not.toContain(url);
  });
});

describe("disabledLine", () => {
  it("names the admin's reason and the support address", () => {
    expect(disabledLine("rights_claim")).toBe(
      "Disabled by ClipLease: Rights claim. Questions? support@example.com",
    );
  });
});
