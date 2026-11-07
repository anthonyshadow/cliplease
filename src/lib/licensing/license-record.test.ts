import { describe, expect, it } from "vitest";
import {
  FACEBOOK_UNVERIFIED,
  FIRST_SNOW,
  INSTAGRAM_URL,
  INSTAGRAM_VERIFIED,
  SNAPCHAT_NO_LINK,
  TIKTOK_VERIFIED,
} from "../../../tests/helpers/license-snapshot-fixtures";
import { APP_NAME, SUPPORT_EMAIL } from "../app-name";
import { buyerPostingRow } from "../postings/buyer-rows";
import { BADGE_COPY, badgeExplainer, badgeText } from "../videos/ownership";
import {
  amountsIn,
  amountsText,
  DOWNLOAD_FAILED,
  downloadFailedPath,
  downloadsText,
  endDateText,
  exclusionRows,
  LICENSE_RECORD_COPY,
  licenseStatusPill,
  licenseSummaryInput,
  rightsLabel,
  snapshotBadge,
  snapshotPostings,
  termText,
  verifyFooter,
  verifySentence,
  verifyTitle,
} from "./license-record";
import { type LicenseSnapshotV1, LicenseSnapshotV1Schema } from "./snapshot";
import { licenseSummary } from "./summary";

// The license record's words and mappings (05 §4.4, §4.5, §9; 07 D70, D71, D98, D113; owner answers Q-183–Q-186).

// Verified first (TikTok sits before the source posting, Instagram), then the creator's order.
const SNAPSHOT: LicenseSnapshotV1 = {
  ...FIRST_SNOW,
  postings: [
    TIKTOK_VERIFIED,
    INSTAGRAM_VERIFIED,
    FACEBOOK_UNVERIFIED,
    SNAPCHAT_NO_LINK,
    {
      platform: "other",
      label: "Vimeo",
      url: "https://www.vimeo.com/123456?h=abc",
      verified: false,
      verifiedUsername: null,
      linkedAt: null,
    },
  ],
};

const EXCLUSIVE: LicenseSnapshotV1 = {
  ...SNAPSHOT,
  code: "CL-5RJN-3VDE",
  startsAt: "2026-11-20T15:00:00.000Z",
  endsAt: "2027-11-20T15:00:00.000Z",
  exclusive: true,
};

const PERPETUAL: LicenseSnapshotV1 = {
  ...SNAPSHOT,
  endsAt: null,
  scope: { ...SNAPSHOT.scope, termKey: "perpetual", termLabel: "Perpetual" },
};

const COUNTRY: LicenseSnapshotV1 = {
  ...SNAPSHOT,
  scope: {
    ...SNAPSHOT.scope,
    territoryKey: "country",
    territoryLabel: "One country",
    territoryDetail: "United States",
  },
};

const SELF_ATTESTED: LicenseSnapshotV1 = {
  ...SNAPSHOT,
  ownership: { kind: "self_attested" },
  postings: SNAPSHOT.postings.filter((p) => !p.verified),
  creditLine: "Video: @maya",
};

const DEMO: LicenseSnapshotV1 = {
  ...SNAPSHOT,
  ownership: {
    kind: "verified_owner",
    provider: "mock",
    providerUsername: "@demo.creator",
    linkedAt: "2026-10-12T09:00:00.000Z",
    verifiedAt: "2026-10-12T09:05:00.000Z",
    sourcePermalink: "https://demo.cliplease.test/p/abc123",
  },
  postings: [
    {
      platform: "mock",
      label: "Demo",
      url: "https://demo.cliplease.test/p/abc123",
      verified: true,
      verifiedUsername: "@demo.creator",
      linkedAt: "2026-10-12T09:00:00.000Z",
    },
  ],
};

describe("the fixtures", () => {
  it.each([SNAPSHOT, EXCLUSIVE, PERPETUAL, COUNTRY, SELF_ATTESTED, DEMO])(
    "are snapshots LicenseSnapshotV1Schema accepts (%#)",
    (s) => {
      expect(LicenseSnapshotV1Schema.parse(s)).toEqual(s);
    },
  );
});

