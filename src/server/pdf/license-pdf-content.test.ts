import { describe, expect, it } from "vitest";
import {
  LICENSE_V1_MUSIC_CLAUSE,
  LICENSE_V1_PEOPLE_CLAUSE,
} from "@/lib/legal/license-v1";
import type { LicenseSnapshotV1 } from "@/lib/licensing/snapshot";
import { BADGE_COPY } from "@/lib/videos/ownership";
import {
  FACEBOOK_UNVERIFIED,
  FIRST_SNOW,
  INSTAGRAM_URL,
  INSTAGRAM_VERIFIED,
  MULTI_SCRIPT,
  SNAPCHAT_NO_LINK,
  TIKTOK_VERIFIED,
  US_SCOPE,
} from "../../../tests/helpers/license-snapshot-fixtures";
import { pdfFonts } from "./fonts";
import {
  type LicensePdfContent,
  type LicensePdfFacts,
  licensePdfContent,
  type PdfLine,
} from "./license-pdf-content";

// The license PDF's words (05 §9; 07 D43, D70, D98, D113; owner answers Q-183, Q-186; P20 audit PD-1–PD-9, PD-M1), as
// its embedded fonts print them (known risk 20).

const VERIFY_URL = "http://localhost:3100/verify/CL-7K3M-9QXA";
const FACTS = {
  territoryCode: "US",
  acceptedAt: new Date("2026-10-15T14:20:00Z"),
  verifyUrl: VERIFY_URL,
};

const SNAPSHOT: LicenseSnapshotV1 = {
  ...FIRST_SNOW,
  postings: [
    INSTAGRAM_VERIFIED,
    TIKTOK_VERIFIED,
    FACEBOOK_UNVERIFIED,
    SNAPCHAT_NO_LINK,
    {
      platform: "other",
      label: "Vimeo",
      url: "https://vimeo.com/123456",
      verified: false,
      verifiedUsername: null,
      linkedAt: null,
    },
  ],
  scope: US_SCOPE,
};

const EXCLUSIVE: LicenseSnapshotV1 = { ...SNAPSHOT, exclusive: true };

const { regular } = await pdfFonts();
const contentOf = (s: LicenseSnapshotV1, facts: LicensePdfFacts = FACTS) =>
  licensePdfContent(s, facts, regular.family);

const DEMO: LicenseSnapshotV1 = {
  ...SNAPSHOT,
  ownership: {
    kind: "verified_owner",
    provider: "mock",
    providerUsername: "@demo.creator",
    linkedAt: "2026-10-12T09:00:00.000Z",
    verifiedAt: "2026-10-12T09:05:00.000Z",
    sourcePermalink: "https://example.com/demo/1",
  },
  postings: [
    {
      platform: "mock",
      label: "Demo",
      url: "https://example.com/demo/1",
      verified: true,
      verifiedUsername: "@demo.creator",
      linkedAt: "2026-10-12T09:00:00.000Z",
    },
  ],
};

const UPLOADED: LicenseSnapshotV1 = {
  ...SNAPSHOT,
  ownership: { kind: "self_attested" },
  postings: [],
  creditLine: "Video: @maya",
};

const lineText = (line: PdfLine) => ("url" in line ? line.url : line.text);
const rowOf = (c: LicensePdfContent, label: string) =>
  c.rows.find((row) => row.label === label)?.lines.map(lineText);
const legalText = (c: LicensePdfContent) =>
  c.legal
    .flatMap((section) => section.blocks)
    .flatMap((block) => (block.kind === "list" ? block.items : [block.text]));

/** Every string the PDF prints, the footers' templates filled. */
function printed(c: LicensePdfContent): string[] {
  return [
    c.meta.title,
    c.title,
    c.issuedLine,
    c.codeLabel,
    c.code,
    c.verifyUrl,
    ...c.rows.flatMap((row) => [row.label, ...row.lines.map(lineText)]),
    c.officialRecord,
    c.summary.heading,
    ...c.summary.groups.flatMap((group) => [group.title, ...group.rows]),
    c.summary.footer(2),
    ...c.legal.map((section) => section.title),
    ...legalText(c),
    c.footer.line,
    c.footer.page(1, 3),
  ];
}

