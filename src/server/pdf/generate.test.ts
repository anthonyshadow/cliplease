import { describe, expect, it, vi } from "vitest";
import type { LicenseSnapshotV1 } from "@/lib/licensing/snapshot";
import {
  EMOJI_PAIR,
  FIRST_SNOW,
  MULTI_SCRIPT,
  SCRIPT_NAMES,
  US_SCOPE,
} from "../../../tests/helpers/license-snapshot-fixtures";
import {
  embeddedFonts,
  pageBody,
  pdfPages,
  pdfRuns,
  squash,
} from "../../../tests/helpers/pdf-text";
import { renderLicensePdf } from "./generate";

// The rendered license PDF (05 §9; 01 J9.2; 07 D17, D98, D113; owner answer Q-183; known risk 20): its text read back
// out of the file (tests/helpers/pdf-text), with where each run of text sits.

vi.mock("@/server/env", () => ({ env: { APP_URL: "http://localhost:3100" } }));

const FACTS = {
  territoryCode: "US",
  acceptedAt: new Date("2026-10-15T14:20:00Z"),
};
const OTHER_URL = `https://vimeo.com/123456?${"q=WWWW@@@abcdefghij&".repeat(100)}`;

const SNAPSHOT: LicenseSnapshotV1 = { ...FIRST_SNOW, scope: US_SCOPE };

/** How far the Licensor row's first line, holding `firstLine`, sits above its next line, by their baselines. */
function licensorLeading(pdf: Buffer, firstLine: string): number {
  const runs = pdfRuns(pdf)[0];
  const baseline = (text: string) => {
    const run = runs.find((r) => r.text.includes(text));
    if (!run) throw new Error(`no run holds ${text}`);
    return run.baseline;
  };
  return baseline(firstLine) - baseline("Account linked");
}

/** LETTER's width less the right margin: where every column of the PDF ends. */
const RIGHT_EDGE = 612 - 48;
/** pdfkit writes positions to a millionth of a point: right-aligned text ends at the edge, give or take. */
const ROUNDING = 0.001;

