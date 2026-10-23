import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PostingUnverifiedReason } from "../../lib/domain/values";
import { postingsInputChanged } from "../../lib/postings/form";
import type { PlannedPosting } from "../../lib/postings/plan";
import {
  newPostingColumns,
  type PostingInput,
  recheckColumns,
  saveVideoPostingsInput,
  type VerifiedPostingNow,
} from "./save";
import type { PostingCheckResult } from "./verify";

const registry = vi.hoisted(() => ({ enabled: ["mock"] as string[] }));
vi.mock("../social/registry", () => ({
  enabledPlatforms: () => registry.enabled,
  mockEnabled: () => registry.enabled.includes("mock"),
  getProvider: () => null,
}));

const VIDEO_ID = "6f1c2b8e-3d4a-4c5b-9e6f-7a8b9c0d1e2f";
const NOW = new Date("2026-10-21T12:00:00.000Z");
const MOCK_ID = "mock_post_c4180ab2_01";
const MOCK_URL = `https://example.com/mock/${MOCK_ID}`;

function input(postings: PostingInput[], notPosted = false) {
  return { videoId: VIDEO_ID, notPosted, postings };
}

/** The issue paths of a refused input, joined with dots. */
function refusedPaths(value: unknown): string[] {
  const parsed = saveVideoPostingsInput.safeParse(value);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => issue.path.join("."));
}

describe("saveVideoPostingsInput feeding postingsInputChanged (the Where-posted Continue)", () => {
  it("tidies Other's name first, so an untidied copy of the saved name is no change", () => {
    const vimeo = "https://vimeo.com/123456789";
    const saved = {
      platform: "other" as const,
      label: "Vimeo",
      url: vimeo,
      isSource: false,
      showLink: true,
      position: 1,
    };
    const parsed = saveVideoPostingsInput.parse(
      input([{ platform: "other", otherLabel: "  Vimeo \n", link: vimeo }]),
    );
    expect(postingsInputChanged([saved], parsed, { allowMock: true })).toBe(
      false,
    );
    const renamed = saveVideoPostingsInput.parse(
      input([{ platform: "other", otherLabel: "Dailymotion", link: vimeo }]),
    );
    expect(postingsInputChanged([saved], renamed, { allowMock: true })).toBe(
      true,
    );
  });
});

describe("saveVideoPostingsInput", () => {
  beforeEach(() => {
    registry.enabled = ["mock"];
  });

  it("takes up to POSTINGS_MAX rows and refuses one more", () => {
    const rows = (n: number) =>
      Array.from({ length: n }, (): PostingInput => ({ platform: "x" }));
    expect(saveVideoPostingsInput.safeParse(input(rows(12))).success).toBe(
      true,
    );
    expect(refusedPaths(input(rows(13)))).toEqual(["postings"]);
  });

  it("requires Other's name, tidied, 1 to 40 characters", () => {
    const parsed = saveVideoPostingsInput.parse(
      input([{ platform: "other", otherLabel: "  My\n  site​ " }]),
    );
    expect(parsed.postings[0]?.otherLabel).toBe("My site");
    expect(
      saveVideoPostingsInput.safeParse(
        input([{ platform: "other", otherLabel: "a".repeat(40) }]),
      ).success,
    ).toBe(true);
    for (const otherLabel of [undefined, "   ", "a".repeat(41)]) {
      expect(refusedPaths(input([{ platform: "other", otherLabel }]))).toEqual([
        "postings.0.otherLabel",
      ]);
    }
  });

  it("refuses a name on every platform but Other", () => {
    expect(
      refusedPaths(
        input([
          { platform: "youtube" },
          { platform: "instagram", otherLabel: "Insta" },
        ]),
      ),
    ).toEqual(["postings.1.otherLabel"]);
  });

  it("takes Demo only while mock is enabled", () => {
    const demo = input([{ platform: "mock", link: MOCK_URL }]);
    expect(saveVideoPostingsInput.safeParse(demo).success).toBe(true);
    registry.enabled = ["youtube"];
    expect(refusedPaths(demo)).toEqual(["postings.0.platform"]);
  });

  it("takes notPosted alone and refuses it with postings", () => {
    expect(saveVideoPostingsInput.safeParse(input([], true)).success).toBe(
      true,
    );
    expect(refusedPaths(input([{ platform: "x" }], true))).toEqual([
      "notPosted",
    ]);
  });

  it("refuses a paste over 2,048 characters and a video id that isn't a uuid", () => {
    const long = `https://vimeo.com/${"1".repeat(2048 - 18 + 1)}`;
    expect(
      refusedPaths(
        input([{ platform: "other", otherLabel: "Vimeo", link: long }]),
      ),
    ).toEqual(["postings.0.link"]);
    expect(refusedPaths({ ...input([]), videoId: "video-1" })).toEqual([
      "videoId",
    ]);
  });

  it("takes the source row's Switch as an optional boolean (owner answer Q-73 a)", () => {
    expect(saveVideoPostingsInput.parse(input([])).sourceShowLink).toBe(
      undefined,
    );
    for (const sourceShowLink of [true, false]) {
      expect(
        saveVideoPostingsInput.parse({ ...input([]), sourceShowLink })
          .sourceShowLink,
      ).toBe(sourceShowLink);
    }
    for (const sourceShowLink of ["true", "on", 1, null]) {
      expect(refusedPaths({ ...input([]), sourceShowLink })).toEqual([
        "sourceShowLink",
      ]);
    }
  });
});

