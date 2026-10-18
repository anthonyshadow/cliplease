import { describe, expect, it } from "vitest";
import { creatorUrl, videoUrl } from "./urls";

describe("urls", () => {
  it("builds the public creator and video URLs", () => {
    expect(creatorUrl("maya.films")).toBe("/@maya.films");
    expect(videoUrl("maya.films", "first-snow")).toBe(
      "/@maya.films/first-snow",
    );
  });
});