describe("renderLicensePdf (07 D17)", () => {
  it("renders a PDF whose text carries the code, the verify URL, the rights row and the amounts", async () => {
    const pdf = await renderLicensePdf(SNAPSHOT, FACTS);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const [page1, ...legal] = pdfPages(pdf);
    const text = squash(page1);
    expect(text).toContain("CL-7K3M-9QXA");
    expect(text).toContain(squash("http://localhost:3100/verify/CL-7K3M-9QXA"));
    expect(text).toContain(
      squash("Issued 15 Oct 2026, 14:32 UTC · Non-exclusive"),
    );
    expect(text).toContain(squash("Rights Non-exclusive"));
    expect(text).toContain(
      squash("License fee CA$1,575.00 + service fee CA$157.50 = CA$1,732.50"),
    );
    expect(text).toContain(squash("Amounts in Canadian dollars (CAD)."));
    expect(text).toContain(squash("the legal text, from page 2."));
    expect(text).toContain(
      squash("ClipLease · Draft for testing. Not for real transactions."),
    );
    expect(squash(legal[0])).toContain(squash("1. Agreement"));
    expect(squash(legal.join(""))).toContain("ScheduleA");
    expect(text).not.toContain("{");
    expect(text).not.toContain("Somecharacters");
    expect(
      embeddedFonts(pdf)
        .map((font) => font.slice(7))
        .sort(),
    ).toEqual(["Inter-Bold", "Inter-Regular"]);
  });

  it("prints an exclusive license's end in the Rights row (07 D113)", async () => {
    const pdf = await renderLicensePdf({ ...SNAPSHOT, exclusive: true }, FACTS);
    const text = squash(pdfPages(pdf)[0]);
    expect(text).toContain(squash("Issued 15 Oct 2026, 14:32 UTC · Exclusive"));
    expect(text).toContain(
      squash("Rights Exclusive until 15 Oct 2027, 14:32 UTC"),
    );
  });

  it("prints a long link whole and a long name, numbering the pages it takes", async () => {
    const name = `Daily Laughs Media ${"International Holdings ".repeat(6)}LLC`;
    const pdf = await renderLicensePdf(
      {
        ...SNAPSHOT,
        endsAt: null,
        licensee: { name },
        scope: {
          ...SNAPSHOT.scope,
          termKey: "perpetual",
          termLabel: "Perpetual",
        },
        postings: [
          ...SNAPSHOT.postings,
          {
            platform: "other",
            label: "Vimeo",
            url: OTHER_URL,
            verified: false,
            verifiedUsername: null,
            linkedAt: null,
          },
        ],
      },
      FACTS,
    );
    expect(pdf.length).toBeGreaterThan(1024);
    const pages = pdfPages(pdf);
    const all = pages.map(pageBody).join("");
    expect(all).toContain(OTHER_URL);
    expect(all).toContain(squash(name));
    expect(all).toContain(
      squash("Perpetual: 15 Oct 2026, 14:32 UTC to No end date"),
    );
    // The record runs onto page 2 here, so the legal text starts on page 3.
    expect(all).toContain(squash("the legal text, from page 3."));
    expect(squash(pages[2])).toContain(squash("1. Agreement"));
    expect(squash(pages[0])).toContain(squash(`Page 1 of ${pages.length}`));
  });

  it("cuts a long name and a long title without a space to their columns, keeping every character (PD-5)", async () => {
    const name = "WWLaughsMediaHoldings".repeat(6).slice(0, 120);
    const title = "MMSnowAtDawnOverLakeLouise".repeat(4).slice(0, 100);
    const pdf = await renderLicensePdf(
      { ...SNAPSHOT, licensee: { name }, video: { ...SNAPSHOT.video, title } },
      FACTS,
    );
    const all = pdfPages(pdf).map(pageBody).join("");
    expect(all).toContain(name);
    expect(all).toContain(`“${title}”`);
    // A piece of either: 8 of its characters in a row.
    const isPiece = (word: string) =>
      Array.from({ length: word.length - 7 }, (_, i) =>
        word.slice(i, i + 8),
      ).some((part) => name.includes(part) || title.includes(part));
    // Each piece is a line of its own: its run ends where its last glyph does, by the embedded fonts' widths.
    const pieces = pdfRuns(pdf)
      .flat()
      .filter(({ text }) => text.split(" ").some(isPiece));
    // Two lines each: the Licensee and Video rows, §1 and §2.
    expect(pieces).toHaveLength(8);
    for (const { text, right } of pieces) {
      expect(right, text).toBeLessThanOrEqual(RIGHT_EDGE + ROUNDING);
    }
  });

  it("prints every script its fonts cover, embedding a subset of each family it draws (known risk 20)", async () => {
    const pdf = await renderLicensePdf(
      { ...MULTI_SCRIPT, scope: US_SCOPE },
      FACTS,
    );
    // Without the zero-width space between two emoji (printable).
    const all = pdfPages(pdf).map(pageBody).join("").replaceAll("\u200B", "");
    // Right-to-left words come out as drawn, left to right: "محمد" reads "دمحم" ("דוד" reads the same both ways).
    const drawn = (name: string) =>
      /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(name)
        ? [...name].reverse().join("")
        : name;
    for (const name of [...SCRIPT_NAMES, EMOJI_PAIR]) {
      expect(all).toContain(squash(drawn(name)));
    }
    // No "?" in its place, no note, and no missing-glyph box (glyph 0 reads U+0000).
    expect(all).not.toContain("?");
    expect(all).not.toContain("Somecharacters");
    expect(all).not.toContain("\u0000");
    const fonts = embeddedFonts(pdf);
    for (const font of fonts) expect(font).toMatch(/^[A-Z]{6}\+/);
    expect(fonts.map((font) => font.slice(7)).sort()).toEqual([
      "Inter-Bold",
      "Inter-Regular",
      "NotoEmoji-Regular",
      "NotoSansArabic-Regular",
      "NotoSansCJKsc-Regular",
      "NotoSansDevanagari-Regular",
      "NotoSansHebrew-Regular",
      "NotoSansThai-Regular",
    ]);
    // Measured with the fallback fonts' own widths, nothing runs past the right margin.
    for (const { text, right } of pdfRuns(pdf).flat()) {
      expect(right, text).toBeLessThanOrEqual(RIGHT_EDGE + ROUNDING);
    }
    // A line with Arabic, the tallest fallback font, keeps Inter's baseline: it sits as high as a Latin one.
    const latin = await renderLicensePdf(SNAPSHOT, FACTS);
    expect(licensorLeading(pdf, "دمحم")).toBeCloseTo(
      licensorLeading(latin, "Maya R."),
      3,
    );
  });

  it('prints a character no font has as "?", the note after the official-record line (known risk 20)', async () => {
    const pdf = await renderLicensePdf(
      { ...SNAPSHOT, licensee: { name: "Ꭰ Daily Laughs" } },
      FACTS,
    );
    const page1 = pageBody(pdfPages(pdf)[0]);
    expect(page1).toContain(squash("Licensee ? Daily Laughs"));
    const official = squash(
      "Official record: http://localhost:3100/verify/CL-7K3M-9QXA. If this document and that page differ, the page is correct.",
    );
    const note = squash(
      "Some characters can't be shown in this PDF. The official record at http://localhost:3100/verify/CL-7K3M-9QXA shows them exactly.",
    );
    expect(page1).toContain(`${official}${note}`);
  });

  it("renders the same bytes every time (01 J9.2)", async () => {
    const [a, b] = await Promise.all([
      renderLicensePdf(SNAPSHOT, FACTS),
      renderLicensePdf(SNAPSHOT, FACTS),
    ]);
    expect(a.equals(b)).toBe(true);
  });
});
