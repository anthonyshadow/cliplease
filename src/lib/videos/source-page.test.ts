import { describe, expect, it } from "vitest";
import { connectStartHref } from "../../components/connections/connect-messages";
import { parseReturnTo } from "../../server/social/oauth-state";
import { APP_NAME } from "../app-name";
import type { SocialProviderId } from "../domain/values";
import { GENERIC_ERROR_MESSAGE } from "../result";
import { badgeText } from "./ownership";
import {
  type MakeLicensableCode,
  makeLicensableMessage,
  provenanceLine,
  SOURCE_PAGE_COPY,
  type SourceActionsView,
  type SourcePageState,
  sourceActionsView,
  sourceBadge,
  sourceMetaLine,
  sourceNotice,
  sourcePageState,
  sourceProvenanceLine,
  sourceStatsLine,
  viewOnAriaLabel,
  viewOnLabel,
} from "./source-page";
import { sourcePageHref } from "./steps";

const POST_ID = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";
const VIDEO_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const RETURN_TO = `/dashboard/videos/new?post=${POST_ID}`;

const READY: SourcePageState = { kind: "ready" };

const viewOf = (
  state: SourcePageState,
  refusal: MakeLicensableCode | null = null,
  platform: SocialProviderId = "mock",
) => sourceActionsView({ state, refusal, platform, postId: POST_ID });

describe("makeLicensableMessage (01 J5.2–J5.4, 07 D18, 04 §11.10)", () => {
  it.each<[MakeLicensableCode, SocialProviderId, string]>([
    ["needs_reconnect", "mock", "Reconnect Demo to verify this post"],
    ["needs_reconnect", "youtube", "Reconnect YouTube to verify this post"],
    [
      "not_on_account",
      "mock",
      "We couldn't find this post on your Demo account. Sync and try again.",
    ],
    [
      "not_on_account",
      "instagram",
      "We couldn't find this post on your Instagram account. Sync and try again.",
    ],
    [
      "not_public",
      "youtube",
      "Make it public or unlisted on YouTube first, or upload it instead.",
    ],
    [
      "already_licensable_elsewhere",
      "mock",
      `This post is already licensable from another ${APP_NAME} account.`,
    ],
    ["upstream", "mock", "Something went wrong. Try again."],
  ])("%s on %s reads %j", (code, platform, message) => {
    expect(makeLicensableMessage(code, platform)).toBe(message);
  });

  it("uses the shared generic line for a platform failure", () => {
    expect(makeLicensableMessage("upstream", "tiktok")).toBe(
      GENERIC_ERROR_MESSAGE,
    );
  });
});

describe("sourcePageState (05 §6.5 States, first match)", () => {
  const post = {
    video: null,
    visibility: "public",
    accountStatus: "connected",
    accountUsername: "demo.creator",
    accountDisplayName: "Demo Creator",
  } as const;
  const nameless = {
    ...post,
    accountUsername: null,
    accountDisplayName: null,
  } as const;

  it("is ready for a public post on a connected account", () => {
    expect(sourcePageState(post)).toEqual(READY);
    expect(sourcePageState({ ...post, visibility: "unlisted" })).toEqual(READY);
    expect(sourcePageState({ ...post, visibility: null })).toEqual(READY);
  });

  it("puts already licensable first, then private, then needs reconnect", () => {
    const video = { id: VIDEO_ID, status: "draft" } as const;
    expect(
      sourcePageState({
        ...post,
        video,
        visibility: "private",
        accountStatus: "needs_reconnect",
      }),
    ).toEqual({ kind: "already_licensable", videoId: VIDEO_ID });
    expect(
      sourcePageState({
        ...post,
        visibility: "private",
        accountStatus: "needs_reconnect",
      }),
    ).toEqual({ kind: "private" });
    expect(
      sourcePageState({ ...post, accountStatus: "needs_reconnect" }),
    ).toEqual({ kind: "needs_reconnect" });
    expect(sourcePageState({ ...post, accountStatus: "disconnected" })).toEqual(
      { kind: "needs_reconnect" },
    );
  });

  it("shows the reconnect state for an account with neither a handle nor a name", () => {
    expect(sourcePageState(nameless)).toEqual({ kind: "needs_reconnect" });
    expect(sourcePageState({ ...nameless, visibility: "private" })).toEqual({
      kind: "private",
    });
  });
});

