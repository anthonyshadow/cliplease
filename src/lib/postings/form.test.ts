import { describe, expect, it } from "vitest";
import {
  POSTING_UNVERIFIED_REASONS,
  type PostingPlatform,
  VIDEO_STATUSES,
} from "../domain/values";
import {
  canonicalPostingUrl,
  isNothingChosen,
  needsAttention,
  PLATFORMS_FIELD,
  POSTINGS_EDITABLE,
  POSTINGS_FIELD,
  type PostingFormRow,
  postingFieldKey,
  postingsFromFormData,
  postingsInputChanged,
  postingsStepMode,
  postingsStepOutcome,
  switchFieldValue,
  verifiedPostingsKey,
} from "./form";
import type { PostingPlanRow } from "./plan";
import type { OwnerPostingDTO } from "./types";

const VIDEO_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const IG_REEL = "https://www.instagram.com/reel/C0dEaBcDeF1/";
const IG_REEL_TRACKED =
  "https://www.instagram.com/reel/C0dEaBcDeF1/?igsh=MWZ4dGx0&utm_source=ig_web_copy_link";
const IG_OTHER_REEL = "https://www.instagram.com/reel/C9xYz12AbCd/";
const FB_REEL = "https://www.facebook.com/reel/1234567890123";
const VIMEO = "https://vimeo.com/123456789";
const DEMO_01 = "https://example.com/mock/mock_post_c4180ab2_01";
const DEMO_02 = "https://example.com/mock/mock_post_c4180ab2_02";
const SCOUT = "https://www.tiktok.com/@scout2015/video/6718335390845095173";
const MOCK = { allowMock: true };

const form = (entries: [string, string][]) => {
  const fd = new FormData();
  for (const [name, value] of entries) fd.append(name, value);
  return fd;
};

const posting = (over: Partial<OwnerPostingDTO> = {}): OwnerPostingDTO => ({
  id: "00000000-0000-4000-8000-000000000001",
  platform: "instagram",
  label: "Instagram",
  url: IG_REEL,
  isSource: false,
  verification: "unverified",
  unverifiedReason: "no_account",
  verifiedUsername: null,
  accountStatus: null,
  thumbnailSrc: null,
  durationSec: null,
  visibility: null,
  showLink: true,
  checkedAt: null,
  position: 1,
  ...over,
});

const SOURCE = posting({
  id: "00000000-0000-4000-8000-0000000000aa",
  platform: "mock",
  label: "Demo",
  url: DEMO_01,
  isSource: true,
  verification: "verified",
  unverifiedReason: null,
  verifiedUsername: "@demo.creator",
  accountStatus: "connected",
  position: 0,
});

describe("field names (the FormData contract)", () => {
  it("names the row fields and the form's own fields", () => {
    expect(postingFieldKey(0, "platform")).toBe("postings.0.platform");
    expect(postingFieldKey(11, "otherLabel")).toBe("postings.11.otherLabel");
    expect(postingFieldKey(3, "link")).toBe("postings.3.link");
    expect(postingFieldKey(3, "showLink")).toBe("postings.3.showLink");
    expect(POSTINGS_FIELD).toEqual({
      videoId: "videoId",
      notPosted: "notPosted",
      sourceShowLink: "sourceShowLink",
      sameVideo: "sameVideo",
      verifiedKey: "verifiedKey",
      chipMirror: "platform",
    });
    expect(PLATFORMS_FIELD).toBe("platforms");
    expect(switchFieldValue(true)).toBe("true");
    expect(switchFieldValue(false)).toBe("false");
  });
});

