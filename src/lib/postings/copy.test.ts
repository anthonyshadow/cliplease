import { describe, expect, it } from "vitest";
import { APP_NAME } from "../app-name";
import {
  POSTING_LINK_ERRORS,
  POSTING_PLATFORMS,
  POSTING_UNVERIFIED_REASONS,
  type PostingLinkError,
  type PostingPlatform,
  type PostingUnverifiedReason,
} from "../domain/values";
import { SOURCE_PAGE_COPY } from "../videos/source-page";
import {
  emptyLinkHelper,
  POSTING_LINK_PLACEHOLDERS,
  POSTINGS_COPY,
  type PostingResultContext,
  type PostingResultCopy,
  type PostingResultInput,
  postingActionLabel,
  postingChips,
  postingLinkErrorCopy,
  postingLiveMessage,
  postingResultCopy,
  refusedOnYourVideo,
  SAME_VIDEO_COPY,
  sourceRowTitle,
} from "./copy";
import { postingPlatformLabel } from "./labels";

const label = (platform: PostingPlatform) =>
  postingPlatformLabel(platform, null);

describe("POSTINGS_COPY (04 §11.10 “Where was it posted?”)", () => {
  it("has 04's strings, verbatim", () => {
    expect(POSTINGS_COPY).toEqual({
      title: "Where was it posted?",
      sub: "Pick every place you posted this video. Add the link to each post. Buyers see these.",
      linkLabel: "Link to the post",
      otherNameLabel: "Where? (for example, Vimeo)",
      otherNameMissing: "Add the name of the site.",
      addAnotherLink: "Add another link",
      remove: "Remove",
      limit: "You can add up to 12 places.",
      notPosted: "I haven't posted it anywhere yet.",
      nothingChosen: "Say where it was posted",
      fromLibrary: "From your Library",
      verified: "Verified",
      notVerified: "Not verified",
      showLink: "Show buyers this link",
      unlistedNote:
        "This video is unlisted. Buyers won't see the link unless you turn it on.",
      checking: "Checking the link…",
      move: "Move",
      noLongerLinked: "no longer linked",
      locked: "Turn off to edit where it was posted.",
      uploadNote:
        "Is this video on Instagram, TikTok or YouTube? Connect the account to get a Verified label.",
      connectAccount: "Connect an account",
      refusedPrivate:
        "Make it public or unlisted on YouTube first, or remove the link.",
      refusedElsewhere: `This post is already licensable from another ${APP_NAME} account.`,
    });
  });

  it("shares the elsewhere refusal with the Source page (07 D68)", () => {
    expect(POSTINGS_COPY.refusedElsewhere).toBe(SOURCE_PAGE_COPY.elsewhere);
  });

  it("names the creator's other video in curly quotes (07 D68)", () => {
    expect(refusedOnYourVideo("Snow day")).toBe(
      "This post is already on your video “Snow day”.",
    );
  });
});

describe("placeholders, chips and row lines (04 §9.33)", () => {
  it("gives each platform its placeholder; Other and Demo none", () => {
    expect(POSTING_LINK_PLACEHOLDERS).toEqual({
      instagram: "instagram.com/reel/…",
      tiktok: "tiktok.com/@you/video/…",
      youtube: "youtube.com/shorts/…",
      facebook: "facebook.com/reel/…",
      x: "x.com/you/status/…",
      snapchat: "snapchat.com/spotlight/…",
      other: null,
      mock: null,
    });
  });

  it("lists the chips in order, Demo last and only while mock is enabled", () => {
    const names = (allowMock: boolean) =>
      postingChips(allowMock).map((chip) => chip.label);
    expect(names(false)).toEqual([
      "Instagram",
      "TikTok",
      "YouTube",
      "Facebook",
      "X",
      "Snapchat",
      "Other",
    ]);
    expect(names(true)).toEqual([...names(false), "Demo"]);
    expect(postingChips(true).map((chip) => chip.platform)).toEqual([
      ...POSTING_PLATFORMS,
    ]);
  });

  it("words the empty helper with curly quotes, Other by its name", () => {
    expect(emptyLinkHelper("Instagram")).toBe(
      "Optional. Without a link, buyers see “Also posted on Instagram”.",
    );
    expect(emptyLinkHelper("Vimeo")).toBe(
      "Optional. Without a link, buyers see “Also posted on Vimeo”.",
    );
  });

  it("titles the source row and words the live region", () => {
    expect(sourceRowTitle("@demo.creator", "Demo")).toBe(
      "@demo.creator on Demo",
    );
    expect(postingLiveMessage("Demo", true)).toBe("Demo link verified");
    expect(postingLiveMessage("TikTok", false)).toBe(
      "TikTok link not verified",
    );
  });

  it("labels the four actions", () => {
    expect(postingActionLabel("sync_and_check", "Demo")).toBe(
      "Sync and check again",
    );
    expect(postingActionLabel("link_account", "Instagram")).toBe(
      "Link Instagram",
    );
    expect(postingActionLabel("reconnect", "Demo")).toBe("Reconnect Demo");
    expect(postingActionLabel("check_again", "Demo")).toBe("Check again");
  });
});

