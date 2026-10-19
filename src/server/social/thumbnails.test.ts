import { describe, expect, it } from "vitest";
import { parseMockAvatar } from "./thumbnails";

describe("parseMockAvatar (07 D42, mock branch)", () => {
  it("reads the two-digit tile of a mock avatar", () => {
    expect(parseMockAvatar("mock://avatar/01")).toBe(1);
    expect(parseMockAvatar("mock://avatar/02")).toBe(2);
    expect(parseMockAvatar("mock://avatar/99")).toBe(99);
  });

  it("refuses anything else", () => {
    for (const url of [
      null,
      "",
      "mock://avatar/00",
      "mock://avatar/1",
      "mock://avatar/100",
      "mock://avatar/01/x",
      "mock://avatar/01?x=1",
      " mock://avatar/01",
      "mock://thumb/01",
      "https://example.com/mock://avatar/01",
      "https://scontent.cdninstagram.com/avatar.jpg",
    ]) {
      expect(parseMockAvatar(url)).toBeNull();
    }
  });
});