describe("licensePdfContent: the record (05 §9 regions 1–5, 8–10)", () => {
  const c = contentOf(SNAPSHOT);

  it("names the license, its code and its record", () => {
    expect(c.title).toBe("ClipLease Video License v1");
    expect(c.issuedLine).toBe("Issued 15 Oct 2026, 14:32 UTC · Non-exclusive");
    expect(c.codeLabel).toBe("License code");
    expect(c.code).toBe("CL-7K3M-9QXA");
    expect(c.verifyUrl).toBe(VERIFY_URL);
    expect(c.officialRecord).toBe(
      `Official record: ${VERIFY_URL}. If this document and that page differ, the page is correct.`,
    );
    expect(c.meta).toEqual({
      title: "ClipLease Video License v1 · CL-7K3M-9QXA",
      author: "ClipLease",
      createdAt: new Date("2026-10-15T14:32:01.000Z"),
    });
  });

  it("prints the header rows in 05's order, Rights after Territory", () => {
    expect(c.rows.map((row) => row.label)).toEqual([
      "Licensor",
      "Licensee",
      "Video",
      "Use",
      "Term",
      "Territory",
      "Rights",
      "Paid",
      "Excluded",
      "Where it was posted",
    ]);
    expect(rowOf(c, "Licensee")).toEqual(["Daily Laughs Media LLC"]);
    expect(rowOf(c, "Video")).toEqual([
      "“First snow” — links under “Where it was posted”",
    ]);
    expect(rowOf(c, "Use")).toEqual(["Paid social ads"]);
    expect(rowOf(c, "Term")).toEqual([
      "1 year: 15 Oct 2026, 14:32 UTC to 15 Oct 2027, 14:32 UTC",
    ]);
    expect(rowOf(c, "Territory")).toEqual(["One country — United States"]);
    expect(rowOf(c, "Rights")).toEqual(["Non-exclusive"]);
    expect(rowOf(c, "Excluded")).toEqual(["—"]);
  });

  it("prints the amounts in the snapshot's currency, the currency line on its own (07 D98)", () => {
    expect(rowOf(c, "Paid")).toEqual([
      "License fee CA$1,575.00 + service fee CA$157.50 = CA$1,732.50",
      "Amounts in Canadian dollars (CAD).",
    ]);
  });

  it("gives the licensor the lg badge's lines and its explainer (07 D43, D70)", () => {
    const licensor = c.rows[0].lines;
    expect(licensor.map(lineText)).toEqual([
      "Maya R. (@maya on ClipLease) — Verified · @maya.films on Instagram",
      "Account linked 12 Oct 2026",
      "Also verified on TikTok",
      BADGE_COPY.verifiedExplainer,
      BADGE_COPY.postingsExplainer,
    ]);
    expect(licensor.slice(3).every((line) => "muted" in line)).toBe(true);
  });

  it("lists the postings as text, each link on lines of its own (07 D70, D71)", () => {
    expect(rowOf(c, "Where it was posted")).toEqual([
      "@maya.films on Instagram · Verified",
      INSTAGRAM_URL,
      "@maya.films on TikTok · Verified",
      "https://www.tiktok.com/@maya.films/video/7312345678901234567",
      "Facebook · Not verified",
      "https://www.facebook.com/reel/1",
      "Also posted on Snapchat",
      "Vimeo",
      "https://vimeo.com/123456",
    ]);
  });

  it("fills the legal text with this license's facts (Q-183)", () => {
    const text = legalText(c);
    expect(text).toContain(
      'This license is between Maya R. ("Licensor") and Daily Laughs Media LLC ("Licensee"). It was accepted at checkout on 15 Oct 2026, 14:20 UTC. It took effect when payment was captured on 15 Oct 2026, 14:32 UTC, after the Licensor approved. A renewal term takes effect on its start date; it needs no new approval.',
    );
    expect(text.join(" ")).toContain(
      "the audiovisual work “First snow” (links under “Where it was posted”) as delivered",
    );
    expect(text.join(" ")).toContain(
      "The Licensed Use is Paid social ads: everything in organic, plus running it as ads",
    );
    expect(text.join(" ")).toContain(
      "Ownership statement: Verified · @maya.films on Instagram.",
    );
    expect(c.legal.at(-1)?.title).toBe("Schedule A");
    expect(c.legal.map((section) => section.title)).toContain(
      "21. Exclusive licenses",
    );
  });

  it("drops §10's empty clauses and prints none of the template's tokens (PD-M1)", () => {
    const excluded = c.legal.find((s) => s.title.startsWith("10."));
    expect(excluded?.blocks).toEqual([
      {
        kind: "list",
        items: [
          "The Licensor consents to the use of their own appearance and voice in the Video for the Licensed Use. This does not allow anyone to state or imply that the Licensor endorses anything.",
        ],
      },
    ]);
    for (const text of printed(c)) {
      expect(text).not.toContain("{");
      expect(text.trim()).not.toBe("");
    }
  });

  it("prints only characters its fonts draw, with no missing-glyph note (known risk 20)", () => {
    for (const s of [SNAPSHOT, EXCLUSIVE, DEMO, UPLOADED, MULTI_SCRIPT]) {
      const c = contentOf(s);
      for (const text of printed(c)) {
        const missing = [...text].filter(
          (char) => regular.family(char.codePointAt(0) ?? 0) === -1,
        );
        expect(missing, text).toEqual([]);
      }
      expect(c.missingGlyphs).toBe(false);
    }
  });
});