/** 04 §11.10's parse error strings, wrong_platform aside (below). */
const LINK_ERRORS: Record<
  Exclude<PostingLinkError, "wrong_platform">,
  (platformLabel: string) => string
> = {
  empty: () => "That doesn't look like a link.",
  not_a_url: () => "That doesn't look like a link.",
  too_long: () => "That link is too long. Paste the link to the post.",
  bad_host: (p) => `That link isn't from ${p}.`,
  short_link: () =>
    "That's a short link. Open it in your browser, then copy the full address from the address bar.",
  profile_link: () => "That's a profile link. Paste the link to the post.",
  not_a_video: () => "That's a photo post. Paste the link to the video.",
  unrecognized: (p) =>
    `We don't recognize this ${p} link. Paste the link to the post.`,
};

/** Owner answer Q-76 a: "an" before Instagram and X (and Other's vowel), "a" before every other name. */
const ARTICLES = {
  instagram: "an",
  tiktok: "a",
  youtube: "a",
  facebook: "a",
  x: "an",
  snapchat: "a",
  other: "an",
  mock: "a",
} satisfies Record<PostingPlatform, "a" | "an">;

describe("postingLinkErrorCopy (04 §11.10; owner answer Q-76 a)", () => {
  const VERIFIABLE = POSTING_PLATFORMS.filter((p) => p !== "other");

  it("covers every POSTING_LINK_ERRORS member", () => {
    expect(
      POSTING_LINK_ERRORS.filter((e) => e !== "wrong_platform").sort(),
    ).toEqual(Object.keys(LINK_ERRORS).sort());
  });

  describe.each(VERIFIABLE)("on the %s card", (platform) => {
    it.each(
      POSTING_LINK_ERRORS.filter(
        (error): error is Exclude<PostingLinkError, "wrong_platform"> =>
          error !== "wrong_platform",
      ),
    )("%s", (error) => {
      expect(postingLinkErrorCopy(error, { platform, otherLabel: null })).toBe(
        LINK_ERRORS[error](label(platform)),
      );
    });
  });

  it.each(POSTING_PLATFORMS)(
    "wrong_platform names a %s link with its article",
    (detected) => {
      expect(
        postingLinkErrorCopy("wrong_platform", {
          platform: "tiktok",
          otherLabel: null,
          detected,
        }),
      ).toBe(
        `This is ${ARTICLES[detected]} ${label(detected)} link. Move it there?`,
      );
    },
  );

  it("wrong_platform reads the e2e's Instagram line, also on the Other card", () => {
    const line = "This is an Instagram link. Move it there?";
    expect(
      postingLinkErrorCopy("wrong_platform", {
        platform: "tiktok",
        otherLabel: null,
        detected: "instagram",
      }),
    ).toBe(line);
    expect(
      postingLinkErrorCopy("wrong_platform", {
        platform: "other",
        otherLabel: "Vimeo",
        detected: "instagram",
      }),
    ).toBe(line);
    expect(
      postingLinkErrorCopy("wrong_platform", {
        platform: "tiktok",
        otherLabel: null,
        detected: "x",
      }),
    ).toBe("This is an X link. Move it there?");
  });

  it("wrong_platform without a detected platform reads as bad_host", () => {
    expect(
      postingLinkErrorCopy("wrong_platform", {
        platform: "tiktok",
        otherLabel: null,
      }),
    ).toBe("That link isn't from TikTok.");
  });

  it("Other's bad_host asks for a public web address; its other errors are the shared ones", () => {
    const other = { platform: "other", otherLabel: "Vimeo" } as const;
    expect(postingLinkErrorCopy("bad_host", other)).toBe(
      "Paste a public web address.",
    );
    expect(postingLinkErrorCopy("not_a_url", other)).toBe(
      "That doesn't look like a link.",
    );
    expect(postingLinkErrorCopy("too_long", other)).toBe(
      "That link is too long. Paste the link to the post.",
    );
  });

  it("names the card by postingPlatformLabel: Other by the creator's trimmed name for the site", () => {
    expect(
      postingLinkErrorCopy("unrecognized", {
        platform: "other",
        otherLabel: " Vimeo ",
      }),
    ).toBe("We don't recognize this Vimeo link. Paste the link to the post.");
  });

  it("words the save's private refusal (07 D68)", () => {
    expect(
      postingLinkErrorCopy("private", {
        platform: "youtube",
        otherLabel: null,
      }),
    ).toBe("Make it public or unlisted on YouTube first, or remove the link.");
  });
});