describe("licenseStatusPill", () => {
  it("is Valid filled, Expired neutral and Revoked danger", () => {
    expect(licenseStatusPill("valid")).toEqual({
      label: "Valid",
      tone: "cleared",
    });
    expect(licenseStatusPill("expired")).toEqual({
      label: "Expired",
      tone: "neutral",
    });
    expect(licenseStatusPill("revoked")).toEqual({
      label: "Revoked",
      tone: "danger",
    });
  });
});

describe("rightsLabel (07 D113)", () => {
  it("reads Exclusive until the UTC end, or Non-exclusive", () => {
    expect(rightsLabel(EXCLUSIVE)).toBe(
      "Exclusive until 20 Nov 2027, 15:00 UTC",
    );
    expect(rightsLabel(SNAPSHOT)).toBe("Non-exclusive");
    expect(rightsLabel(PERPETUAL)).toBe("Non-exclusive");
  });

  it("refuses an exclusive license with no end, which can't exist (I35)", () => {
    expect(() => rightsLabel({ exclusive: true, endsAt: null })).toThrow();
  });
});

describe("termText and endDateText", () => {
  it("prints the term with both UTC dates", () => {
    expect(termText(SNAPSHOT)).toBe(
      "1 year · 15 Oct 2026, 14:32 UTC to 15 Oct 2027, 14:32 UTC",
    );
    expect(endDateText(SNAPSHOT.endsAt)).toBe("15 Oct 2027, 14:32 UTC");
  });

  it("gives Perpetual a start and No end date", () => {
    expect(termText(PERPETUAL)).toBe(
      "Perpetual · From 15 Oct 2026, 14:32 UTC · No end date",
    );
    expect(endDateText(null)).toBe("No end date");
  });
});

describe("amountsText and amountsIn (07 D94, D98)", () => {
  it("fills License v1's Paid row in the snapshot's currency", () => {
    expect(amountsText(SNAPSHOT.amounts)).toBe(
      "License fee CA$1,575.00 + service fee CA$157.50 = CA$1,732.50",
    );
    expect(amountsIn("cad")).toBe("Amounts in Canadian dollars (CAD).");
  });

  it("prints a USD license in US dollars, with no bare $", () => {
    const usd = { ...SNAPSHOT.amounts, currency: "usd" } as const;
    expect(amountsText(usd)).toBe(
      "License fee US$1,575.00 + service fee US$157.50 = US$1,732.50",
    );
    expect(amountsIn("usd")).toBe("Amounts in US dollars (USD).");
  });
});

describe("licenseSummaryInput (01 §4.7; Q-183)", () => {
  const useIt = (s: LicenseSnapshotV1, code: string | null) =>
    licenseSummary(licenseSummaryInput(s, code))
      .groups.flatMap((g) => g.rows)
      .find((r) => r.label === "Use it")?.text;

  it("names the request's country and the license's end", () => {
    expect(useIt(COUNTRY, "US")).toMatch(
      / in the United States, until 15 Oct 2027, 14:32 UTC\.$/,
    );
    expect(useIt(SNAPSHOT, null)).toMatch(
      / in any country, until 15 Oct 2027, 14:32 UTC\.$/,
    );
  });

  it("keeps with no end date for Perpetual", () => {
    expect(licenseSummaryInput(PERPETUAL, null).termPhrase).toBe(
      "with no end date",
    );
    expect(useIt(PERPETUAL, null)).toMatch(/, with no end date\.$/);
  });

  it("carries the snapshot's flags, credit line and exclusive variant", () => {
    const input = licenseSummaryInput(
      { ...EXCLUSIVE, exclusions: { music: true, people: true } },
      null,
    );
    expect(input).toMatchObject({
      handle: "maya",
      creditLine: "Video: @maya.films on Instagram",
      containsMusic: true,
      identifiablePeople: true,
      exclusive: true,
    });
    const summary = licenseSummary(input);
    expect(summary.heading).toBe(
      "License summary · Exclusive · Paid social ads · 1 year · Worldwide",
    );
    expect(summary.groups[0]).toEqual({
      title: "You get",
      rows: [
        {
          label: "Exclusivity",
          text: "@maya won't license this video to anyone else, for any use or place, until 20 Nov 2027, 15:00 UTC.",
        },
      ],
    });
  });
});