const ROW: PlannedPosting = {
  index: 0,
  platform: "mock",
  otherLabel: null,
  url: MOCK_URL,
  linkKey: MOCK_ID,
  showLink: undefined,
};

const LINKED_AT = new Date("2026-10-01T09:00:00.000Z");

function verifiedCheck(
  visibility: "public" | "unlisted" | null = "public",
): PostingCheckResult {
  return {
    verification: "verified",
    socialAccountId: "acct-1",
    socialPostId: "post-1",
    verifiedUsername: "@demo.creator",
    verifiedAccountLinkedAt: LINKED_AT,
    visibility,
  };
}

function unverifiedCheck(reason: PostingUnverifiedReason): PostingCheckResult {
  return { verification: "unverified", reason };
}

const KEPT: VerifiedPostingNow = {
  socialAccountId: "acct-0",
  socialPostId: "post-0",
  verifiedUsername: "@demo.creator",
  verifiedAccountLinkedAt: new Date("2026-09-01T09:00:00.000Z"),
  verifiedAt: new Date("2026-10-02T09:00:00.000Z"),
  checkedAt: new Date("2026-10-03T09:00:00.000Z"),
  showLink: false,
};

const LINK_COLUMNS = {
  platform: "mock",
  otherLabel: null,
  url: MOCK_URL,
  linkKey: MOCK_ID,
};

