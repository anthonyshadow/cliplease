import { afterEach, describe, expect, it, vi } from "vitest";
import type { LicenseSnapshotV1 } from "@/lib/licensing/snapshot";
import {
  FIRST_SNOW,
  INSTAGRAM_VERIFIED,
  SNAPCHAT_NO_LINK,
  TIKTOK_VERIFIED,
  US_SCOPE,
} from "../../../tests/helpers/license-snapshot-fixtures";
import { getPublicLicenseView, recordDomain } from "./verify";

// The public record's lookup and its allow-list (research/license.md §6.2–§6.4; 01 J10; 07 D101, D113), with the
// database mocked (the [int] delivery suite reads issued licenses from the test database).
const mocks = vi.hoisted(() => {
  const where = vi.fn();
  const innerJoin = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ innerJoin }));
  const select = vi.fn<(fields: object) => { from: typeof from }>(() => ({
    from,
  }));
  return { select, where };
});
vi.mock("@/db/client", () => ({ db: { select: mocks.select } }));
vi.mock("@/server/env", () => ({
  env: { APP_URL: "https://cliplease.com" },
}));

afterEach(() => {
  vi.clearAllMocks();
});

const CODE = "CL-7K3M-9QXA";
const NOW = new Date("2026-11-07T12:00:00.000Z");

const SNAPSHOT: LicenseSnapshotV1 = {
  ...FIRST_SNOW,
  postings: [INSTAGRAM_VERIFIED, TIKTOK_VERIFIED, SNAPCHAT_NO_LINK],
  scope: US_SCOPE,
  exclusions: { music: true, people: false },
};

/** The row the query selects: the license columns and the request's territory code. */
const row = (over: Partial<Record<string, unknown>> = {}) => ({
  code: CODE,
  createdAt: new Date("2026-10-15T14:32:01.000Z"),
  startsAt: new Date("2026-10-15T14:32:00.000Z"),
  endsAt: new Date("2027-10-15T14:32:00.000Z"),
  revokedAt: null,
  snapshot: SNAPSHOT,
  territoryCode: "US",
  ...over,
});