const CTX: PostingResultContext = {
  appName: APP_NAME,
  providerEnabled: true,
  hasConnectedAccount: true,
  onlyNeedsReconnect: false,
};

const row = (over: Partial<PostingResultInput> = {}): PostingResultInput => ({
  platform: "mock",
  label: "Demo",
  url: "https://example.com/mock/mock_post_c4180ab2_01",
  verification: "unverified",
  unverifiedReason: "not_found",
  verifiedUsername: null,
  accountStatus: null,
  ...over,
});

const unverified = (
  platform: PostingPlatform,
  reason: PostingUnverifiedReason,
  ctx: Partial<PostingResultContext> = {},
) =>
  postingResultCopy(
    row({
      platform,
      label: platform === "other" ? "Vimeo" : label(platform),
      unverifiedReason: reason,
    }),
    { ...CTX, ...ctx },
  );

/** 04 §9.33 / §11.10 per reason, with the default context (enabled provider, a connected account). */
const REASONS: Record<
  PostingUnverifiedReason,
  (platformLabel: string) => PostingResultCopy
> = {
  not_found: (p) => ({
    tone: "not_verified",
    text: `Not verified. This post isn't on any ${p} account you've linked.`,
    action: "sync_and_check",
  }),
  no_account: (p) => ({
    tone: "not_verified",
    text: `Not verified. Link your ${p} account to verify it.`,
    action: "check_again",
  }),
  check_failed: () => ({
    tone: "check_failed",
    text: "We couldn't check this right now.",
    action: "check_again",
  }),
  unverifiable: () => ({
    tone: "not_verified",
    text: "Links from Facebook, X and Snapchat can't be verified yet. Buyers will see “Not verified”.",
    action: null,
  }),
  no_link: (p) => ({
    tone: "empty",
    text: `Optional. Without a link, buyers see “Also posted on ${p}”.`,
    action: null,
  }),
  released: () => ({
    tone: "not_verified",
    text: `Not verified. This post was released when ${APP_NAME} turned the video off.`,
    action: "check_again",
  }),
};