describe("snapshotPostings (07 D70, D71)", () => {
  it("maps every row with no removal or disconnect, a link when the record kept one", () => {
    const { postings } = snapshotPostings(SNAPSHOT);
    expect(postings.map((p) => p.label)).toEqual([
      "TikTok",
      "Instagram",
      "Facebook",
      "Snapchat",
      "Vimeo",
    ]);
    expect(postings.every((p) => !p.removed && !p.noLongerLinked)).toBe(true);
    expect(postings.map((p) => p.hasLink)).toEqual([
      true,
      true,
      true,
      false,
      true,
    ]);
    expect(postings.map((p) => p.hostLabel)).toEqual([
      null,
      null,
      null,
      null,
      "vimeo.com",
    ]);
  });

  it("picks the ownership's posting as primary, wherever it sits", () => {
    const { primary, postings } = snapshotPostings(SNAPSHOT);
    expect(primary).toBe(postings[1]);
    expect(primary).toMatchObject({
      platform: "instagram",
      verifiedUsername: "@maya.films",
      url: INSTAGRAM_URL,
    });
    expect(snapshotPostings(SELF_ATTESTED).primary).toBeNull();
  });

  it("reads a posting with no link kept as Also posted on (PROGRESS P18 follow-up)", () => {
    const rows = snapshotPostings(SNAPSHOT).postings.map(buyerPostingRow);
    expect(rows.map((r) => r.kind)).toEqual([
      "verified",
      "verified",
      "named",
      "also",
      "named",
    ]);
    expect(rows[4].link?.text).toBe("vimeo.com ↗");
  });
});

describe("snapshotBadge (04 §9.19; 07 D43, D70, D89)", () => {
  it("names the ownership's account, with the other verified platforms at lg", () => {
    expect(badgeText(snapshotBadge(SNAPSHOT, "sm")).line1).toBe(
      "Verified · @maya.films · Instagram",
    );
    expect(badgeText(snapshotBadge(SNAPSHOT, "lg"))).toEqual({
      line1: "Verified · @maya.films on Instagram",
      line2: "Account linked 12 Oct 2026",
      line3: "Also verified on TikTok",
    });
  });

  it("keeps the demo account's wording", () => {
    expect(badgeText(snapshotBadge(DEMO, "lg"))).toEqual({
      line1: "Verified · @demo.creator (demo account)",
      line2: "Account linked 12 Oct 2026",
      line3: null,
    });
  });

  it("is self-attested with the D70 sentence when a posting isn't verified", () => {
    const badge = snapshotBadge(SELF_ATTESTED, "lg");
    expect(badgeText(badge).line1).toBe("Self-attested by the creator");
    expect(badgeExplainer(badge)).toEqual([
      BADGE_COPY.selfAttestedExplainer,
      BADGE_COPY.postingsExplainer,
    ]);
  });
});

describe("verifySentence (research/license.md §6.4; 07 D113; Q-186)", () => {
  const facts = { territoryCode: null, revokedAt: null };

  it("says a standard license is active in the territory until its end", () => {
    expect(verifySentence(SNAPSHOT, "valid", facts)).toBe(
      "This license is active. Daily Laughs Media LLC may use this video for Paid social ads in any country until 15 Oct 2027, 14:32 UTC.",
    );
    expect(
      verifySentence(COUNTRY, "valid", { ...facts, territoryCode: "US" }),
    ).toContain(" in the United States until ");
    expect(verifySentence(PERPETUAL, "valid", facts)).toBe(
      "This license is active. Daily Laughs Media LLC may use this video for Paid social ads in any country with no end date.",
    );
  });

  it("uses D113's sentence for an exclusive license", () => {
    expect(verifySentence(EXCLUSIVE, "valid", facts)).toBe(
      "This license is active and exclusive. Daily Laughs Media LLC may use this video for Paid social ads in any country until 20 Nov 2027, 15:00 UTC, and no one else may license it until then.",
    );
  });

  it("says when an expired or revoked license stopped, with no reason", () => {
    expect(verifySentence(EXCLUSIVE, "expired", facts)).toBe(
      "This license ended on 20 Nov 2027, 15:00 UTC. It no longer allows any use of this video.",
    );
    expect(
      verifySentence(SNAPSHOT, "revoked", {
        ...facts,
        revokedAt: new Date("2026-10-20T08:15:00Z"),
      }),
    ).toBe(
      `This license was revoked on 20 Oct 2026, 08:15 UTC and no longer allows any use of this video. Questions? ${SUPPORT_EMAIL}`,
    );
    expect(() => verifySentence(SNAPSHOT, "revoked", facts)).toThrow();
  });

  it("titles the page with the status and the code", () => {
    expect(verifyTitle("valid", "CL-7K3M-9QXA")).toBe(
      "Valid license: CL-7K3M-9QXA",
    );
    expect(verifyTitle("expired", "CL-7K3M-9QXA")).toBe(
      "Expired: CL-7K3M-9QXA",
    );
    expect(verifyTitle("revoked", "CL-7K3M-9QXA")).toBe(
      "Revoked: CL-7K3M-9QXA",
    );
    expect(LICENSE_RECORD_COPY.verify.notFoundHeading).toBe("No license found");
  });
});

