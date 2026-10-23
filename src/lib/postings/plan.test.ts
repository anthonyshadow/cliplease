import { describe, expect, it } from "vitest";
import { type PostingPlanRow, planPostings } from "./plan";

const MOCK_ID = "mock_post_c4180ab2_01";
const MOCK_URL = `https://example.com/mock/${MOCK_ID}`;

describe("planPostings", () => {
  const plan = (
    postings: PostingPlanRow[],
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