describe("sourceActionsView (05 §6.5 callouts 6–7 and States; owner answers Q-62 a)", () => {
  const makeLicensable = { kind: "make_licensable" } as const;
  const badge = { kind: "badge" } as const;
  const notPublic: SourceActionsView = {
    preview: null,
    notPublic: {
      line: "Make it public or unlisted on YouTube first, or upload it instead.",
      upload: { label: "Upload a file", href: "/dashboard/videos/new" },
    },
    banner: null,
    primary: null,
  };
  const reconnect: SourceActionsView = {
    preview: { kind: "reconnect", line: "Reconnect Demo to verify this post" },
    notPublic: null,
    banner: null,
    primary: {
      kind: "reconnect",
      label: "Reconnect Demo",
      returnTo: RETURN_TO,
    },
  };

  it("ready: the badge preview and Make licensable, nothing else", () => {
    expect(viewOf(READY)).toEqual({
      preview: badge,
      notPublic: null,
      banner: null,
      primary: makeLicensable,
    });
  });

  it.each<MakeLicensableCode | null>([
    null,
    "needs_reconnect",
    "not_on_account",
    "not_public",
    "already_licensable_elsewhere",
    "upstream",
  ])(
    "already licensable (refusal %s): the info Banner and Open video, no preview",
    (refusal) => {
      expect(
        viewOf({ kind: "already_licensable", videoId: VIDEO_ID }, refusal),
      ).toEqual({
        preview: null,
        notPublic: null,
        banner: {
          tone: "info",
          message: "This post is already licensable.",
          link: null,
          fromAction: false,
        },
        primary: {
          kind: "open_video",
          label: "Open video",
          href: `/dashboard/videos/${VIDEO_ID}`,
        },
      });
    },
  );

  it("private, cached or found by the press: the line and Upload a file, with no badge and no primary", () => {
    expect(viewOf({ kind: "private" })).toEqual(notPublic);
    expect(viewOf({ kind: "private" }, "upstream")).toEqual(notPublic);
    expect(viewOf(READY, "not_public")).toEqual(notPublic);
  });

  it("needs reconnect, cached or found by the press: the reconnect line and Reconnect back to this page", () => {
    expect(viewOf({ kind: "needs_reconnect" })).toEqual(reconnect);
    expect(viewOf(READY, "needs_reconnect")).toEqual(reconnect);
    expect(viewOf({ kind: "needs_reconnect" }, null, "youtube")).toEqual({
      ...reconnect,
      preview: {
        kind: "reconnect",
        line: "Reconnect YouTube to verify this post",
      },
      primary: { ...reconnect.primary, label: "Reconnect YouTube" },
    });
  });

  it("not on the account: the error Banner with Open Library, and Make licensable stays", () => {
    expect(viewOf(READY, "not_on_account")).toEqual({
      preview: badge,
      notPublic: null,
      banner: {
        tone: "error",
        message:
          "We couldn't find this post on your Demo account. Sync and try again.",
        link: { label: "Open Library", href: "/dashboard/library" },
        fromAction: true,
      },
      primary: makeLicensable,
    });
  });

  it("already licensable elsewhere: the error Banner and no primary", () => {
    expect(viewOf(READY, "already_licensable_elsewhere")).toEqual({
      preview: badge,
      notPublic: null,
      banner: {
        tone: "error",
        message: `This post is already licensable from another ${APP_NAME} account.`,
        link: null,
        fromAction: true,
      },
      primary: null,
    });
  });

  it("a platform failure: the generic line, with Make licensable as the retry", () => {
    expect(viewOf(READY, "upstream")).toEqual({
      preview: badge,
      notPublic: null,
      banner: {
        tone: "error",
        message: GENERIC_ERROR_MESSAGE,
        link: null,
        fromAction: true,
      },
      primary: makeLicensable,
    });
  });

  it("Reconnect's start link comes back to this Source page (07 D37: parseReturnTo keeps `post`)", () => {
    const { primary } = viewOf({ kind: "needs_reconnect" });
    if (primary?.kind !== "reconnect") throw new Error("no Reconnect");
    expect(primary.returnTo).toBe(sourcePageHref(POST_ID));
    const href = connectStartHref("mock", primary.returnTo);
    expect(href).toBe(
      `/api/connect/mock/start?returnTo=${encodeURIComponent(RETURN_TO)}`,
    );
    const returnTo = new URL(href, "http://localhost").searchParams.get(
      "returnTo",
    );
    const landing = parseReturnTo(returnTo);
    expect(`${landing.pathname}${landing.search}`).toBe(RETURN_TO);
  });
});

