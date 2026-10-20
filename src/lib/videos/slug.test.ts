import { describe, expect, it } from "vitest";
import { SLUG_MAX_LENGTH, SLUG_RE } from "../validation/handle";
import { slugFromTitle, withSlugSuffix } from "./slug";

// 01 J5.12's slug regex, written out so a drift in SLUG_RE or SLUG_MAX_LENGTH fails here.
const J5_12_SLUG_RE = /^(?=.{1,60}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

function expectValidSlug(slug: string): void {
  expect(slug).toMatch(SLUG_RE);
  expect(slug).toMatch(J5_12_SLUG_RE);
  expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
}

describe("slugFromTitle (01 J5.12, 07 D20)", () => {
  it.each([
    [
      "He saw snow for the first time and lost it",
      "he-saw-snow-for-the-first-time-and-lost-it",
    ],
    ["Café Déjà Vu", "cafe-deja-vu"],
    ["Ünïcödé Ñandú", "unicode-nandu"],
    ["İstanbul", "istanbul"],
    ["ﬁrst snow", "first-snow"],
    ["Ｆｕｌｌ ｗｉｄｔｈ", "full-width"],
    ["Hello,   World!!!", "hello-world"],
    ["--Hello--World--", "hello-world"],
    ["  Snow & Ice: Day #3  ", "snow-ice-day-3"],
    ["Dog 🐶 runs", "dog-runs"],
    ["2026 Recap", "2026-recap"],
    ["first_snow.mp4", "first-snow-mp4"],
    ["x", "x"],
  ])("%j → %s", (title, slug) => {
    expect(slugFromTitle(title)).toBe(slug);
  });

  it.each([
    "🐶🐶🐶",
    "\u{1f468}\u200d\u{1f469}\u200d\u{1f467}",
    "!!!",
    "—",
    "...",
    "",
    "   ",
    "日本語のタイトル",
  ])("%j has nothing left → video", (title) => {
    expect(slugFromTitle(title)).toBe("video");
  });

  it("cuts a long title at a hyphen", () => {
    expect(
      slugFromTitle(
        "Snowy morning walk with the dogs along the frozen river and back home",
      ),
    ).toBe("snowy-morning-walk-with-the-dogs-along-the-frozen-river-and");
    expect(
      slugFromTitle(
        "The quick brown fox jumps over the lazy dog and keeps running far away",
      ),
    ).toBe("the-quick-brown-fox-jumps-over-the-lazy-dog-and-keeps");
  });

  it("keeps a word that ends exactly at 60 characters", () => {
    const title = `${"a".repeat(30)} ${"b".repeat(29)}`;
    const sixty = `${"a".repeat(30)}-${"b".repeat(29)}`;
    expect(slugFromTitle(title)).toBe(sixty);
    expect(slugFromTitle(`${title} tail`)).toBe(sixty);
  });

  it("hard-cuts a single word longer than 60 characters", () => {
    expect(slugFromTitle("a".repeat(80))).toBe("a".repeat(60));
    expect(slugFromTitle(`${"x".repeat(70)} end`)).toBe("x".repeat(60));
  });
});

describe("withSlugSuffix", () => {
  it("leaves n = 1 as the slug itself", () => {
    expect(withSlugSuffix("first-snow", 1)).toBe("first-snow");
    expect(withSlugSuffix("a".repeat(60), 1)).toBe("a".repeat(60));
  });

  it.each([
    [2, "first-snow-2"],
    [3, "first-snow-3"],
    [10_000_000, "first-snow-10000000"],
  ])("adds -%i to a short slug", (n, slug) => {
    expect(withSlugSuffix("first-snow", n)).toBe(slug);
  });

  it("cuts a long base at a hyphen so the result stays within 60", () => {
    const base = "the-quick-brown-fox-jumps-over-the-lazy-dog-and-keeps";
    expect(withSlugSuffix(base, 2)).toBe(`${base}-2`);
    expect(withSlugSuffix(base, 10_000_000)).toBe(
      "the-quick-brown-fox-jumps-over-the-lazy-dog-and-10000000",
    );
  });

  it("never leaves a hyphen before the suffix", () => {
    expect(withSlugSuffix(`${"a".repeat(57)}-bc`, 2)).toBe(
      `${"a".repeat(57)}-2`,
    );
  });

  it("hard-cuts a 60-character word", () => {
    expect(withSlugSuffix("a".repeat(60), 2)).toBe(`${"a".repeat(58)}-2`);
    expect(withSlugSuffix("a".repeat(60), 10_000_000)).toBe(
      `${"a".repeat(51)}-10000000`,
    );
  });
});

describe("every slug is valid (01 J5.12)", () => {
  const TITLES = [
    "He saw snow for the first time and lost it",
    "Café Déjà Vu",
    "Straße",
    "it's",
    "a\u0000b",
    "\u202eevil\u202c",
    "́́",
    "Привет мир",
    "123",
    "a-b",
    "-a-",
    "a—b",
    "Hello__World",
    "🐶",
    "",
    "   ",
    "a".repeat(59),
    "a".repeat(60),
    "a".repeat(61),
    `${"a".repeat(59)} bb`,
    `${"a".repeat(57)} bc`,
    `ab ${"c".repeat(70)}`,
    "a b ".repeat(40),
    "word ".repeat(200),
    "Ünïcödé ".repeat(20),
    "!@#$%^&*()".repeat(10),
  ];
  const SUFFIXES = [1, 2, 3, 9, 10, 99, 100, 1_000, 123_456, 10_000_000];

  it.each(TITLES)("%j", (title) => {
    const base = slugFromTitle(title);
    expectValidSlug(base);
    expect(slugFromTitle(base)).toBe(base);
    for (const n of SUFFIXES) {
      const slug = withSlugSuffix(base, n);
      expectValidSlug(slug);
      if (n === 1) continue;
      const suffix = `-${n}`;
      expect(slug.endsWith(suffix)).toBe(true);
      const kept = slug.slice(0, -suffix.length);
      expect(base.startsWith(kept)).toBe(true);
      // Cut at a word boundary whenever the room held a hyphen.
      const room = SLUG_MAX_LENGTH - suffix.length;
      if (kept !== base && base.slice(0, room).includes("-")) {
        expect(base[kept.length]).toBe("-");
      }
    }
  });
});
