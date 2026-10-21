import { describe, expect, it } from "vitest";
import { POST_TITLE_MAX, titleFromPost } from "./post-title";
import { TITLE_MAX, tidyTitle } from "./title";

describe("titleFromPost (01 J5.12)", () => {
  const post = {
    title: null,
    caption: null,
    platformLabel: "Demo",
    postedAt: "2026-10-01T15:00:00.000Z",
  };
  const fromCaption = (caption: string) => titleFromPost({ ...post, caption });

  it("Demo post 01 reads as the prompt's proof", () => {
    expect(
      fromCaption(
        "He saw snow for the first time and lost it #dogs #firstsnow",
      ),
    ).toBe("He saw snow for the first time and lost it");
  });

  it("prefers the post's title to its caption", () => {
    expect(
      titleFromPost({
        ...post,
        title: "Fog over the bridge",
        caption: "14 hours of fog rolling over the bridge #timelapse",
      }),
    ).toBe("Fog over the bridge");
  });

  it("cleans the title the same way, and falls to the caption when nothing is left", () => {
    expect(
      titleFromPost({ ...post, title: "Dunk of the year 🏀 #shorts" }),
    ).toBe("Dunk of the year");
    expect(
      titleFromPost({
        ...post,
        title: "#shorts 🔥",
        caption: "Dunk of the year",
      }),
    ).toBe("Dunk of the year");
  });

  it("takes the first non-blank line only, and falls back when it holds only hashtags and emoji", () => {
    expect(fromCaption("Snow day\nSecond line #dogs")).toBe("Snow day");
    expect(fromCaption("\n\n  Snow day")).toBe("Snow day");
    expect(fromCaption("#dogs #snow\r\n🐶🐶\u2028Snow day")).toBe(
      "Demo video · 1 Oct 2026",
    );
  });

  it.each([
    ["Watch till the end 👀 (#fyp #viral)", "Watch till the end"],
    ["Snow day [#dogs]", "Snow day"],
    ['Snow day 🎉🎉 "#dogs"', "Snow day"],
    ["Snow day (#dogs) again", "Snow day again"],
    ["Snow day (with Max) #dogs", "Snow day (with Max)"],
  ])("drops brackets and quotes left empty: %j", (caption, title) => {
    expect(fromCaption(caption)).toBe(title);
  });

  it.each([
    ["Snow day 🎉!", "Snow day!"],
    ["Snow, ❄️ and more", "Snow, and more"],
    ["don't🙂stop", "don't stop"],
    ["lost it#dogs", "lost it"],
    ["#dogs Snow day #firstsnow", "Snow day"],
    ["Snow day - #dogs", "Snow day"],
    ["🎉 | Snow day", "Snow day"],
    ["Our trip 🇨🇦 to the coast", "Our trip to the coast"],
    ["Family 👨‍👩‍👧 photo 👍🏽 time", "Family photo time"],
    ["Top 1️⃣ moment ❤️", "Top moment"],
    ["Snow #日本 day", "Snow day"],
  ])("%j → %j", (caption, title) => {
    expect(fromCaption(caption)).toBe(title);
  });

  it("keeps what isn't a hashtag: digits only, a bare #, C#", () => {
    expect(fromCaption("We're #1 in town")).toBe("We're #1 in town");
    expect(fromCaption("Learning C# today")).toBe("Learning C# today");
    expect(fromCaption("Room # 4")).toBe("Room # 4");
  });

  it("keeps the punctuation and spacing the creator typed", () => {
    expect(fromCaption("Incroyable ! Wait... what?")).toBe(
      "Incroyable ! Wait... what?",
    );
    expect(fromCaption("-5 degrees and snowing")).toBe(
      "-5 degrees and snowing",
    );
  });

  it("is tidied as stored titles are (owner answer Q-43 a)", () => {
    expect(fromCaption("  Snow\u200b \u202e day\t ")).toBe("Snow day");
    expect(fromCaption("Snow\uE000day")).toBe("Snowday");
  });

  it("cuts to 80 characters at a word boundary", () => {
    const words = "word ".repeat(30).trim();
    const title = fromCaption(words);
    expect(title.length).toBeLessThanOrEqual(POST_TITLE_MAX);
    expect(title).toBe("word ".repeat(16).trim());
    // A cut that falls right before a space keeps all 80 characters.
    const exact = `${"x".repeat(POST_TITLE_MAX)} tail`;
    expect(fromCaption(exact)).toBe("x".repeat(POST_TITLE_MAX));
    // A separator left at the cut goes too.
    expect(fromCaption(`${"a".repeat(76)} - more words`)).toBe("a".repeat(76));
  });

  it("cuts one long word inside, never between a surrogate pair or before a mark", () => {
    expect(fromCaption("x".repeat(120))).toBe("x".repeat(POST_TITLE_MAX));
    const surrogates = `${"x".repeat(POST_TITLE_MAX - 1)}${"\u{1D400}".repeat(3)}`;
    expect(fromCaption(surrogates)).toBe("x".repeat(POST_TITLE_MAX - 1));
    const mark = `${"x".repeat(POST_TITLE_MAX - 1)}e\u0301${"x".repeat(10)}`;
    expect(fromCaption(mark)).toBe("x".repeat(POST_TITLE_MAX - 1));
  });

  it("falls back to '{Platform} video · date' when nothing is left", () => {
    expect(
      titleFromPost({ ...post, platformLabel: "Instagram", caption: null }),
    ).toBe("Instagram video · 1 Oct 2026");
    expect(fromCaption("#dogs #firstsnow 🐶")).toBe("Demo video · 1 Oct 2026");
    expect(fromCaption("   ")).toBe("Demo video · 1 Oct 2026");
    expect(
      titleFromPost({
        ...post,
        postedAt: new Date("2026-10-01T23:30:00-05:00"),
      }),
    ).toBe("Demo video · 2 Oct 2026");
    expect(titleFromPost({ ...post, postedAt: null })).toBe("Demo video");
  });

  it("always gives a title the schema accepts", () => {
    for (const caption of [
      "x".repeat(500),
      `${"y ".repeat(200)}`,
      "#a #b",
      "🎉".repeat(90),
    ]) {
      const title = fromCaption(caption);
      expect(title.length).toBeGreaterThan(0);
      expect(title.length).toBeLessThanOrEqual(TITLE_MAX);
      expect(tidyTitle(title)).toBe(title);
    }
  });
});