describe("postingsFromFormData (02 §6.1)", () => {
  it("round-trips the rows, the Other name, the Switches and the Continue's fields", () => {
    const fd = form([
      ["videoId", VIDEO_ID],
      [postingFieldKey(0, "platform"), "instagram"],
      [postingFieldKey(0, "link"), IG_REEL],
      [postingFieldKey(0, "showLink"), switchFieldValue(false)],
      [postingFieldKey(1, "platform"), "other"],
      [postingFieldKey(1, "otherLabel"), "Vimeo"],
      [postingFieldKey(1, "link"), VIMEO],
      [postingFieldKey(1, "showLink"), switchFieldValue(true)],
      [postingFieldKey(2, "platform"), "facebook"],
      ["sourceShowLink", "false"],
      ["sameVideo", "on"],
      ["verifiedKey", `mock ${DEMO_01}`],
    ]);
    expect(postingsFromFormData(fd)).toEqual({
      videoId: VIDEO_ID,
      notPosted: false,
      postings: [
        { platform: "instagram", link: IG_REEL, showLink: false },
        {
          platform: "other",
          otherLabel: "Vimeo",
          link: VIMEO,
          showLink: true,
        },
        { platform: "facebook" },
      ],
      indices: [0, 1, 2],
      sourceShowLink: false,
      sameVideo: true,
      verifiedKey: `mock ${DEMO_01}`,
    });
  });

  it("reads an absent showLink, sourceShowLink, tick and key as absent (the server's save decides, owner answer Q-86 a)", () => {
    const read = postingsFromFormData(
      form([
        ["videoId", VIDEO_ID],
        [postingFieldKey(0, "platform"), "youtube"],
        [
          postingFieldKey(0, "link"),
          "https://www.youtube.com/shorts/dQw4w9WgXcQ",
        ],
      ]),
    );
    expect(read.postings).toEqual([
      {
        platform: "youtube",
        link: "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      },
    ]);
    expect(read.postings[0]).not.toHaveProperty("showLink");
    expect(read).not.toHaveProperty("sourceShowLink");
    expect(read.sameVideo).toBe(false);
    expect(read.verifiedKey).toBe("");
    expect(read.notPosted).toBe(false);
  });

  it.each(["on", "", "TRUE", "1", "yes"])(
    "never guesses a Switch from %j",
    (value) => {
      const read = postingsFromFormData(
        form([
          [postingFieldKey(0, "platform"), "instagram"],
          [postingFieldKey(0, "showLink"), value],
          ["sourceShowLink", value],
        ]),
      );
      expect(read.postings).toEqual([{ platform: "instagram" }]);
      expect(read).not.toHaveProperty("sourceShowLink");
    },
  );

  it("reads sourceShowLink true", () => {
    expect(
      postingsFromFormData(form([["sourceShowLink", "true"]])).sourceShowLink,
    ).toBe(true);
  });

  it("reads an empty or blank link as a row with no link, and keeps a typed link as typed", () => {
    const read = postingsFromFormData(
      form([
        [postingFieldKey(0, "platform"), "tiktok"],
        [postingFieldKey(0, "link"), ""],
        [postingFieldKey(1, "platform"), "tiktok"],
        [postingFieldKey(1, "link"), "   "],
        [postingFieldKey(2, "platform"), "tiktok"],
        [postingFieldKey(2, "link"), ` ${SCOUT} `],
      ]),
    );
    expect(read.postings).toEqual([
      { platform: "tiktok" },
      { platform: "tiktok" },
      { platform: "tiktok", link: ` ${SCOUT} ` },
    ]);
  });

  it("keeps an empty Other name for the server's Zod to refuse (“Add the name of the site.”)", () => {
    expect(
      postingsFromFormData(
        form([
          [postingFieldKey(0, "platform"), "other"],
          [postingFieldKey(0, "otherLabel"), ""],
        ]),
      ).postings,
    ).toEqual([{ platform: "other", otherLabel: "" }]);
  });

  it("reads “I haven't posted it anywhere yet.” with no rows", () => {
    expect(
      postingsFromFormData(
        form([
          ["videoId", VIDEO_ID],
          ["notPosted", "on"],
        ]),
      ),
    ).toEqual({
      videoId: VIDEO_ID,
      notPosted: true,
      postings: [],
      indices: [],
      sameVideo: false,
      verifiedKey: "",
    });
  });

  it("compacts rows in index order and keeps each row's form index for its field errors", () => {
    const read = postingsFromFormData(
      form([
        [postingFieldKey(7, "platform"), "facebook"],
        [postingFieldKey(2, "platform"), "instagram"],
        [postingFieldKey(2, "link"), IG_REEL],
        [postingFieldKey(10, "platform"), "x"],
      ]),
    );
    expect(read.postings.map((row) => row.platform)).toEqual([
      "instagram",
      "facebook",
      "x",
    ]);
    expect(read.indices).toEqual([2, 7, 10]);
  });

  it('keeps a row without a platform field, as "", for the server\'s Zod to refuse', () => {
    expect(
      postingsFromFormData(form([[postingFieldKey(4, "link"), IG_REEL]])),
    ).toMatchObject({
      postings: [{ platform: "", link: IG_REEL }],
      indices: [4],
    });
  });

  it("reads the first value of a repeated field", () => {
    expect(
      postingsFromFormData(
        form([
          [postingFieldKey(0, "platform"), "instagram"],
          [postingFieldKey(0, "platform"), "tiktok"],
        ]),
      ).postings,
    ).toEqual([{ platform: "instagram" }]);
  });

  it.each([
    "postings.12.platform",
    "postings.99.platform",
    "postings.999999999.platform",
    "postings.01.platform",
    "postings.-1.platform",
    "postings.1e1.platform",
    "postings. 1.platform",
    "postings..platform",
    "postings.x.platform",
    "postings.1.2.platform",
    "postings.1.title",
  ])("ignores %s (index guard), and the mirror stays unread", (name) => {
    const read = postingsFromFormData(
      form([
        [name, "instagram"],
        ["platform", "tiktok"],
      ]),
    );
    expect(read.postings).toEqual([]);
    expect(read.indices).toEqual([]);
  });

  it("reads 0 … 11 only", () => {
    const entries: [string, string][] = Array.from({ length: 13 }, (_, i) => [
      postingFieldKey(i, "platform"),
      "facebook",
    ]);
    const read = postingsFromFormData(form(entries));
    expect(read.indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("falls back to the chip mirror (no JS) only when no postings.* field is posted: link-less rows, each once", () => {
    const read = postingsFromFormData(
      form([
        ["videoId", VIDEO_ID],
        ["platform", "instagram"],
        ["platform", "other"],
        ["platform", "instagram"],
        ["platform", "nonsense"],
      ]),
    );
    expect(read.postings).toEqual<PostingFormRow[]>([
      { platform: "instagram" },
      { platform: "other" },
      { platform: "nonsense" },
    ]);
    expect(read.indices).toEqual([0, 1, 2]);
    expect(
      postingsFromFormData(
        form([
          [postingFieldKey(0, "platform"), "facebook"],
          ["platform", "instagram"],
        ]),
      ).postings,
    ).toEqual([{ platform: "facebook" }]);
  });

  it("reads a Library form with nothing added as no row: the locked source chip posts no mirror (filter-chips.test.tsx)", () => {
    const entries: [string, string][] = [
      ["videoId", VIDEO_ID],
      ["sourceShowLink", "true"],
    ];
    expect(postingsFromFormData(form(entries))).toMatchObject({
      postings: [],
      sourceShowLink: true,
    });
  });
});

describe("canonicalPostingUrl", () => {
  it("is the stored form of a link, or null for none or one that doesn't parse", () => {
    expect(canonicalPostingUrl("instagram", IG_REEL_TRACKED, MOCK)).toBe(
      IG_REEL,
    );
    expect(canonicalPostingUrl("mock", DEMO_01, MOCK)).toBe(DEMO_01);
    expect(canonicalPostingUrl("mock", DEMO_01, { allowMock: false })).toBe(
      null,
    );
    expect(canonicalPostingUrl("tiktok", IG_REEL, MOCK)).toBeNull();
    expect(canonicalPostingUrl("instagram", "  ", MOCK)).toBeNull();
    expect(canonicalPostingUrl("instagram", undefined, MOCK)).toBeNull();
    expect(canonicalPostingUrl("nonsense", IG_REEL, MOCK)).toBeNull();
  });
});

describe("postingsInputChanged (04 §9.33: a second Continue with nothing changed moves on)", () => {
  const SAVED: OwnerPostingDTO[] = [
    SOURCE,
    posting({ position: 1 }),
    posting({
      id: "00000000-0000-4000-8000-000000000002",
      platform: "other",
      label: "Vimeo",
      url: VIMEO,
      unverifiedReason: "unverifiable",
      position: 2,
    }),
    posting({
      id: "00000000-0000-4000-8000-000000000003",
      platform: "facebook",
      label: "Facebook",
      url: null,
      unverifiedReason: "no_link",
      position: 3,
    }),
  ];
  const SAME: PostingPlanRow[] = [
    { platform: "instagram", link: IG_REEL },
    { platform: "other", otherLabel: "Vimeo", link: VIMEO },
    { platform: "facebook" },
  ];
  const changed = (
    postings: PostingPlanRow[],
    sourceShowLink?: boolean,
    before: OwnerPostingDTO[] = SAVED,
  ) =>
    postingsInputChanged(
      before,
      sourceShowLink === undefined
        ? { postings }
        : { postings, sourceShowLink },
      MOCK,
    );

  it("is unchanged for the saved rows, in any `before` order", () => {
    expect(changed(SAME)).toBe(false);
    expect(changed(SAME, undefined, [...SAVED].reverse())).toBe(false);
  });

  it("is unchanged for a tracking-param paste of the stored canonical url, and a blank link on a link-less row", () => {
    expect(
      changed([
        { platform: "instagram", link: IG_REEL_TRACKED },
        { platform: "other", otherLabel: "Vimeo", link: `${VIMEO}#t=10s` },
        { platform: "facebook", link: "  " },
      ]),
    ).toBe(false);
  });

  it("compares showLink only when posted", () => {
    expect(
      changed([
        { platform: "instagram", link: IG_REEL, showLink: true },
        ...SAME.slice(1),
      ]),
    ).toBe(false);
    expect(
      changed([
        { platform: "instagram", link: IG_REEL, showLink: false },
        ...SAME.slice(1),
      ]),
    ).toBe(true);
  });

  it("compares the source Switch when posted", () => {
    expect(changed(SAME, true)).toBe(false);
    expect(changed(SAME, false)).toBe(true);
  });

  it("ignores sourceShowLink on an upload (no source row)", () => {
    expect(changed(SAME, false, SAVED.slice(1))).toBe(false);
  });

  it("is changed by a reorder", () => {
    expect(changed([SAME[1], SAME[0], SAME[2]])).toBe(true);
  });

  it.each<[string, PostingPlanRow[]]>([
    ["an added row", [...SAME, { platform: "x" }]],
    ["a removed row", SAME.slice(0, 2)],
    [
      "another link",
      [{ platform: "instagram", link: IG_OTHER_REEL }, ...SAME.slice(1)],
    ],
    ["a removed link", [{ platform: "instagram" }, ...SAME.slice(1)]],
    [
      "an added link",
      [...SAME.slice(0, 2), { platform: "facebook", link: FB_REEL }],
    ],
    [
      "another Other name",
      [SAME[0], { ...SAME[1], otherLabel: "Dailymotion" }, SAME[2]],
    ],
    [
      "an Other without its name",
      [SAME[0], { platform: "other", link: VIMEO }, SAME[2]],
    ],
    [
      "a name on a platform that takes none",
      [{ ...SAME[0], otherLabel: "Vimeo" }, ...SAME.slice(1)],
    ],
    ["another platform", [SAME[0], SAME[1], { platform: "snapchat" }]],
    [
      "a link that doesn't parse",
      [{ platform: "instagram", link: "instagram.com/maya" }, ...SAME.slice(1)],
    ],
    [
      "a Demo link without mock",
      [...SAME, { platform: "mock", link: DEMO_02 }],
    ],
  ])("is changed by %s", (_case, postings) => {
    expect(
      postingsInputChanged(SAVED, { postings }, { allowMock: false }),
    ).toBe(true);
  });

  it("doesn't count rows the save would drop: a second copy of a post, a copy of the source", () => {
    expect(
      changed([
        SAME[0],
        { platform: "instagram", link: IG_REEL_TRACKED },
        { platform: "mock", link: DEMO_01 },
        ...SAME.slice(1),
      ]),
    ).toBe(false);
  });

  it("an upload with nothing saved and nothing chosen is unchanged; any row changes it", () => {
    expect(changed([], undefined, [])).toBe(false);
    expect(changed([{ platform: "facebook" }], undefined, [])).toBe(true);
  });
});

describe("isNothingChosen (05 §6.5 States)", () => {
  it("is an upload's Continue with no row and no not-posted tick", () => {
    const upload = { hasSource: false, rowCount: 0, notPosted: false };
    expect(isNothingChosen(upload)).toBe(true);
    expect(isNothingChosen({ ...upload, notPosted: true })).toBe(false);
    expect(isNothingChosen({ ...upload, rowCount: 1 })).toBe(false);
  });

  it("never for a Library video: its source is chosen", () => {
    expect(
      isNothingChosen({ hasSource: true, rowCount: 0, notPosted: false }),
    ).toBe(false);
  });
});

describe("verifiedPostingsKey (07 D69)", () => {
  const verified = (platform: PostingPlatform, url: string, position: number) =>
    posting({
      id: `00000000-0000-4000-8000-00000000010${position}`,
      platform,
      url,
      verification: "verified",
      unverifiedReason: null,
      verifiedUsername: "@demo.creator",
      position,
    });

  it("is the verified rows' sorted pairs; unverified and link-less rows don't count", () => {
    expect(
      verifiedPostingsKey([
        verified("mock", DEMO_02, 2),
        posting({ url: IG_OTHER_REEL }),
        SOURCE,
        posting({ url: null, unverifiedReason: "no_link" }),
      ]),
    ).toBe(`mock ${DEMO_01} mock ${DEMO_02}`);
  });

  it("is stable when a save replaces the rows (new ids, positions and order)", () => {
    const first = [
      SOURCE,
      verified("mock", DEMO_02, 1),
      posting({ position: 2 }),
    ];
    const replaced = [
      posting({ id: "00000000-0000-4000-8000-0000000000ff", position: 1 }),
      {
        ...verified("mock", DEMO_02, 2),
        id: "00000000-0000-4000-8000-0000000000fe",
      },
      { ...SOURCE, id: "00000000-0000-4000-8000-0000000000fd" },
    ];
    expect(verifiedPostingsKey(replaced)).toBe(verifiedPostingsKey(first));
  });

  it('changes with the verified set, and is "" with nothing verified', () => {
    expect(verifiedPostingsKey([SOURCE])).not.toBe(
      verifiedPostingsKey([SOURCE, verified("mock", DEMO_02, 1)]),
    );
    expect(verifiedPostingsKey([posting(), posting({ url: null })])).toBe("");
    expect(verifiedPostingsKey([])).toBe("");
  });
});

describe("needsAttention (04 §9.33 Footer)", () => {
  const ATTENTION = ["not_found", "no_account", "check_failed"];

  it.each(POSTING_UNVERIFIED_REASONS)("an unverified link, %s", (reason) => {
    expect(needsAttention(posting({ unverifiedReason: reason }))).toBe(
      ATTENTION.includes(reason),
    );
  });

  it("never a verified row or a row with no link", () => {
    expect(needsAttention(SOURCE)).toBe(false);
    expect(
      needsAttention(posting({ url: null, unverifiedReason: "no_account" })),
    ).toBe(false);
  });
});

describe("postingsStepOutcome (04 §9.33 Footer)", () => {
  it.each([
    [false, false, false, "stay"],
    [false, false, true, "stay"],
    [false, true, false, "stay"],
    [false, true, true, "stay"],
    [true, false, false, "next"],
    [true, false, true, "next"],
    [true, true, false, "next"],
    [true, true, true, "stay"],
  ] as const)(
    "complete %s, changed %s, needsAttention %s → %s",
    (complete, changed, attention, outcome) => {
      expect(
        postingsStepOutcome({ complete, changed, needsAttention: attention }),
      ).toBe(outcome);
    },
  );
});

describe("postingsStepMode (07 D69; 05 frame 35)", () => {
  it("edits a draft or an unpublished video (POSTINGS_EDITABLE); shows the rest read-only", () => {
    expect(POSTINGS_EDITABLE).toEqual(["draft", "unpublished"]);
    expect(
      Object.fromEntries(
        VIDEO_STATUSES.map((status) => [status, postingsStepMode(status)]),
      ),
    ).toEqual({
      draft: "edit",
      published: "read_only",
      unpublished: "edit",
      disabled: "read_only",
    });
  });
});
