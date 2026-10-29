import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { captureLogEvents } from "../../../tests/helpers/logs";
import { getCreatorForApi } from "../auth/session";
import { uploadRoute } from "./upload-http";

vi.mock("../auth/session", () => ({ getCreatorForApi: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
});

const jsonPost = () =>
  new Request("http://localhost/api/uploads/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });

describe("uploadRoute's error contract", () => {
  it("answers a failed session read with the routes' internal code, uncached, logging the class only", async () => {
    const logs = captureLogEvents("uploads.route_failed");
    vi.mocked(getCreatorForApi).mockRejectedValueOnce(
      new Error("select from creator_profile where user_id = 'u-1'"),
    );
    const handle = vi.fn();
    const response = await uploadRoute(jsonPost(), z.object({}), handle);
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ code: "internal" });
    expect(handle).not.toHaveBeenCalled();
    const { written, events } = logs();
    expect(events).toEqual([expect.objectContaining({ error: "Error" })]);
    expect(written).not.toContain("u-1");
  });
});
