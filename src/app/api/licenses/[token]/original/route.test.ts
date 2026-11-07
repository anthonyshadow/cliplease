import { afterEach, describe, expect, it, vi } from "vitest";
import type { BuyerLicense } from "@/server/tokens/buyer-token";
import { GET, HEAD } from "./route";

// The original's route (07 D16, D61; owner answer Q-185): the gate, the signed URL's name, the row after the URL and the
// failure bounce, with the lookup, the signer and the row mocked (the [int] delivery suite runs it against the test
// database and local storage).
const mocks = vi.hoisted(() => ({
  findLicenseForBuyer: vi.fn(),
  presignDownload: vi.fn(),
  recordDownload: vi.fn(),
  logEvent: vi.fn(),
}));
vi.mock("@/server/env", () => ({
  env: { APP_URL: "http://localhost:3100" },
}));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/server/tokens/buyer-token", async (actual) => ({
  ...(await actual<typeof import("@/server/tokens/buyer-token")>()),
  findLicenseForBuyer: mocks.findLicenseForBuyer,
}));
vi.mock("@/server/storage/uploads", () => ({
  presignDownload: mocks.presignDownload,
}));
vi.mock("@/server/licensing/downloads", async (actual) => ({
  ...(await actual<typeof import("@/server/licensing/downloads")>()),
  recordDownload: mocks.recordDownload,
}));
vi.mock("@/server/log", () => ({
  errorName: (error: unknown) =>
    error instanceof Error ? error.name : "unknown",
  logEvent: mocks.logEvent,
}));

const TOKEN = `${"A".repeat(42)}_`;
const KEY = "originals/creator/video.mp4";
const SIGNED = `http://localhost:3100/api/dev/storage/${KEY}?sig=abc`;
const DAY = 86_400_000;

function found(over: Partial<BuyerLicense["license"]> = {}) {
  return {
    license: {
      id: "0b8f4c1e-6a2d-4e8b-9f3a-5c7d1e2f3a4b",
      code: "CL-7K3M-9QXA",
      startsAt: new Date(Date.now() - DAY),
      endsAt: new Date(Date.now() + DAY),
      revokedAt: null,
      originalObjectKey: KEY,
      originalBytes: 84 * 1024 ** 2,
      originalMime: "video/mp4",
      ...over,
    },
  };
}

const request = () =>
  new Request(`http://localhost:3100/api/licenses/${TOKEN}/original`, {
    headers: { "x-forwarded-for": "203.0.113.7" },
  });
const get = (req = request()) =>
  GET(req, { params: Promise.resolve({ token: TOKEN }) });

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/licenses/[token]/original", () => {
  it("answers a valid license with a 302 to the signed URL, never cached, named ClipLease-{code}-original.mp4", async () => {
    mocks.findLicenseForBuyer.mockResolvedValue(found());
    mocks.presignDownload.mockResolvedValue(SIGNED);
    const req = request();
    const response = await get(req);
    expect(mocks.findLicenseForBuyer).toHaveBeenCalledWith(TOKEN);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(SIGNED);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.presignDownload).toHaveBeenCalledWith({
      key: KEY,
      filename: "ClipLease-CL-7K3M-9QXA-original.mp4",
      disposition: "attachment",
      contentType: "video/mp4",
    });
    expect(mocks.recordDownload).toHaveBeenCalledWith(
      req,
      found().license.id,
      "original",
    );
  });

  it("names a MOV original .mov", async () => {
    mocks.findLicenseForBuyer.mockResolvedValue(
      found({ originalMime: "video/quicktime" }),
    );
    mocks.presignDownload.mockResolvedValue(SIGNED);
    await get();
    expect(mocks.presignDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "ClipLease-CL-7K3M-9QXA-original.mov",
      }),
    );
  });

  it.each([
    ["a wrong key", null],
    ["an expired license", found({ endsAt: new Date(Date.now() - 1000) })],
    ["a revoked license", found({ revokedAt: new Date(Date.now() - 1000) })],
  ])("gives %s the empty 404, with no URL and no row", async (_, row) => {
    mocks.findLicenseForBuyer.mockResolvedValue(row);
    const response = await get();
    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).toBe("");
    expect(mocks.presignDownload).not.toHaveBeenCalled();
    expect(mocks.recordDownload).not.toHaveBeenCalled();
  });

  it("sends the buyer back to /l?download=failed when storage fails, with no row and nothing private logged", async () => {
    mocks.findLicenseForBuyer.mockResolvedValue(found());
    mocks.presignDownload.mockRejectedValue(new TypeError("storage down"));
    const response = await get();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost:3100/l/${TOKEN}?download=failed`,
    );
    expect(mocks.recordDownload).not.toHaveBeenCalled();
    expect(mocks.logEvent).toHaveBeenCalledWith(
      "error",
      "license.download_failed",
      { kind: "original", error: "TypeError" },
    );
    expect(JSON.stringify(mocks.logEvent.mock.calls)).not.toContain(TOKEN);
  });

  it("treats an original of an unknown type as a failure, not a download", async () => {
    mocks.findLicenseForBuyer.mockResolvedValue(
      found({ originalMime: "video/webm" }),
    );
    const response = await get();
    expect(response.status).toBe(303);
    expect(mocks.presignDownload).not.toHaveBeenCalled();
  });
});

describe("HEAD /api/licenses/[token]/original", () => {
  it("answers 405 without looking anything up", () => {
    const response = HEAD();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expect(mocks.findLicenseForBuyer).not.toHaveBeenCalled();
    expect(mocks.recordDownload).not.toHaveBeenCalled();
  });
});
