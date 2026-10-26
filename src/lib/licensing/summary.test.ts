import { describe, expect, it } from "vitest";
import { APP_NAME } from "../app-name";
import { licenseSummary, type SummaryInput, termPhrase } from "./summary";

const PAID_WORLDWIDE: SummaryInput = {
  useKey: "paid_social",
  termKey: "y1",
  territoryKey: "worldwide",
  territoryCode: null,
  handle: "maya",
  creditLine: "Video: @demo.creator on Demo",
  containsMusic: false,
  identifiablePeople: false,
};

const rowsOf = (input: SummaryInput) =>
  Object.fromEntries(
    licenseSummary(input).groups.map((g) => [
      g.title,
      g.rows.map((r) => `${r.label} — ${r.text}`),
    ]),
  );

describe("licenseSummary (01 §4.7)", () => {
  it("fills the standard summary for Paid social ads · 1 year · Worldwide", () => {
    const summary = licenseSummary(PAID_WORLDWIDE);
    expect(summary.heading).toBe(
      "License summary · Paid social ads · 1 year · Worldwide",
    );
    expect(rowsOf(PAID_WORLDWIDE)).toEqual({
      "You can": [
        "Use it — Everything in organic, plus running it as ads or boosted posts on social platforms from your own ad accounts in any country, for 1 year from approval.",
        "Edit it — Crop, trim, caption, translate, add your logo, mute or replace the audio. Keep what it shows and means.",
        "Brief your team — Editors and agencies working for you may handle the file, only for your use.",
      ],
      "You must": [
        "Credit — “Video: @demo.creator on Demo” in the caption or on screen (organic and TV).",
        "Stop at the end — When the term ends, take it down and stop running it. (Perpetual: no end date.)",
      ],
      "You can't": [
        "Pass it on — No reselling, sublicensing, or use for clients or companies not named on the license.",
        "Misuse it — No misleading or defamatory context, political ads, AI training, deepfakes or Content ID claims.",
      ],
      "Not included": ["Exclusivity — @maya can license this video to others."],
    });
    expect(summary.footer).toEqual({
      note: "This summary is not the license.",
      link: {
        text: `The ${APP_NAME} Video License v1 is the legal text`,
        href: "/legal/license/v1",
      },
    });
  });

  it("names the territory in the heading and in the sentence (owner answer Q-115 a)", () => {
    const us = {
      ...PAID_WORLDWIDE,
      territoryKey: "country",
      territoryCode: "US",
    } as const;
    expect(licenseSummary(us).heading).toBe(
      "License summary · Paid social ads · 1 year · United States",
    );
    expect(rowsOf(us)["You can"]?.[0]).toContain(
      "from your own ad accounts in the United States, for 1 year",
    );
    const mea = {
      ...PAID_WORLDWIDE,
      territoryKey: "region",
      territoryCode: "middle_east_africa",
    } as const;
    expect(rowsOf(mea)["You can"]?.[0]).toContain(
      "in the Middle East & Africa, for 1 year",
    );
    const before = {
      ...us,
      territoryCode: null,
      useKey: "organic_social",
      termKey: "d30",
    } as const;
    expect(licenseSummary(before).heading).toBe(
      "License summary · Organic social repost · 30 days · One country",
    );
    expect(rowsOf(before)["You can"]?.[0]).toBe(
      "Use it — Post it on your own social media accounts, without paying to promote it in one country, for 30 days from approval.",
    );
  });

  it("shows the music and people rows only when flagged", () => {
    const flagged = rowsOf({
      ...PAID_WORLDWIDE,
      containsMusic: true,
      identifiablePeople: true,
    })["Not included"];
    expect(flagged).toEqual([
      "Exclusivity — @maya can license this video to others.",
      "Music — The music isn't licensed. Mute it, replace it, or license it yourself.",
      "People — People in the video haven't signed releases. Get their consent for ads or endorsements.",
    ]);
  });

  it("never shows the exclusive or renewal rows, nor their empty group", () => {
    const titles = licenseSummary(PAID_WORLDWIDE).groups.map((g) => g.title);
    expect(titles).toEqual([
      "You can",
      "You must",
      "You can't",
      "Not included",
    ]);
  });

  it("credits a self-attested video by handle and takes P20's term phrase", () => {
    const rows = rowsOf({
      ...PAID_WORLDWIDE,
      termKey: "perpetual",
      creditLine: "Video: @maya",
      termPhrase: "until 20 Nov 2027",
    });
    expect(rows["You must"]?.[0]).toBe(
      "Credit — “Video: @maya” in the caption or on screen (organic and TV).",
    );
    expect(rows["You can"]?.[0]).toMatch(
      /in any country, until 20 Nov 2027\.$/,
    );
  });
});

describe("termPhrase", () => {
  it.each([
    ["d30", "for 30 days from approval"],
    ["m6", "for 6 months from approval"],
    ["y1", "for 1 year from approval"],
    ["perpetual", "with no end date"],
  ] as const)("%s → %s", (key, phrase) => {
    expect(termPhrase(key)).toBe(phrase);
  });
});