describe("licensePdfContent: variants", () => {
  it("an exclusive license: the kind in the issue line, its end in the Rights row and the summary (07 D113)", () => {
    const c = contentOf(EXCLUSIVE);
    expect(c.issuedLine).toBe("Issued 15 Oct 2026, 14:32 UTC · Exclusive");
    expect(rowOf(c, "Rights")).toEqual([
      "Exclusive until 15 Oct 2027, 14:32 UTC",
    ]);
    expect(c.summary.heading).toBe(
      "License summary · Exclusive · Paid social ads · 1 year · United States",
    );
    expect(c.summary.groups[0]).toEqual({
      title: "You get",
      rows: [
        "Exclusivity — @maya won't license this video to anyone else, for any use or place, until 15 Oct 2027, 14:32 UTC.",
      ],
    });
  });

  it("a demo account reads as one, never as a platform (07 D43)", () => {
    const c = contentOf(DEMO);
    expect(rowOf(c, "Licensor")?.[0]).toBe(
      "Maya R. (@maya on ClipLease) — Verified · @demo.creator (demo account)",
    );
    expect(legalText(c).join(" ")).toContain(
      "Ownership statement: Verified · @demo.creator (demo account).",
    );
  });

  it("an uploaded file: self-attested, no postings block (07 D89; research/license.md §4.1)", () => {
    const c = contentOf(UPLOADED);
    expect(rowOf(c, "Licensor")).toEqual([
      "Maya R. (@maya on ClipLease) — Self-attested by the creator",
      BADGE_COPY.selfAttestedExplainer,
    ]);
    expect(rowOf(c, "Video")).toEqual([
      "“First snow” — Uploaded file (no linked post)",
    ]);
    expect(rowOf(c, "Where it was posted")).toBeUndefined();
    expect(legalText(c).join(" ")).toContain(
      "“First snow” (Uploaded file (no linked post)) as delivered",
    );
  });

  it("postings whose links are all hidden: no linked post, the postings still listed (07 D71; research/license.md §4.1)", () => {
    const c = contentOf({ ...UPLOADED, postings: [SNAPSHOT.postings[3]] });
    expect(rowOf(c, "Video")).toEqual([
      "“First snow” — Uploaded file (no linked post)",
    ]);
    expect(rowOf(c, "Where it was posted")).toEqual([
      "Also posted on Snapchat",
    ]);
    expect(legalText(c).join(" ")).toContain(
      "“First snow” (Uploaded file (no linked post)) as delivered",
    );
  });

  it("a perpetual, worldwide license with music and people excluded", () => {
    const c = contentOf(
      {
        ...SNAPSHOT,
        endsAt: null,
        scope: {
          ...SNAPSHOT.scope,
          termKey: "perpetual",
          termLabel: "Perpetual",
          territoryKey: "worldwide",
          territoryLabel: "Worldwide",
          territoryDetail: null,
        },
        exclusions: { music: true, people: true },
      },
      { ...FACTS, territoryCode: null },
    );
    expect(rowOf(c, "Term")).toEqual([
      "Perpetual: 15 Oct 2026, 14:32 UTC to No end date",
    ]);
    expect(rowOf(c, "Territory")).toEqual(["Worldwide"]);
    expect(rowOf(c, "Excluded")).toEqual([
      `${LICENSE_V1_MUSIC_CLAUSE} ${LICENSE_V1_PEOPLE_CLAUSE}`,
    ]);
    expect(c.summary.groups[0].rows[0]).toMatch(
      /in any country, with no end date\.$/,
    );
    const excluded = c.legal.find((s) => s.title.startsWith("10."));
    expect(excluded?.blocks[0]).toMatchObject({
      items: [
        LICENSE_V1_MUSIC_CLAUSE,
        LICENSE_V1_PEOPLE_CLAUSE,
        expect.any(String),
      ],
    });
  });
});

