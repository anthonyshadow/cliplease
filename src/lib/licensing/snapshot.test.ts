import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import {
  buildLicenseSnapshot,
  type LicenseSnapshotInput,
  type LicenseSnapshotV1,
  LicenseSnapshotV1Schema,
  type SnapshotPosting,
} from "./snapshot";

// The license's immutable record (03 §3.7.2; 07 D70, D71, D93, D94): built from plain values, checked by its schema.

const LINKED = new Date("2026-09-01T10:00:00Z");
const VERIFIED = new Date("2026-09-02T11:30:00Z");

const posting = (
  overrides: Partial<SnapshotPosting> & Pick<SnapshotPosting, "position">,
): SnapshotPosting => ({
  platform: "facebook",
  otherLabel: null,
  url: null,
  showLink: true,
  isSource: false,
  verification: "unverified",
  verifiedUsername: null,
  verifiedAccountLinkedAt: null,
  verifiedAt: null,
  removed: false,
  ...overrides,
});

const verified = (
  overrides: Partial<SnapshotPosting> & Pick<SnapshotPosting, "position">,
): SnapshotPosting =>
  posting({
    platform: "mock",
    url: "https://demo.cliplease.test/p/abc123",
    verification: "verified",
    verifiedUsername: "@maya",
    verifiedAccountLinkedAt: LINKED,
    verifiedAt: VERIFIED,
    ...overrides,
  });

const input = (
  overrides: Partial<LicenseSnapshotInput> = {},
): LicenseSnapshotInput => ({
  code: "CL-7K3M-9QXA",
  issuedAt: new Date("2026-10-30T12:00:01Z"),
  startsAt: new Date("2026-10-30T12:00:00Z"),
  endsAt: new Date("2027-10-30T12:00:00Z"),
  request: {
    licenseeName: "Daily Laughs Media LLC",
    useKey: "paid_social",
    termKey: "y1",
    territoryKey: "worldwide",
    territoryCode: null,
    licensePriceCents: 157500,
    platformFeeCents: 15750,
    amountTotalCents: 173250,
    currency: "cad",
  },
  video: {
    id: "7d3c0a52-5b1e-4f7e-9f61-0d6f4a1b2c3d",
    title: "First snow",
    durationMs: 12000,
    width: 1080,
    height: 1920,
    containsMusic: false,
    identifiablePeople: true,
  },
  creator: { handle: "maya", displayName: "Maya Chen" },
  postings: [],
  ...overrides,
});

