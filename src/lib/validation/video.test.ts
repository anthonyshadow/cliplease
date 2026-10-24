import { describe, expect, it } from "vitest";
import {
  createVideoSchema,
  SLUG_COPY,
  slugField,
  titleField,
  videoDetailsSchema,
} from "./video";

describe("titleField (07 D23, owner answer Q-43 a)", () => {
  it.each([
    ["x", "x"],
    ["x".repeat(100), "x".repeat(100)],
    [`  ${"x".repeat(100)}\n `, "x".repeat(100)],
    [
      `${"x".repeat(50)}\n\n\n${"y".repeat(49)}`,
      `${"x".repeat(50)} ${"y".repeat(49)}`,
    ],
    ["\u202eHe saw\tsnow ", "He saw snow"],
  ])("accepts %j as %j", (raw, title) => {
    expect(titleField.safeParse(raw)).toEqual({ success: true, data: title });
  });

  it.each([
    "",
    "   ",
    "\n\t",
    "\u202e\u200f",
    "x".repeat(101),
    ` ${"x".repeat(101)} `,
  ])("rejects %j", (raw) => {
    expect(titleField.safeParse(raw).success).toBe(false);
  });
});

describe("createVideoSchema (02 §6.1)", () => {
  it("parses the tidied title", () => {
    expect(
      createVideoSchema.parse({
        title: " He saw snow for the first time\nand lost it ",
      }),
    ).toEqual({ title: "He saw snow for the first time and lost it" });
  });

  it.each([{}, { title: "" }, { title: 7 }, { title: "x".repeat(101) }])(
    "rejects %j on the title",
    (input) => {
      const result = createVideoSchema.safeParse(input);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(["title"]);
    },
  );
});

describe("slugField (02 §6.1 updateVideoDetails; owner answer Q-98 a)", () => {
  it("trims and lowercases, then keeps a valid link as typed", () => {
    expect(slugField.parse("  He-Saw-Snow-2 ")).toBe("he-saw-snow-2");
    expect(slugField.parse("a".repeat(60))).toBe("a".repeat(60));
  });

  it.each([
    ["", SLUG_COPY.format],
    ["he saw snow", SLUG_COPY.format],
    ["-snow", SLUG_COPY.format],
    ["snow--day", SLUG_COPY.format],
    ["snow_day", SLUG_COPY.format],
    ["a".repeat(61), SLUG_COPY.tooLong],
  ])("refuses %j with its message", (raw, message) => {
    const result = slugField.safeParse(raw);
    expect(result.error?.issues[0]?.message).toBe(message);
  });
});

describe("videoDetailsSchema (02 §6.1)", () => {
  const VIDEO_ID = "00000000-0000-4000-8000-000000000002";

  it("parses the title and the link together", () => {
    expect(
      videoDetailsSchema.parse({
        videoId: VIDEO_ID,
        title: " Snow day ",
        slug: "Snow-Day",
      }),
    ).toEqual({ videoId: VIDEO_ID, title: "Snow day", slug: "snow-day" });
  });

  it("takes either field alone, but not neither", () => {
    expect(
      videoDetailsSchema.parse({ videoId: VIDEO_ID, title: "Snow day" }),
    ).toEqual({ videoId: VIDEO_ID, title: "Snow day" });
    expect(
      videoDetailsSchema.parse({ videoId: VIDEO_ID, slug: "Snow-Day" }),
    ).toEqual({ videoId: VIDEO_ID, slug: "snow-day" });
    expect(videoDetailsSchema.safeParse({ videoId: VIDEO_ID }).success).toBe(
      false,
    );
  });

  it("names the field that failed", () => {
    const result = videoDetailsSchema.safeParse({
      videoId: VIDEO_ID,
      title: "",
      slug: "snow day",
    });
    expect(result.error?.issues.map((issue) => issue.path[0])).toEqual([
      "title",
      "slug",
    ]);
  });
});
