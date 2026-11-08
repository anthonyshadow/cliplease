import { afterEach, describe, expect, it, vi } from "vitest";
import { FIRST_SNOW } from "../../../tests/helpers/license-snapshot-fixtures";
import { licensePdfResponse } from "./pdf-download";

// The license PDF's answer (Q-183; AD-98), with the renderer, the database and the log mocked (the [int] delivery and
// buyer-licenses suites run the routes against the test database).
const mocks = vi.hoisted(() => {
  const values = vi.fn();
  return {
    values,
    insert: vi.fn(() => ({ values })),
    renderLicensePdf: vi.fn(),
  };
});
vi.mock("@/server/env", () => ({
  env: { APP_URL: "http://localhost:3100" },
}));
vi.mock("@/db/client", () => ({ db: { insert: mocks.insert } }));
vi.mock("../pdf/generate", () => ({
  renderLicensePdf: mocks.renderLicensePdf,
}));
vi.mock("../log", () => ({
  errorName: (error: unknown) =>
    error instanceof Error ? error.name : "unknown",
  logEvent: vi.fn(),
}));

const LICENSE_ID = "0b8f4c1e-6a2d-4e8b-9f3a-5c7d1e2f3a4b";

afterEach(() => {
  vi.clearAllMocks();
});

describe("licensePdfResponse (Q-183; AD-98)", () => {
  const found = {
    license: { id: LICENSE_ID, code: "CL-7K3M-9QXA", snapshot: FIRST_SNOW },
    request: {
      territoryCode: null,
      termsAcceptedAt: new Date("2026-10-15T09:00:00Z"),
    },
  };
  const request = () => new Request("http://localhost:3100/api/my/x/pdf");

  it("renders from the snapshot and the two checkout facts, writes the row, then answers inline", async () => {
    mocks.renderLicensePdf.mockResolvedValue(Buffer.from("%PDF-1.7"));
    const response = await licensePdfResponse(request(), found);
    expect(mocks.renderLicensePdf).toHaveBeenCalledWith(
      found.license.snapshot,
      {
        territoryCode: null,
        acceptedAt: found.request.termsAcceptedAt,
      },
    );
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({ licenseId: LICENSE_ID, kind: "pdf" }),
    );
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers.entries())).toMatchObject({
      "content-type": "application/pdf",
      "content-disposition": expect.stringContaining(
        'inline; filename="ClipLease-CL-7K3M-9QXA-license.pdf"',
      ),
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    });
    expect(await response.text()).toBe("%PDF-1.7");
  });

  it("writes no row when the render fails", async () => {
    mocks.renderLicensePdf.mockRejectedValue(new Error("font missing"));
    await expect(licensePdfResponse(request(), found)).rejects.toThrow();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