describe("buildLicenseSnapshot (07 D71)", () => {
  it("keeps a verified posting's link out when the creator hides it", () => {
    const s = buildLicenseSnapshot(
      input({ postings: [verified({ position: 0, showLink: false })] }),
    );
    expect(s.ownership).toEqual({
      kind: "verified_owner",
      provider: "mock",
      providerUsername: "@maya",
      linkedAt: LINKED.toISOString(),
      verifiedAt: VERIFIED.toISOString(),
      sourcePermalink: null,
    });
    expect(s.postings[0]?.url).toBeNull();
  });

  it("keeps the source posting's link when shown", () => {
    const s = buildLicenseSnapshot(
      input({ postings: [verified({ position: 0, isSource: true })] }),
    );
    expect(s.ownership).toMatchObject({
      sourcePermalink: "https://demo.cliplease.test/p/abc123",
    });
    expect(s.postings[0]?.url).toBe("https://demo.cliplease.test/p/abc123");
  });

  it("lists verified Demo, unverified Facebook and Other in that order; the Facebook row has no username", () => {
    const s = buildLicenseSnapshot(
      input({
        postings: [
          verified({ position: 0 }),
          posting({
            position: 1,
            url: "https://www.facebook.com/reel/123",
          }),
          posting({
            position: 2,
            platform: "other",
            otherLabel: " Vimeo ",
            url: "https://vimeo.com/1",
          }),
        ],
      }),
    );
    expect(s.postings).toEqual([
      {
        platform: "mock",
        label: "Demo",
        url: "https://demo.cliplease.test/p/abc123",
        verified: true,
        verifiedUsername: "@maya",
        linkedAt: LINKED.toISOString(),
      },
      {
        platform: "facebook",
        label: "Facebook",
        url: "https://www.facebook.com/reel/123",
        verified: false,
        verifiedUsername: null,
        linkedAt: null,
      },
      {
        platform: "other",
        label: "Vimeo",
        url: "https://vimeo.com/1",
        verified: false,
        verifiedUsername: null,
        linkedAt: null,
      },
    ]);
  });

  it("puts a verified posting before an unverified one at a lower position", () => {
    const s = buildLicenseSnapshot(
      input({
        postings: [
          posting({ position: 0 }),
          verified({ position: 3, platform: "instagram" }),
        ],
      }),
    );
    expect(s.postings.map((p) => p.platform)).toEqual([
      "instagram",
      "facebook",
    ]);
  });

  it("takes the verified source posting as primary over a lower-position verified one (07 D70)", () => {
    const s = buildLicenseSnapshot(
      input({
        postings: [
          verified({
            position: 1,
            platform: "instagram",
            verifiedUsername: "@maya.ig",
          }),
          verified({
            position: 2,
            platform: "tiktok",
            verifiedUsername: "@maya.tt",
            isSource: true,
          }),
        ],
      }),
    );
    expect(s.ownership).toMatchObject({
      provider: "tiktok",
      providerUsername: "@maya.tt",
    });
    expect(s.creditLine).toBe("Video: @maya.tt on TikTok");
  });

  it("never takes a released source posting as primary, nor keeps its stale username", () => {
    const s = buildLicenseSnapshot(
      input({
        postings: [
          posting({
            position: 0,
            platform: "instagram",
            isSource: true,
            verifiedUsername: "@stale",
            verifiedAccountLinkedAt: LINKED,
            verifiedAt: VERIFIED,
          }),
          verified({ position: 1, platform: "youtube" }),
        ],
      }),
    );
    expect(s.ownership).toMatchObject({ provider: "youtube" });
    const released = s.postings.find((p) => p.platform === "instagram");
    expect(released).toMatchObject({
      verified: false,
      verifiedUsername: null,
      linkedAt: null,
    });
  });

  it("keeps no link to a verified post the platform removed", () => {
    const s = buildLicenseSnapshot(
      input({
        postings: [verified({ position: 0, isSource: true, removed: true })],
      }),
    );
    expect(s.ownership).toMatchObject({
      kind: "verified_owner",
      sourcePermalink: null,
    });
    expect(s.postings[0]?.url).toBeNull();
  });

  it("is self-attested with the creator's handle as credit without a verified posting", () => {
    const s = buildLicenseSnapshot(
      input({ postings: [posting({ position: 0 })] }),
    );
    expect(s.ownership).toEqual({ kind: "self_attested" });
    expect(s.creditLine).toBe("Video: @maya");
  });

  it("credits a YouTube channel title as stored, with no '@'", () => {
    const s = buildLicenseSnapshot(
      input({
        postings: [
          verified({
            position: 0,
            platform: "youtube",
            verifiedUsername: "Maya Films",
          }),
        ],
      }),
    );
    expect(s.creditLine).toBe("Video: Maya Films on YouTube");
  });

  it("keeps the mock provider and names it Demo", () => {
    const s = buildLicenseSnapshot(
      input({ postings: [verified({ position: 0 })] }),
    );
    expect(s.ownership).toMatchObject({ provider: "mock" });
    expect(s.postings[0]?.label).toBe("Demo");
    expect(s.creditLine).toBe("Video: @maya on Demo");
  });

  it.each([
    {
      territoryKey: "country",
      territoryCode: "FR",
      label: "One country",
      detail: "France",
    },
    {
      territoryKey: "region",
      territoryCode: "europe",
      label: "One region",
      detail: "Europe",
    },
    {
      territoryKey: "worldwide",
      territoryCode: null,
      label: "Worldwide",
      detail: null,
    },
  ] as const)(
    "labels a $territoryKey territory",
    ({ territoryKey, territoryCode, label, detail }) => {
      const s = buildLicenseSnapshot(
        input({
          request: { ...input().request, territoryKey, territoryCode },
        }),
      );
      expect(s.scope).toEqual({
        useKey: "paid_social",
        useLabel: "Paid social ads",
        termKey: "y1",
        termLabel: "1 year",
        territoryKey,
        territoryLabel: label,
        territoryDetail: detail,
      });
    },
  );

  it("maps the rights answers to the exclusions", () => {
    const s = buildLicenseSnapshot(
      input({
        video: {
          ...input().video,
          containsMusic: true,
          identifiablePeople: false,
        },
      }),
    );
    expect(s.exclusions).toEqual({ music: true, people: false });
  });

  it.each(["cad", "usd"] as const)(
    "carries the request's amounts in its currency (%s, 07 D94)",
    (currency) => {
      const s = buildLicenseSnapshot(
        input({ request: { ...input().request, currency } }),
      );
      expect(s.amounts).toEqual({
        licensePriceCents: 157500,
        platformFeeCents: 15750,
        amountTotalCents: 173250,
        currency,
      });
    },
  );

  it("is a standard first-term license of an adult creator: no guardian, not exclusive, no renewal", () => {
    const s = buildLicenseSnapshot(input());
    expect(s.creator).toEqual({ handle: "maya", displayName: "Maya Chen" });
    expect(Object.keys(s.creator)).not.toContain("guardianName");
    expect(JSON.stringify(s)).not.toContain("guardian");
    expect(s.exclusive).toBe(false);
    expect(s.renewalOfCode).toBeNull();
  });

  it("stamps the code and dates in UTC ISO, a perpetual license with no end", () => {
    const s = buildLicenseSnapshot(input({ endsAt: null }));
    expect(s).toMatchObject({
      v: 1,
      termsVersion: "v1",
      code: "CL-7K3M-9QXA",
      issuedAt: "2026-10-30T12:00:01.000Z",
      startsAt: "2026-10-30T12:00:00.000Z",
      endsAt: null,
      licensee: { name: "Daily Laughs Media LLC" },
    });
  });
});

