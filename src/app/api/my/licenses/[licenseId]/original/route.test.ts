import { redirect } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadEvent } from "@/db/schema";
import { signInPath } from "@/lib/sign-in";
import type { requireUser } from "@/server/auth/session";
import type { getBuyerLicense } from "@/server/buyers/queries";
import {
  BUYER,
  buyerLicenseDetail,
  KEY,
  LICENSE_ID,
} from "../../../../../../../tests/helpers/buyer-license-fixtures";
import { GET, HEAD } from "./route";

// The original by the session (07 D126; owner answer Q-185): the sign-in gate before the download wrapper, the lookup
// by the session's email, the valid-only gate, the signed URL's name, the row after the URL and the failure bounce to
// /licenses/{id}, with the session, the lookup, the signer and the database mocked (the [int] suite runs it against the
// test database and local storage).
const mocks = vi.hoisted(() => {
  const values = vi.fn();
  return {
    requireUser: vi.fn<typeof requireUser>(),
    getBuyerLicense: vi.fn<typeof getBuyerLicense>(),
    presignDownload: vi.fn(),
    values,
    insert: vi.fn(() => ({ values })),
    logEvent: vi.fn(),
  };
});
vi.mock("@/server/env", () => ({
  env: { APP_URL: "http://localhost:3100" },
}));
vi.mock("@/db/client", () => ({ db: { insert: mocks.insert } }));
vi.mock("@/server/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/server/buyers/queries", () => ({
  getBuyerLicense: mocks.getBuyerLicense,
}));
vi.mock("@/server/storage/uploads", () => ({
  presignDownload: mocks.presignDownload,
}));
vi.mock("@/server/log", () => ({
  errorName: (error: unknown) =>
    error instanceof Error ? error.name : "unknown",
  logEvent: mocks.logEvent,
}));

const SIGNED = `http://localhost:3100/api/dev/storage/${KEY}?sig=abc`;

const request = () =>
  new Request(`http://localhost:3100/api/my/licenses/${LICENSE_ID}/original`, {
    headers: { "x-forwarded-for": "203.0.113.7" },
  });
const get = (licenseId = LICENSE_ID) =>
  GET(request(), { params: Promise.resolve({ licenseId }) });

beforeEach(() => {
  mocks.requireUser.mockResolvedValue(BUYER);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/my/licenses/[licenseId]/original", () => {
  it("answers the buyer's valid license with a 302 to the signed URL, never cached or indexed, named ClipLease-{code}-original.mp4", async () => {
    mocks.getBuyerLicense.mockResolvedValue(buyerLicenseDetail());
    mocks.presignDownload.mockResolvedValue(SIGNED);
    const response = await get();
    expect(mocks.requireUser).toHaveBeenCalledWith(`/licenses/${LICENSE_ID}`);
    expect(mocks.getBuyerLicense).toHaveBeenCalledWith(BUYER, LICENSE_ID);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(SIGNED);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(mocks.presignDownload).toHaveBeenCalledWith({
      key: KEY,
      filename: "ClipLease-CL-7K3M-9QXA-original.mp4",
      disposition: "attachment",
      contentType: "video/mp4",
    });
    expect(mocks.insert).toHaveBeenCalledWith(downloadEvent);
    expect(mocks.values).toHaveBeenCalledWith({
      licenseId: LICENSE_ID,
      kind: "original",
      ip: "203.0.113.7",
      userAgent: null,
    });
  });

  it.each([
    ["another email's license, an unknown or a malformed id", null],
    ["an expired license", buyerLicenseDetail("expired")],
    ["a revoked license", buyerLicenseDetail("revoked")],
  ])(
    "gives %s the empty 404, never indexed, with no URL and no row",
    async (_, row) => {
      mocks.getBuyerLicense.mockResolvedValue(row);
      const response = await get();
      expect(response.status).toBe(404);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-robots-tag")).toBe("noindex");
      expect(await response.text()).toBe("");
      expect(mocks.presignDownload).not.toHaveBeenCalled();
      expect(mocks.insert).not.toHaveBeenCalled();
    },
  );

  it("sends a signed-out visitor to sign-in with this license as next, never answering it as a failed download", async () => {
    mocks.requireUser.mockImplementation(async (next) =>
      redirect(signInPath(next ?? "")),
    );
    await expect(get()).rejects.toMatchObject({
      digest: `NEXT_REDIRECT;replace;/sign-in?next=%2Flicenses%2F${LICENSE_ID};307;`,
    });
    expect(mocks.getBuyerLicense).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.logEvent).not.toHaveBeenCalled();
  });

  it("sends the buyer back to /licenses/{id}?download=failed when storage fails, with no row and nothing private logged", async () => {
    mocks.getBuyerLicense.mockResolvedValue(buyerLicenseDetail());
    mocks.presignDownload.mockRejectedValue(new TypeError("storage down"));
    const response = await get();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost:3100/licenses/${LICENSE_ID}?download=failed`,
    );
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.logEvent).toHaveBeenCalledWith(
      "error",
      "license.download_failed",
      { kind: "original", error: "TypeError" },
    );
    expect(JSON.stringify(mocks.logEvent.mock.calls)).not.toContain(
      BUYER.email,
    );
  });

  it("answers a failed lookup the same way", async () => {
    mocks.getBuyerLicense.mockRejectedValue(
      new Error("buyers.license_read_failed"),
    );
    const response = await get();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost:3100/licenses/${LICENSE_ID}?download=failed`,
    );
    expect(mocks.presignDownload).not.toHaveBeenCalled();
  });
});

describe("HEAD /api/my/licenses/[licenseId]/original", () => {
  it("answers 405 without a session read or a lookup", () => {
    const response = HEAD();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.getBuyerLicense).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
