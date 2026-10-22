import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PostingUnverifiedReason } from "../../lib/domain/values";
import {
  newPostingColumns,
  type PlannedPosting,
  type PostingInput,
  planPostings,
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
});

describe("planPostings", () => {
  const plan = (
    postings: PostingInput[],
    source: Parameters<typeof planPostings>[1]["source"] = null,
    allowMock = true,
  ) => planPostings(postings, { allowMock, source });

  it("reads every link again into its canonical url and link key", () => {
    expect(
      plan([
        {
          platform: "instagram",
          link: "https://www.instagram.com/reel/C9xYz12AbCd/?igsh=MWZ4dGx0",
          showLink: false,
        },
        {
          platform: "facebook",
          link: "https://www.facebook.com/video.php?v=1234567890123",
        },
        {
          platform: "other",
          otherLabel: "Vimeo",
          link: "https://vimeo.com/123456789#t=10s",
        },
      ]),
    ).toEqual({
      ok: true,
      rows: [
        {
          index: 0,
          platform: "instagram",
          otherLabel: null,
          url: "https://www.instagram.com/reel/C9xYz12AbCd/",
          linkKey: "C9xYz12AbCd",
          showLink: false,
        },
        {
          index: 1,
          platform: "facebook",
          otherLabel: null,
          url: "https://www.facebook.com/watch/?v=1234567890123",
          linkKey: "1234567890123",
          showLink: undefined,
        },
        {
          index: 2,
          platform: "other",
          otherLabel: "Vimeo",
          url: "https://vimeo.com/123456789",
          linkKey: null,
          showLink: undefined,
        },
      ],
    });
  });

  it("gives a posting with no link for an empty or absent link", () => {
    const result = plan([
      { platform: "tiktok", link: "   " },
      { platform: "snapchat" },
    ]);
    expect(result.ok && result.rows).toEqual([
      {
        index: 0,
        platform: "tiktok",
        otherLabel: null,
        url: null,
        linkKey: null,
        showLink: undefined,
      },
      {
        index: 1,
        platform: "snapchat",
        otherLabel: null,
        url: null,
        linkKey: null,
        showLink: undefined,
      },
    ]);
  });

  it("returns each failing row's error by its input index, and no rows", () => {
    expect(
      plan([
        { platform: "youtube", link: "https://youtu.be/dQw4w9WgXcQ" },
        { platform: "tiktok", link: "https://vm.tiktok.com/ZMabc123/" },
        { platform: "x" },
        { platform: "instagram", link: "https://instagram.com@evil.com/" },
        {
          platform: "instagram",
          link: "https://www.tiktok.com/@scout2015/video/6718335390845095173",
        },
      ]),
    ).toEqual({
      ok: false,
      fields: { 1: "short_link", 3: "bad_host", 4: "wrong_platform" },
    });
  });

  it("collapses rows naming the same post to the first, and keeps rows with no link key", () => {
    const result = plan([
      { platform: "x", link: "https://x.com/i/status/1790000000000000001" },
      {
        platform: "x",
        link: "https://twitter.com/maya/status/1790000000000000001?s=20",
        showLink: false,
      },
      { platform: "instagram" },
      { platform: "instagram" },
      { platform: "other", otherLabel: "Vimeo", link: "https://vimeo.com/1" },
      { platform: "other", otherLabel: "Vimeo", link: "https://vimeo.com/1" },
    ]);
    expect(result.ok && result.rows.map((row) => row.index)).toEqual([
      0, 2, 3, 4, 5,
    ]);
  });

  it("drops a copy of the source posting", () => {
    const result = plan(
      [
        { platform: "mock", link: MOCK_URL },
        {
          platform: "mock",
          link: "https://example.com/mock/mock_post_c4180ab2_02",
        },
      ],
      { platform: "mock", linkKey: MOCK_ID },
    );
    expect(result.ok && result.rows.map((row) => row.linkKey)).toEqual([
      "mock_post_c4180ab2_02",
    ]);
  });

  it("reads Demo links only with allowMock", () => {
    expect(plan([{ platform: "mock", link: MOCK_URL }], null, false)).toEqual({
      ok: false,
      fields: { 0: "bad_host" },
    });
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