describe("LicenseSnapshotV1Schema", () => {
  const full = () =>
    buildLicenseSnapshot(
      input({
        postings: [
          verified({ position: 0, isSource: true }),
          posting({ position: 1, url: "https://www.facebook.com/reel/1" }),
        ],
      }),
    );

  it("round-trips a built snapshot", () => {
    const s = full();
    expect(LicenseSnapshotV1Schema.parse(s)).toEqual(s);
    const selfAttested = buildLicenseSnapshot(input());
    expect(LicenseSnapshotV1Schema.parse(selfAttested)).toEqual(selfAttested);
  });

  it("refuses a code that isn't CL-XXXX-XXXX", () => {
    expect(
      LicenseSnapshotV1Schema.safeParse({ ...full(), code: "CLR-7K3M-9QXA" })
        .success,
    ).toBe(false);
  });

  it("refuses a snapshot missing a field", () => {
    const { exclusive: _, ...missing } = full();
    expect(LicenseSnapshotV1Schema.safeParse(missing).success).toBe(false);
  });

  it("drops a key the record doesn't have", () => {
    const parsed = LicenseSnapshotV1Schema.parse({
      ...full(),
      guardianName: "x",
    });
    expect(parsed).not.toHaveProperty("guardianName");
  });
});

describe("LicenseSnapshotV1Schema", () => {
  it("describes the same record as the hand-written type (03 §3.7.2)", () => {
    expectTypeOf<
      z.infer<typeof LicenseSnapshotV1Schema>
    >().toEqualTypeOf<LicenseSnapshotV1>();
  });
});
