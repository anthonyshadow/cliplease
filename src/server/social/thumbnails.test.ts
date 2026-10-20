import { describe, expect, it } from "vitest";
import { parseMockAvatar, parseMockThumbnail } from "./thumbnails";

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

describe("parseMockThumbnail (07 D42, mock branch)", () => {
  it("reads the two-digit tile of a mock post thumbnail", () => {
    expect(parseMockThumbnail("mock://thumb/01")).toBe(1);
    expect(parseMockThumbnail("mock://thumb/24")).toBe(24);
    expect(parseMockThumbnail("mock://thumb/99")).toBe(99);
  });

  it("refuses anything else", () => {
    for (const url of [
      null,
      "",
      "mock://thumb/00",
      "mock://thumb/1",
      "mock://thumb/100",
      "mock://thumb/01/x",
      "mock://avatar/01",
      "https://example.com/mock://thumb/01",
      "https://p16-sign.tiktokcdn.com/thumb.jpg",
    ]) {
      expect(parseMockThumbnail(url)).toBeNull();
    }
  });
});
