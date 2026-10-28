import { describe, expect, it } from "vitest";
import { creatorUrl, requestStatusPath, videoUrl } from "./urls";

describe("urls", () => {
  it("builds the public creator and video URLs", () => {
    expect(creatorUrl("maya.films")).toBe("/@maya.films");
    expect(videoUrl("maya.films", "first-snow")).toBe(
      "/@maya.films/first-snow",
    );
  });

  it("builds a buyer's status link, with the checkout outcome when there is one", () => {
    const id = "6f4c8d7e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
    expect(requestStatusPath(id, "tok_en-1")).toBe(`/r/${id}?t=tok_en-1`);
    expect(requestStatusPath(id, "tok", { checkout: "canceled" })).toBe(
      `/r/${id}?t=tok&checkout=canceled`,
    );
    expect(
      requestStatusPath(id, "tok", { session_id: "{CHECKOUT_SESSION_ID}" }),
    ).toBe(`/r/${id}?t=tok&session_id={CHECKOUT_SESSION_ID}`);
  });
});
