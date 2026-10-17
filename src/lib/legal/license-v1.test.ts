import { describe, expect, it } from "vitest";
import { APP_NAME } from "../app-name";
import {
  fillLicenseV1,
  LICENSE_V1_HEADER,
  LICENSE_V1_NEUTRAL_VALUES,
  LICENSE_V1_SCHEDULE_A,
  LICENSE_V1_SECTIONS,
  LICENSE_V1_SUMMARY,
  LICENSE_V1_TITLE,
  LICENSE_V1_UPDATED_LABEL,
  LICENSE_V1_VERSION,
  licenseV1Tokens,
} from "./license-v1";
import { sectionStrings } from "./types";

const pageStrings = [
  LICENSE_V1_TITLE,
  LICENSE_V1_SUMMARY.heading,
  LICENSE_V1_SUMMARY.footer,
  ...LICENSE_V1_SUMMARY.groups.flatMap((g) => [
    g.title,
    ...g.rows.flatMap((r) => [r.label, r.text]),
  ]),
  ...sectionStrings([...LICENSE_V1_SECTIONS, LICENSE_V1_SCHEDULE_A]),
];
const allText = [...pageStrings, ...LICENSE_V1_HEADER.flat()].join("\n");

describe("fillLicenseV1", () => {
  it("replaces every token", () => {
    expect(
      fillLicenseV1("{licensee_name} licensed {video_title}.", {
        licensee_name: "Daily Laughs Media",
        video_title: '"Dog vs. sprinkler"',
      }),
    ).toBe('Daily Laughs Media licensed "Dog vs. sprinkler".');
  });

  it("throws on a token without a value and names it", () => {
    expect(() =>
      fillLicenseV1("Licensed to {licensee_name}.", {}),
    ).toThrowError("{licensee_name}");
    expect(() =>
      fillLicenseV1("{a_token} and {a_token}", { other: "x" }),
    ).toThrowError("no value for {a_token}");
  });

  it("never resolves a token through Object.prototype", () => {
    expect(() => fillLicenseV1("A {constructor} B", {})).toThrowError(
      "{constructor}",
    );
    expect(() => fillLicenseV1("A {__proto__} B", {})).toThrowError(
      "{__proto__}",
    );
  });

  it("accepts an empty value (an absent music or people clause)", () => {
    expect(fillLicenseV1("[{music_clause}]", { music_clause: "" })).toBe("[]");
  });

  it("fills every string the /legal/license/v1 page renders, leaving no raw token", () => {
    for (const text of pageStrings) {
      const filled = fillLicenseV1(text, LICENSE_V1_NEUTRAL_VALUES);
      expect(filled).not.toMatch(/\{[a-z_]+\}/);
    }
    expect(fillLicenseV1(LICENSE_V1_TITLE, LICENSE_V1_NEUTRAL_VALUES)).toBe(
      `${APP_NAME} Video License v1`,
    );
  });

  it("lists the tokens of a text", () => {
    expect(licenseV1Tokens("{a} b {c_d}")).toEqual(["a", "c_d"]);
  });
});

describe("License v1 text", () => {
  it("is v1, last updated 15 Oct 2026 (UTC)", () => {
    expect(LICENSE_V1_VERSION).toBe("v1");
    expect(LICENSE_V1_UPDATED_LABEL).toBe("15 Oct 2026");
  });

  it("has sections 1–22, ending with the 07 D113 and D142 sections", () => {
    expect(LICENSE_V1_SECTIONS).toHaveLength(22);
    const exclusive = LICENSE_V1_SECTIONS[20];
    const renewal = LICENSE_V1_SECTIONS[21];
    expect(exclusive.id).toBe("exclusive-licenses");
    expect(exclusive.blocks).toEqual([
      "If your license summary says Exclusive, the creator won't grant, sell or offer a license of this video to anyone else, for any use or territory, from the start date until the end date of your license and of any renewal term. The creator keeps the copyright and may keep their own existing posts of the video online.",
    ]);
    expect(renewal.id).toBe("renewal");
    expect(renewal.blocks).toEqual([
      "An exclusive license can be renewed for another term of the same length (30 days, 6 months or 1 year) at the agreed renewal price, automatically if you turned on auto-renewal, or by you from My licenses. The renewal terms in our Terms of Service apply.",
    ]);
    expect(allText).not.toContain("for another year");
  });

  it("carries the owner's Q3 (a) exclusivity and renewal fixes", () => {
    expect(allText).toContain(
      "a non-exclusive (or, when the license summary says Exclusive, an exclusive), non-transferable, non-sublicensable license",
    );
    expect(allText).toContain(
      'may license it to others, except as section 21 ("Exclusive licenses") says',
    );
    expect(allText).toContain(
      "A renewal term takes effect on its start date; it needs no new approval.",
    );
  });

  it("has the standard and the exclusive summary rows (07 D113, D142)", () => {
    const rows = LICENSE_V1_SUMMARY.groups.flatMap((g) =>
      g.rows.map((r) => ({ group: g.title, ...r })),
    );
    expect(rows).toContainEqual({
      group: "Not included",
      label: "Exclusivity",
      text: "{creator_handle} can license this video to others.",
      when: "standard",
    });
    expect(rows).toContainEqual({
      group: "You get",
      label: "Exclusivity",
      text: "{creator_handle} won't license this video to anyone else, for any use or place, {exclusive_phrase}.",
      when: "exclusive",
    });
    expect(rows).toContainEqual({
      group: "You get",
      label: "Renewal",
      text: "Renews {renewal_interval} for {renewal_total} unless you turn it off. A higher price needs your OK.",
      when: "auto_renew",
    });
  });

  it("refunds every revoke except a reversed payment (07 D86, D46)", () => {
    expect(allText).not.toContain("No refund.");
    expect(allText).not.toContain("revoked automatically");
  });

  it("names no currency and no product name literally", () => {
    expect(allText).not.toMatch(/\bUSD\b|\bCAD\b|\$\d/);
    expect(allText).not.toContain(APP_NAME);
  });
});
