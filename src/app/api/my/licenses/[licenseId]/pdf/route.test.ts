import { redirect } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadEvent } from "@/db/schema";
import { signInPath } from "@/lib/sign-in";
import type { requireUser } from "@/server/auth/session";
import type { getBuyerLicense } from "@/server/buyers/queries";
import {
  BUYER,
  buyerLicenseDetail,
  LICENSE_ID,
} from "../../../../../../../tests/helpers/buyer-license-fixtures";
import { GET, HEAD } from "./route";

// The license PDF by the session (07 D126, D16, D17; owner answer Q-185): the sign-in gate before the download wrapper,
// the lookup by the session's email, the 404 only when revoked, the inline PDF after the row and the failure bounce to
// /licenses/{id}, with the session, the lookup, the renderer and the database mocked (the [int] suite renders it).
const mocks = vi.hoisted(() => {
  const values = vi.fn();
  return {
    requireUser: vi.fn<typeof requireUser>(),
    getBuyerLicense: vi.fn<typeof getBuyerLicense>(),
    renderLicensePdf: vi.fn(),
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
vi.mock("@/server/pdf/generate", () => ({
  renderLicensePdf: mocks.renderLicensePdf,
}));
vi.mock("@/server/log", () => ({
  errorName: (error: unknown) =>
    error instanceof Error ? error.name : "unknown",
  logEvent: mocks.logEvent,
}));

const request = () =>
  new Request(`http://localhost:3100/api/my/licenses/${LICENSE_ID}/pdf`, {
    headers: { "x-forwarded-for": "203.0.113.7" },
  });
const get = () =>
  GET(request(), { params: Promise.resolve({ licenseId: LICENSE_ID }) });

beforeEach(() => {
  mocks.requireUser.mockResolvedValue(BUYER);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/my/licenses/[licenseId]/pdf", () => {
  it.each(["valid", "expired"] as const)(
    "renders a %s license's PDF inline, never cached or indexed, after its row",
    async (status) => {
      const row = buyerLicenseDetail(status);
      mocks.getBuyerLicense.mockResolvedValue(row);
      mocks.renderLicensePdf.mockResolvedValue(Buffer.from("%PDF-1.7"));
      const response = await get();
      expect(mocks.requireUser).toHaveBeenCalledWith(`/licenses/${LICENSE_ID}`);
      expect(mocks.getBuyerLicense).toHaveBeenCalledWith(BUYER, LICENSE_ID);
      expect(mocks.renderLicensePdf).toHaveBeenCalledWith(
        row.license.snapshot,
        {
          territoryCode: null,
          acceptedAt: row.request.termsAcceptedAt,
        },
      );
      expect(response.status).toBe(200);
      expect(Object.fromEntries(response.headers.entries())).toMatchObject({
        "content-type": "application/pdf",
        "content-disposition": expect.stringContaining(
          'inline; filename="ClipLease-CL-7K3M-9QXA-license.pdf"',
        ),
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-robots-tag": "noindex",
      });
      expect(await response.text()).toBe("%PDF-1.7");
      expect(mocks.insert).toHaveBeenCalledWith(downloadEvent);
      expect(mocks.values).toHaveBeenCalledWith({
        licenseId: LICENSE_ID,
        kind: "pdf",
        ip: "203.0.113.7",
        userAgent: null,
      });
    },
  );

  it.each([
    ["another email's license, an unknown or a malformed id", null],
    ["a revoked license", buyerLicenseDetail("revoked")],
  ])(
    "gives %s the empty 404, never indexed, with no render and no row",
    async (_, row) => {
      mocks.getBuyerLicense.mockResolvedValue(row);
      const response = await get();
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-robots-tag")).toBe("noindex");
      expect(await response.text()).toBe("");
      expect(mocks.renderLicensePdf).not.toHaveBeenCalled();
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
    expect(mocks.renderLicensePdf).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.logEvent).not.toHaveBeenCalled();
  });

  it("sends the buyer back to /licenses/{id}?download=failed when the render fails, with no row and nothing private logged", async () => {
    mocks.getBuyerLicense.mockResolvedValue(buyerLicenseDetail());
    mocks.renderLicensePdf.mockRejectedValue(new Error("font missing"));
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
      { kind: "pdf", error: "Error" },
    );
    expect(JSON.stringify(mocks.logEvent.mock.calls)).not.toContain(
      BUYER.email,
    );
  });
});

describe("HEAD /api/my/licenses/[licenseId]/pdf", () => {
  it("answers 405 without a session read, a lookup or a render", () => {
    const response = HEAD();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.getBuyerLicense).not.toHaveBeenCalled();
    expect(mocks.renderLicensePdf).not.toHaveBeenCalled();
  });
});