describe("getPublicLicenseView: codes (07 D101; 01 J10.4)", () => {
  it.each([
    ["cl7k3m9qxa", "/verify/CL-7K3M-9QXA"],
    ["cl-7k3m-9qxa", "/verify/CL-7K3M-9QXA"],
    ["CL-7K3M-9QXA ", "/verify/CL-7K3M-9QXA"],
    ["CL-1OK3-M9QX", "/verify/CL-10K3-M9QX"],
    ["CLIL0K3M9Q", "/verify/CL-110K-3M9Q"],
  ])("sends %j to its canonical page before any read", async (input, to) => {
    expect(await getPublicLicenseView(input, NOW)).toEqual({ redirectTo: to });
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it.each(["CLR-7K3M-9QXA", "", "CL-7K3M", "<script>"])(
    "reads %j as malformed, with no code to print",
    async (input) => {
      expect(await getPublicLicenseView(input, NOW)).toEqual({
        status: "not_found",
        code: null,
      });
      expect(mocks.select).not.toHaveBeenCalled();
    },
  );

  it("keeps an unknown canonical code for the not-found line", async () => {
    mocks.where.mockResolvedValueOnce([]);
    expect(await getPublicLicenseView("CL-0000-0000", NOW)).toEqual({
      status: "not_found",
      code: "CL-0000-0000",
    });
  });
});

describe("getPublicLicenseView: the record (research/license.md §6.3; 01 J10.1, J10.2)", () => {
  it("selects no private column: no reason, note, key, amount or email", async () => {
    mocks.where.mockResolvedValueOnce([row()]);
    await getPublicLicenseView(CODE, NOW);
    expect(Object.keys(mocks.select.mock.calls[0]?.[0] ?? {})).toEqual([
      "code",
      "createdAt",
      "startsAt",
      "endsAt",
      "revokedAt",
      "snapshot",
      "territoryCode",
    ]);
  });

  it("maps a valid license field by field from the snapshot and the license columns", async () => {
    mocks.where.mockResolvedValueOnce([row()]);
    expect(await getPublicLicenseView(CODE, NOW)).toEqual({
      status: "valid",
      code: CODE,
      sentence:
        "This license is active. Daily Laughs Media LLC may use this video for Paid social ads in the United States until 15 Oct 2027, 14:32 UTC.",
      issuedAt: "2026-10-15T14:32:01.000Z",
      startsAt: "2026-10-15T14:32:00.000Z",
      endsAt: "2027-10-15T14:32:00.000Z",
      revokedAt: null,
      licenseeName: "Daily Laughs Media LLC",
      creator: { handle: "maya", displayName: "Maya R." },
      badge: {
        size: "lg",
        ownership: "verified_owner",
        provider: "instagram",
        platformLabel: "Instagram",
        verifiedUsername: "@maya.films",
        linkedAt: "2026-10-12T09:00:00.000Z",
        noLongerLinked: false,
        alsoVerifiedOn: ["TikTok"],
      },
      postings: [
        expect.objectContaining({ platform: "instagram", hasLink: true }),
        expect.objectContaining({ platform: "tiktok", hasLink: true }),
        expect.objectContaining({ platform: "snapchat", hasLink: false }),
      ],
      video: { title: "First snow" },
      scope: {
        useLabel: "Paid social ads",
        termLabel: "1 year",
        territoryLabel: "One country",
        territoryDetail: "United States",
      },
      exclusions: { music: true, people: false },
      exclusive: false,
      termsVersion: "v1",
    });
  });

  it("never carries the amounts, the currency or a field the snapshot gains later", async () => {
    const extra = { ...SNAPSHOT, buyerEmail: "buyer@example.com" };
    mocks.where.mockResolvedValueOnce([row({ snapshot: extra })]);
    const json = JSON.stringify(await getPublicLicenseView(CODE, NOW));
    for (const secret of [
      "amount",
      "Cents",
      "currency",
      "cad",
      "CA$",
      "buyer@example.com",
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it("keeps the demo account's provider for its badge (07 D43)", async () => {
    const demo: LicenseSnapshotV1 = {
      ...SNAPSHOT,
      ownership: {
        kind: "verified_owner",
        provider: "mock",
        providerUsername: "@demo.creator",
        linkedAt: "2026-10-12T09:00:00.000Z",
        verifiedAt: "2026-10-12T09:05:00.000Z",
        sourcePermalink: null,
      },
      postings: [
        {
          platform: "mock",
          label: "Demo",
          url: null,
          verified: true,
          verifiedUsername: "@demo.creator",
          linkedAt: "2026-10-12T09:00:00.000Z",
        },
      ],
    };
    mocks.where.mockResolvedValueOnce([row({ snapshot: demo })]);
    const view = await getPublicLicenseView(CODE, NOW);
    expect(view).toMatchObject({
      badge: { ownership: "verified_owner", provider: "mock" },
    });
  });

  it("uses D113's sentence for an exclusive license (07 D113)", async () => {
    const exclusive = { ...SNAPSHOT, exclusive: true };
    mocks.where.mockResolvedValueOnce([
      row({ snapshot: exclusive, territoryCode: null }),
    ]);
    const view = await getPublicLicenseView(CODE, NOW);
    expect(view).toMatchObject({
      status: "valid",
      exclusive: true,
      sentence:
        "This license is active and exclusive. Daily Laughs Media LLC may use this video for Paid social ads in one country until 15 Oct 2027, 14:32 UTC, and no one else may license it until then.",
    });
  });

  it("is Expired from the instant it ends", async () => {
    mocks.where.mockResolvedValueOnce([row({ endsAt: NOW })]);
    expect(await getPublicLicenseView(CODE, NOW)).toMatchObject({
      status: "expired",
    });
  });

  it("is Revoked with its date and no reason, over Expired", async () => {
    const revokedAt = new Date("2026-11-01T10:00:00.000Z");
    mocks.where.mockResolvedValueOnce([row({ revokedAt, endsAt: NOW })]);
    expect(await getPublicLicenseView(CODE, NOW)).toMatchObject({
      status: "revoked",
      revokedAt: "2026-11-01T10:00:00.000Z",
      sentence: expect.stringContaining(
        "This license was revoked on 1 Nov 2026, 10:00 UTC",
      ),
    });
  });

  it("refuses a stored record that isn't a v1 snapshot", async () => {
    mocks.where.mockResolvedValueOnce([row({ snapshot: { v: 2 } })]);
    await expect(getPublicLicenseView(CODE, NOW)).rejects.toThrow();
  });
});

describe("recordDomain (research/license.md §6.4)", () => {
  it("is APP_URL's host", () => {
    expect(recordDomain()).toBe("cliplease.com");
  });
});
