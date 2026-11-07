import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadEvent } from "@/db/schema";
import {
  DOWNLOAD_HEADERS,
  downloadFailed,
  downloadNotFound,
  downloadResponse,
  headNotAllowed,
  recordDownload,
} from "./downloads";

// The download routes' shared answers and their row (owner answer Q-185; 07 D47), with the database and the log mocked
// (the [int] delivery suite runs the routes against the test database).
const mocks = vi.hoisted(() => {
  const values = vi.fn();
  return { values, insert: vi.fn(() => ({ values })), logEvent: vi.fn() };
});
vi.mock("@/server/env", () => ({
  env: { APP_URL: "http://localhost:3100" },
}));
vi.mock("@/db/client", () => ({ db: { insert: mocks.insert } }));
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
});

describe("downloadResponse (Q-185)", () => {
  it("passes the route's answer through", async () => {
    const answer = new Response("ok", { status: 200 });
    expect(await downloadResponse(TOKEN, "pdf", async () => answer)).toBe(
      answer,
    );
    expect(mocks.logEvent).not.toHaveBeenCalled();
  });

  it("turns an unexpected error into the 303, logged without the key", async () => {
    const response = await downloadResponse(TOKEN, "original", async () => {
      throw new TypeError(`storage down for ${TOKEN}`);
    });
    expect(response.status).toBe(303);
    expect(mocks.logEvent).toHaveBeenCalledWith(
      "error",
      "license.download_failed",
      { kind: "original", error: "TypeError" },
    );
    expect(JSON.stringify(mocks.logEvent.mock.calls)).not.toContain(TOKEN);
  });
});