describe("licensePdfContent: the summary and the footer (05 §9 regions 6, 7; Q-186)", () => {
  const c = contentOf(SNAPSHOT);

  it("reads the request's territory code and the license's end (Q-115 a, Q-183)", () => {
    expect(c.summary.heading).toBe(
      "License summary · Paid social ads · 1 year · United States",
    );
    expect(c.summary.groups.map((group) => group.title)).toEqual([
      "You can",
      "You must",
      "You can't",
      "Not included",
    ]);
    expect(c.summary.groups[0].rows[0]).toMatch(
      /in the United States, until 15 Oct 2027, 14:32 UTC\.$/,
    );
    expect(c.summary.groups.at(-1)?.rows).toEqual([
      "Exclusivity — @maya can license this video to others.",
    ]);
  });

  it("names the page the legal text starts on", () => {
    expect(c.summary.footer(2)).toBe(
      "This summary is not the license. The ClipLease Video License v1 is the legal text, from page 2.",
    );
  });

  it("puts the draft line and the page on every page", () => {
    expect(c.footer.line).toBe(
      "ClipLease · Draft for testing. Not for real transactions.",
    );
    expect(c.footer.page(1, 3)).toBe("Page 1 of 3");
  });
});

describe("licensePdfContent: what its fonts draw (known risk 20)", () => {
  it("keeps every script the fonts cover, with a zero-width space between two emoji", () => {
    const c = contentOf(MULTI_SCRIPT);
    expect(rowOf(c, "Licensee")).toEqual([MULTI_SCRIPT.licensee.name]);
    expect(rowOf(c, "Licensor")?.[0]).toBe(
      `${MULTI_SCRIPT.creator.displayName} (@maya on ClipLease) — Verified · @maya.films on Instagram`,
    );
    expect(rowOf(c, "Video")).toEqual([
      `“${MULTI_SCRIPT.video.title}” — links under “Where it was posted”`,
    ]);
    expect(c.summary.groups[1].rows[0]).toContain(
      "“Video: 王小明 さくら 김민준 🎬\u200B🐶”",
    );
    expect(c.missingGlyphs).toBe(false);
  });

  it('prints a character no font has as "?" and adds the note, the snapshot unchanged', () => {
    const s: LicenseSnapshotV1 = {
      ...SNAPSHOT,
      licensee: { name: "Ꭰ\u2060 Daily Laughs" },
    };
    const before = structuredClone(s);
    const c = contentOf(s);
    expect(rowOf(c, "Licensee")).toEqual(["? Daily Laughs"]);
    expect(legalText(c).join(" ")).toContain('and ? Daily Laughs ("Licensee")');
    expect(c.missingGlyphs).toBe(true);
    expect(c.missingGlyphsNote).toBe(
      `Some characters can't be shown in this PDF. The official record at ${VERIFY_URL} shows them exactly.`,
    );
    expect(s).toEqual(before);
  });
});