describe("the /verify extras", () => {
  it("lists an exclusion row only when flagged", () => {
    expect(exclusionRows({ music: false, people: false })).toEqual([]);
    expect(exclusionRows({ music: true, people: true })).toEqual([
      { label: "Music", value: "not included" },
      { label: "People", value: "no releases" },
    ]);
  });

  it("ends the footer with the D43 explainer and D70's sentence (J10.5)", () => {
    const footer = verifyFooter("cliplease.com");
    expect(footer[0]).toBe(
      `${APP_NAME} keeps the official record of every license. If anything here differs from a PDF you were shown, this page is correct. Check that your address bar shows cliplease.com. This page never shows prices or contact details.`,
    );
    expect(footer.slice(1)).toEqual([
      BADGE_COPY.verifiedExplainer,
      BADGE_COPY.postingsExplainer,
    ]);
  });

  it("prints the not-found copy with CL- codes (07 D101)", () => {
    const { verify } = LICENSE_RECORD_COPY;
    expect(verify.notFound("CL-0000-0000")).toBe(
      "We couldn't find a license with the code CL-0000-0000.",
    );
    expect(verify.notFoundHelp).toContain(
      "License codes look like CL-XXXX-XXXX",
    );
    expect(verify.notFoundHelp).not.toContain("CLR-");
  });
});

describe("downloadsText (Q-186)", () => {
  it("is nothing at 0, then counts in words", () => {
    expect(downloadsText(0)).toBeNull();
    expect(downloadsText(1)).toBe("Downloaded 1 time");
    expect(downloadsText(2)).toBe("Downloaded 2 times");
  });
});

describe("the /l and PDF copy", () => {
  it("reads the receipt and the revoked lines (04 §10.2; Q-186)", () => {
    const { buyer } = LICENSE_RECORD_COPY;
    expect(buyer.receipt("CA$1,732.50", "15 Oct 2026", "m…@example.com")).toBe(
      "Paid CA$1,732.50 on 15 Oct 2026. Receipt sent to m…@example.com. Questions? Reply to the license email.",
    );
    expect(buyer.revokedOn("20 Oct 2026, 08:15 UTC")).toBe(
      "Revoked on 20 Oct 2026, 08:15 UTC.",
    );
    expect(buyer.revoked).toBe(
      `This license no longer allows any use of this video. Questions? ${SUPPORT_EMAIL}`,
    );
    expect(buyer.title("First snow")).toBe("Cleared: First snow");
  });

  it("puts the draft line in the PDF footer", () => {
    expect(LICENSE_RECORD_COPY.pdfFooter).toBe(
      `${APP_NAME} · Draft for testing. Not for real transactions.`,
    );
    expect(LICENSE_RECORD_COPY.pageOf(1, 3)).toBe("Page 1 of 3");
  });
});

describe("downloadFailedPath (Q-185)", () => {
  it("sends a failed download back to /l with the flag /l reads", () => {
    const token = "a".repeat(43);
    expect(downloadFailedPath(token)).toBe(`/l/${token}?download=failed`);
    expect(DOWNLOAD_FAILED).toEqual({ param: "download", value: "failed" });
  });
});
