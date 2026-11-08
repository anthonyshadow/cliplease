import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadEvent } from "@/db/schema";
import { FIRST_SNOW } from "../../../tests/helpers/license-snapshot-fixtures";
import {
  DOWNLOAD_HEADERS,
  downloadFailed,
  downloadNotFound,
  downloadResponse,
  headNotAllowed,
  licensePdfResponse,
  myDownloadFailed,
  recordDownload,
} from "./downloads";

// The download routes' shared answers and their row (owner answer Q-185; 07 D47), with the database and the log mocked
// (the [int] delivery suite runs the routes against the test database).
const mocks = vi.hoisted(() => {
  const values = vi.fn();
  return {
    values,
    insert: vi.fn(() => ({ values })),
    logEvent: vi.fn(),
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
  logEvent: mocks.logEvent,
}));

const TOKEN = `${"A".repeat(42)}_`;
const LICENSE_ID = "0b8f4c1e-6a2d-4e8b-9f3a-5c7d1e2f3a4b";

afterEach(() => {
  vi.clearAllMocks();
});

const headersOf = (response: Response) =>
  Object.fromEntries(response.headers.entries());

describe("recordDownload (07 D47)", () => {
  it("logs the request's own address and user agent", async () => {
    const request = new Request("http://localhost:3100/api/licenses/x/pdf", {
      headers: {
        "x-forwarded-for": "203.0.113.7, 10.0.0.1",
        "user-agent": "x".repeat(600),
      },
    });
    await recordDownload(request, LICENSE_ID, "pdf");
    expect(mocks.insert).toHaveBeenCalledWith(downloadEvent);
    expect(mocks.values).toHaveBeenCalledWith({
      licenseId: LICENSE_ID,
      kind: "pdf",
      ip: "203.0.113.7",
      userAgent: "x".repeat(512),
    });
  });

  it("keeps no address inet would refuse, and no empty agent", async () => {
    const request = new Request("http://localhost:3100/", {
      headers: { "x-forwarded-for": "fe80::1%lo0" },
    });
    await recordDownload(request, LICENSE_ID, "original");
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({ ip: null, userAgent: null }),
    );
  });
});

describe("the shared answers", () => {
  it("are never cached and send no referrer", () => {
    for (const response of [
      downloadNotFound(),
      headNotAllowed(),
      downloadFailed(TOKEN),
      myDownloadFailed(LICENSE_ID),
    ]) {
      expect(headersOf(response)).toMatchObject({
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      });
    }
    expect(DOWNLOAD_HEADERS).toEqual({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    });
  });

  it("answer HEAD with 405 and an empty body", async () => {
    const response = headNotAllowed();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expect(await response.text()).toBe("");
  });

  it("send a failure back to /l with the flag, and a non-key to the 404", () => {
    const failed = downloadFailed(TOKEN);
    expect(failed.status).toBe(303);
    expect(failed.headers.get("location")).toBe(
      `http://localhost:3100/l/${TOKEN}?download=failed`,
    );
    const bad = downloadFailed("../../admin");
    expect(bad.status).toBe(404);
    expect(bad.headers.get("location")).toBeNull();
  });

  it("send a failed session download back to /licenses/{id} with the flag, and a non-uuid to the 404 (P20b)", () => {
    const failed = myDownloadFailed(LICENSE_ID);
    expect(failed.status).toBe(303);
    expect(failed.headers.get("location")).toBe(
      `http://localhost:3100/licenses/${LICENSE_ID}?download=failed`,
    );
    const bad = myDownloadFailed("not-a-uuid");
    expect(bad.status).toBe(404);
    expect(bad.headers.get("location")).toBeNull();
  });
});

describe("downloadResponse (Q-185)", () => {
  const failed = () => downloadFailed(TOKEN);

  it("passes the route's answer through", async () => {
    const answer = new Response("ok", { status: 200 });
    const onFailure = vi.fn(failed);
    expect(await downloadResponse("pdf", async () => answer, onFailure)).toBe(
      answer,
    );
    expect(onFailure).not.toHaveBeenCalled();
    expect(mocks.logEvent).not.toHaveBeenCalled();
  });

  it("turns an unexpected error into the failure answer, logged without the key", async () => {
    const response = await downloadResponse(
      "original",
      async () => {
        throw new TypeError(`storage down for ${TOKEN}`);
      },
      failed,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost:3100/l/${TOKEN}?download=failed`,
    );
    expect(mocks.logEvent).toHaveBeenCalledWith(
      "error",
      "license.download_failed",
      { kind: "original", error: "TypeError" },
    );
    expect(JSON.stringify(mocks.logEvent.mock.calls)).not.toContain(TOKEN);
  });
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
    expect(headersOf(response)).toMatchObject({
      "content-type": "application/pdf",
      "content-disposition": expect.stringContaining(
        'inline; filename="ClipLease-CL-7K3M-9QXA-license.pdf"',
      ),
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    });
    expect(await response.text()).toBe("%PDF-1.7");
  });

  it("writes no row when the render fails", async () => {
    mocks.renderLicensePdf.mockRejectedValue(new Error("font missing"));
    await expect(licensePdfResponse(request(), found)).rejects.toThrow();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