describe("postingResultCopy (04 §9.33 Link field states, §11.10)", () => {
  it("covers every POSTING_UNVERIFIED_REASONS member", () => {
    expect([...POSTING_UNVERIFIED_REASONS].sort()).toEqual(
      Object.keys(REASONS).sort(),
    );
  });

  describe.each(["instagram", "tiktok", "youtube", "mock"] as const)(
    "a %s link",
    (platform) => {
      it.each(POSTING_UNVERIFIED_REASONS)("%s", (reason) => {
        expect(unverified(platform, reason)).toEqual(
          REASONS[reason](label(platform)),
        );
      });
    },
  );

  it("fills {APP_NAME} from the context", () => {
    expect(unverified("mock", "released", { appName: "Acme" }).text).toBe(
      "Not verified. This post was released when Acme turned the video off.",
    );
  });

  it("not_found → Sync and check again", () => {
    expect(unverified("instagram", "not_found").action).toBe("sync_and_check");
  });

  it("no_account → Link {Platform} only for an enabled provider with nothing connected", () => {
    const action = (ctx: Partial<PostingResultContext>) =>
      unverified("instagram", "no_account", ctx).action;
    expect(action({ hasConnectedAccount: false })).toBe("link_account");
    expect(
      action({ hasConnectedAccount: false, onlyNeedsReconnect: true }),
    ).toBe("link_account");
    expect(action({ hasConnectedAccount: true })).toBe("check_again");
    expect(action({ providerEnabled: false, hasConnectedAccount: false })).toBe(
      null,
    );
    expect(unverified("instagram", "no_account").text).toBe(
      "Not verified. Link your Instagram account to verify it.",
    );
  });

  it("check_failed → Reconnect {Platform} when every account there needs reconnecting, else Check again", () => {
    const action = (ctx: Partial<PostingResultContext>) =>
      unverified("mock", "check_failed", ctx).action;
    expect(
      action({ hasConnectedAccount: false, onlyNeedsReconnect: true }),
    ).toBe("reconnect");
    expect(action({ onlyNeedsReconnect: false })).toBe("check_again");
    expect(action({ providerEnabled: false, onlyNeedsReconnect: true })).toBe(
      "check_again",
    );
  });

  it.each(["facebook", "x", "snapchat"] as const)(
    "unverifiable %s → the Facebook, X and Snapchat line, no action",
    (platform) => {
      expect(
        unverified(platform, "unverifiable", { providerEnabled: false }),
      ).toEqual(REASONS.unverifiable(label(platform)));
    },
  );

  it("unverifiable Other → its own line, no action", () => {
    expect(
      unverified("other", "unverifiable", { providerEnabled: false }),
    ).toEqual({
      tone: "not_verified",
      text: "Links from other sites can't be verified. Buyers will see the site name, for example vimeo.com.",
      action: null,
    });
  });

  it("released → Check again", () => {
    expect(unverified("youtube", "released").action).toBe("check_again");
  });

  it.each(POSTING_UNVERIFIED_REASONS)(
    "a row with no link shows only the empty helper, whatever its reason (%s)",
    (reason) => {
      expect(
        postingResultCopy(row({ url: null, unverifiedReason: reason }), CTX),
      ).toEqual({
        tone: "empty",
        text: "Optional. Without a link, buyers see “Also posted on Demo”.",
        action: null,
      });
    },
  );

  it("an Other row with no link names the site", () => {
    expect(
      postingResultCopy(
        row({
          platform: "other",
          label: "Vimeo",
          url: null,
          unverifiedReason: "no_link",
        }),
        CTX,
      ).text,
    ).toBe("Optional. Without a link, buyers see “Also posted on Vimeo”.");
  });

  it("a verified row names its account, with no action", () => {
    expect(
      postingResultCopy(
        row({
          verification: "verified",
          unverifiedReason: null,
          verifiedUsername: "@demo.creator",
          accountStatus: "connected",
        }),
        CTX,
      ),
    ).toEqual({
      tone: "verified",
      text: "Verified · on @demo.creator",
      action: null,
    });
  });

  it("a verified row whose account is disconnected reads “· no longer linked” (07 D72)", () => {
    const verified = row({
      verification: "verified",
      unverifiedReason: null,
      verifiedUsername: "@demo.creator",
    });
    expect(
      postingResultCopy({ ...verified, accountStatus: "disconnected" }, CTX)
        .text,
    ).toBe("Verified · on @demo.creator · no longer linked");
    expect(
      postingResultCopy({ ...verified, accountStatus: "needs_reconnect" }, CTX)
        .text,
    ).toBe("Verified · on @demo.creator");
  });

  it("an unverified row without its reason (never stored, CHECK video_posting_reason) offers a fresh check", () => {
    expect(postingResultCopy(row({ unverifiedReason: null }), CTX)).toEqual({
      tone: "not_verified",
      text: "Not verified",
      action: "check_again",
    });
  });
});

describe("SAME_VIDEO_COPY (07 D69; owner answer Q-75 a)", () => {
  it("has the tick, its missing-tick error and the cover's caption", () => {
    expect(SAME_VIDEO_COPY.tick).toBe("These posts show this same video");
    expect(SAME_VIDEO_COPY.missingTick).toBe(
      "Confirm these posts show this same video",
    );
    expect(SAME_VIDEO_COPY.cover).toBe("Cover image");
  });

  it("captions one post “Post” and several by platform", () => {
    expect(SAME_VIDEO_COPY.postCaption("Demo", false)).toBe("Post");
    expect(SAME_VIDEO_COPY.postCaption("Demo", true)).toBe("Demo post");
    expect(SAME_VIDEO_COPY.postCaption("YouTube", true)).toBe("YouTube post");
  });
});