describe("newPostingColumns", () => {
  it("writes a verified check: verified and checked now, with the account and the post", () => {
    expect(newPostingColumns(ROW, verifiedCheck(), undefined, NOW)).toEqual({
      ...LINK_COLUMNS,
      verification: "verified",
      unverifiedReason: null,
      socialAccountId: "acct-1",
      socialPostId: "post-1",
      verifiedUsername: "@demo.creator",
      verifiedAccountLinkedAt: LINKED_AT,
      verifiedAt: NOW,
      checkedAt: NOW,
      showLink: true,
    });
  });

  it("hides an unlisted post's link unless the input says otherwise (07 D18)", () => {
    const showLink = (row: PlannedPosting, visibility: "unlisted" | null) =>
      newPostingColumns(row, verifiedCheck(visibility), undefined, NOW)
        .showLink;
    expect(showLink(ROW, "unlisted")).toBe(false);
    expect(showLink({ ...ROW, showLink: true }, "unlisted")).toBe(true);
    expect(showLink(ROW, null)).toBe(true);
    expect(showLink({ ...ROW, showLink: false }, null)).toBe(false);
  });

  it("keeps the show_link of a post this video already held verified when the input sends none: a Switch turned on stays on", () => {
    const shown = { ...KEPT, showLink: true };
    const showLink = (row: PlannedPosting, kept: typeof KEPT) =>
      newPostingColumns(row, verifiedCheck("unlisted"), kept, NOW).showLink;
    expect(showLink(ROW, shown)).toBe(true);
    expect(showLink(ROW, KEPT)).toBe(false);
    expect(showLink({ ...ROW, showLink: false }, shown)).toBe(false);
  });

  it.each<[PostingUnverifiedReason, string, Date | null]>([
    ["check_failed", "checked now: a check ran and failed (Q-69 a)", NOW],
    [
      "no_account",
      "its checked_at kept: no check ran (Q-70 a)",
      KEPT.checkedAt,
    ],
  ])(
    "keeps a posting verified on this video when the check gives %s, %s",
    (reason, _, checkedAt) => {
      expect(
        newPostingColumns(ROW, unverifiedCheck(reason), KEPT, NOW),
      ).toEqual({
        ...LINK_COLUMNS,
        verification: "verified",
        unverifiedReason: null,
        socialAccountId: "acct-0",
        socialPostId: "post-0",
        verifiedUsername: "@demo.creator",
        verifiedAccountLinkedAt: KEPT.verifiedAccountLinkedAt,
        verifiedAt: KEPT.verifiedAt,
        checkedAt,
        showLink: false,
      });
      expect(
        newPostingColumns(
          { ...ROW, showLink: true },
          unverifiedCheck(reason),
          KEPT,
          NOW,
        ).showLink,
      ).toBe(true);
    },
  );

  it.each<PostingUnverifiedReason>(["check_failed", "no_account", "not_found"])(
    "saves %s as Not verified, checked now, when the post isn't verified on this video",
    (reason) => {
      expect(
        newPostingColumns(ROW, unverifiedCheck(reason), undefined, NOW),
      ).toEqual({
        ...LINK_COLUMNS,
        verification: "unverified",
        unverifiedReason: reason,
        socialAccountId: null,
        socialPostId: null,
        verifiedUsername: null,
        verifiedAccountLinkedAt: null,
        verifiedAt: null,
        checkedAt: NOW,
        showLink: true,
      });
    },
  );

  it("downgrades a posting verified on this video when its post isn't found", () => {
    expect(
      newPostingColumns(ROW, unverifiedCheck("not_found"), KEPT, NOW),
    ).toMatchObject({
      verification: "unverified",
      unverifiedReason: "not_found",
      socialAccountId: null,
      verifiedAt: null,
      checkedAt: NOW,
    });
  });

  it.each<PostingUnverifiedReason>(["unverifiable", "no_link"])(
    "leaves checked_at null for %s: no check ran",
    (reason) => {
      expect(
        newPostingColumns(
          { ...ROW, platform: "x", url: null, linkKey: null },
          unverifiedCheck(reason),
          undefined,
          NOW,
        ),
      ).toMatchObject({
        verification: "unverified",
        unverifiedReason: reason,
        checkedAt: null,
      });
    },
  );
});

describe("recheckColumns", () => {
  it("writes a verified check's fields, verified now, whatever the posting was", () => {
    for (const wasVerified of [true, false]) {
      expect(recheckColumns(verifiedCheck(), wasVerified, NOW)).toEqual({
        verification: "verified",
        unverifiedReason: null,
        socialAccountId: "acct-1",
        socialPostId: "post-1",
        verifiedUsername: "@demo.creator",
        verifiedAccountLinkedAt: LINKED_AT,
        verifiedAt: NOW,
        checkedAt: NOW,
      });
    }
  });

  it("moves only checked_at on a verified posting given check_failed (Q-69 a)", () => {
    expect(recheckColumns(unverifiedCheck("check_failed"), true, NOW)).toEqual({
      checkedAt: NOW,
    });
  });

  it("writes nothing on a verified posting given no_account: no check ran (Q-70 a)", () => {
    expect(recheckColumns(unverifiedCheck("no_account"), true, NOW)).toBeNull();
  });

  it("writes only the verification and the reason otherwise, so a released posting keeps its social ids", () => {
    expect(recheckColumns(unverifiedCheck("not_found"), true, NOW)).toEqual({
      verification: "unverified",
      unverifiedReason: "not_found",
      checkedAt: NOW,
    });
    for (const reason of ["check_failed", "no_account"] as const) {
      expect(recheckColumns(unverifiedCheck(reason), false, NOW)).toEqual({
        verification: "unverified",
        unverifiedReason: reason,
        checkedAt: NOW,
      });
    }
  });
});
