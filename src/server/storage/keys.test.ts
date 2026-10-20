import { describe, expect, it } from "vitest";
import { originalKey, posterKey, posterKeyVideoId } from "./keys";
import { ORIGINAL_EXTENSION } from "./limits";

const CREATOR_ID = "11111111-1111-4111-8111-111111111111";
const VIDEO_ID = "22222222-2222-4222-8222-222222222222";
const UUID =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

describe("ORIGINAL_EXTENSION", () => {
  it("maps the validated type to its extension", () => {
    expect(ORIGINAL_EXTENSION["video/mp4"]).toBe("mp4");
    expect(ORIGINAL_EXTENSION["video/quicktime"]).toBe("mov");
  });
});

describe("originalKey", () => {
  it("is originals/{creatorId}/{videoId}/{uuid}.{ext}", () => {
    expect(originalKey(CREATOR_ID, VIDEO_ID, "mp4")).toMatch(
      new RegExp(`^originals/${CREATOR_ID}/${VIDEO_ID}/${UUID}\\.mp4$`),
    );
    expect(originalKey(CREATOR_ID, VIDEO_ID, "mov")).toMatch(
      new RegExp(`^originals/${CREATOR_ID}/${VIDEO_ID}/${UUID}\\.mov$`),
    );
  });

  it("takes the extension from the validated type", () => {
    expect(
      originalKey(CREATOR_ID, VIDEO_ID, ORIGINAL_EXTENSION["video/quicktime"]),
    ).toMatch(/\.mov$/);
    expect(
      originalKey(CREATOR_ID, VIDEO_ID, ORIGINAL_EXTENSION["video/mp4"]),
    ).toMatch(/\.mp4$/);
  });

  it("makes a new uuid on every call", () => {
    const a = originalKey(CREATOR_ID, VIDEO_ID, "mp4");
    const b = originalKey(CREATOR_ID, VIDEO_ID, "mp4");
    expect(a).not.toBe(b);
  });

  it("has no room for a file name: only ids, a uuid and the extension", () => {
    const segments = originalKey(CREATOR_ID, VIDEO_ID, "mov").split("/");
    expect(segments).toHaveLength(4);
    expect(segments.slice(0, 3)).toEqual(["originals", CREATOR_ID, VIDEO_ID]);
    expect(segments[3]).toMatch(new RegExp(`^${UUID}\\.mov$`));
  });
});

describe("posterKey", () => {
  it("is posters/{videoId}/{uuid}.jpg", () => {
    expect(posterKey(VIDEO_ID)).toMatch(
      new RegExp(`^posters/${VIDEO_ID}/${UUID}\\.jpg$`),
    );
  });

  it("makes a new uuid on every call", () => {
    expect(posterKey(VIDEO_ID)).not.toBe(posterKey(VIDEO_ID));
  });

  it("names only the video and a uuid", () => {
    const segments = posterKey(VIDEO_ID).split("/");
    expect(segments).toHaveLength(3);
    expect(segments.slice(0, 2)).toEqual(["posters", VIDEO_ID]);
  });
});

describe("posterKeyVideoId", () => {
  it("reads the video back from a key posterKey made", () => {
    expect(posterKeyVideoId(posterKey(VIDEO_ID))).toBe(VIDEO_ID);
  });

  it("is null for any other key", () => {
    const own = posterKey(VIDEO_ID);
    for (const key of [
      originalKey(CREATOR_ID, VIDEO_ID, "mp4"),
      own.replace(/\.jpg$/, ".png"),
      `${own}x`,
      `x${own}`,
      own.replace("posters/", "posters/../"),
      "",
    ]) {
      expect(posterKeyVideoId(key)).toBeNull();
    }
  });
});