describe("the post's lines", () => {
  const demo = {
    platform: "mock",
    accountUsername: "demo.creator",
    accountDisplayName: "Demo Creator",
    accountConnectedAt: "2026-10-12T09:00:00.000Z",
    postedAt: "2026-10-01T15:00:00.000Z",
    durationSec: 14,
    viewCount: 14_800_000,
    likeCount: 888_000,
    commentCount: 44_400,
  } as const;

  it("provenance: platform, the account as the badge names it, the posted date; no · Verified (05 callout 5)", () => {
    expect(sourceProvenanceLine(demo)).toBe(
      "From Demo · @demo.creator · posted 1 Oct 2026",
    );
    expect(
      sourceProvenanceLine({ ...demo, accountUsername: "@demo.creator" }),
    ).toBe("From Demo · @demo.creator · posted 1 Oct 2026");
    expect(
      sourceProvenanceLine({
        ...demo,
        platform: "youtube",
        accountUsername: null,
        accountDisplayName: "Maya Films",
      }),
    ).toBe("From YouTube · Maya Films · posted 1 Oct 2026");
    expect(
      sourceProvenanceLine({
        ...demo,
        accountUsername: null,
        accountDisplayName: null,
        postedAt: null,
      }),
    ).toBe("From Demo");
  });

  it("the badge preview is built from the account (05 callout 6), and fails closed without a name", () => {
    const input = sourceBadge(demo);
    expect(input).toEqual({
      size: "lg",
      ownership: "verified_owner",
      provider: "mock",
      platformLabel: "Demo",
      verifiedUsername: "@demo.creator",
      linkedAt: "2026-10-12T09:00:00.000Z",
      noLongerLinked: false,
    });
    if (!input) throw new Error("no badge");
    expect(badgeText(input)).toEqual({
      line1: "Verified · @demo.creator (demo account)",
      line2: "Account linked 12 Oct 2026",
      line3: null,
    });
    const channel = sourceBadge({
      ...demo,
      platform: "youtube",
      accountUsername: null,
      accountDisplayName: "Maya Films",
    });
    if (!channel) throw new Error("no badge");
    expect(badgeText(channel).line1).toBe("Verified · Maya Films on YouTube");
    expect(
      sourceBadge({ ...demo, accountUsername: " ", accountDisplayName: null }),
    ).toBeNull();
  });

  it("meta: platform · date · duration, no duration on Instagram", () => {
    expect(sourceMetaLine(demo)).toBe("Demo · 1 Oct 2026 · 0:14");
    expect(sourceMetaLine({ ...demo, platform: "instagram" })).toBe(
      "Instagram · 1 Oct 2026",
    );
    expect(sourceMetaLine({ ...demo, postedAt: null, durationSec: null })).toBe(
      "Demo",
    );
  });

  it("stats: every count with its noun, never summed, a missing one left out (05 callout 3)", () => {
    expect(sourceStatsLine(demo)).toBe(
      "14.8M views · 888K likes · 44.4K comments",
    );
    expect(sourceStatsLine({ ...demo, platform: "instagram" })).toBe(
      "888K likes · 44.4K comments",
    );
    expect(
      sourceStatsLine({
        ...demo,
        viewCount: 1,
        likeCount: null,
        commentCount: 1,
      }),
    ).toBe("1 view · 1 comment");
    expect(
      sourceStatsLine({
        ...demo,
        viewCount: null,
        likeCount: null,
        commentCount: null,
      }),
    ).toBeNull();
  });

  it("View on {Platform} ↗ keeps its words in its name (owner answer Q-65 a)", () => {
    expect(viewOnLabel("mock")).toBe("View on Demo ↗");
    expect(viewOnAriaLabel("mock")).toBe("View on Demo (opens in a new tab)");
    expect(viewOnAriaLabel("tiktok")).toBe(
      "View on TikTok (opens in a new tab)",
    );
  });

  it("keeps the fixed words of 01 and 05", () => {
    expect(SOURCE_PAGE_COPY).toMatchObject({
      buyersWillSee: "Buyers will see:",
      makeLicensable: "Make licensable",
      verifying: "Verifying…",
      openVideo: "Open video",
      uploadFile: "Upload a file",
      openLibrary: "Open Library",
    });
  });
});

describe("provenanceLine (05 §6.5 callout 9)", () => {
  const DEMO = {
    platform: "mock",
    name: "@demo.creator",
    postedAt: "2026-10-01T15:00:00.000Z",
    verified: true,
  } as const;

  it("reads the platform, the stored username, the post date and Verified", () => {
    expect(provenanceLine(DEMO)).toBe(
      "From Demo · @demo.creator · posted 1 Oct 2026 · Verified",
    );
  });

  it("prints the username as stored, never adding an @ (07 D43)", () => {
    expect(
      provenanceLine({ ...DEMO, platform: "youtube", name: "Maya Films" }),
    ).toBe("From YouTube · Maya Films · posted 1 Oct 2026 · Verified");
    expect(provenanceLine({ ...DEMO, name: "@maya.films" })).not.toContain(
      "@@",
    );
  });

  it("dates the post in UTC", () => {
    expect(
      provenanceLine({ ...DEMO, postedAt: "2026-09-30T23:30:00.000-05:00" }),
    ).toBe("From Demo · @demo.creator · posted 1 Oct 2026 · Verified");
  });

  it("leaves out what is unknown: no date after a stale scrub (07 D72), no username", () => {
    expect(provenanceLine({ ...DEMO, postedAt: null })).toBe(
      "From Demo · @demo.creator · Verified",
    );
    expect(provenanceLine({ ...DEMO, name: null })).toBe(
      "From Demo · posted 1 Oct 2026 · Verified",
    );
  });

  it("drops Verified once the posting isn't verified (a release keeps its fields, 07 D66)", () => {
    expect(provenanceLine({ ...DEMO, verified: false })).toBe(
      "From Demo · @demo.creator · posted 1 Oct 2026",
    );
  });
});

describe("sourceNotice (01 J5.5)", () => {
  it("names the platform twice, verbatim", () => {
    expect(sourceNotice("mock")).toBe(
      "Demo doesn't share original files with apps. Upload the original from your phone or camera, the version without the Demo watermark.",
    );
    expect(sourceNotice("instagram")).toBe(
      "Instagram doesn't share original files with apps. Upload the original from your phone or camera, the version without the Instagram watermark.",
    );
  });
});
