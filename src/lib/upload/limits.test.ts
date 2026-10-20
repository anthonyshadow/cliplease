import { describe, expect, it } from "vitest";
import {
  expectedPartSize,
  mimeFromFileName,
  ORIGINAL_MAX_BYTES,
  ORIGINAL_MIME,
  PART_BYTES,
  PART_CONCURRENCY,
  PART_MAX_ATTEMPTS,
  PART_URL_BATCH,
  POSTER_MAX_BYTES,
  POSTER_MIME,
  partCount,
  UPLOAD_RESUME_WINDOW_MS,
} from "./limits";

describe("upload limits (07 D80, 02 §5.9)", () => {
  it("declares the contract values", () => {
    expect(ORIGINAL_MAX_BYTES).toBe(2_147_483_648);
    expect(PART_BYTES).toBe(16_777_216);
    expect(PART_CONCURRENCY).toBe(4);
    expect(PART_URL_BATCH).toBe(20);
    expect(PART_MAX_ATTEMPTS).toBe(5);
    expect(UPLOAD_RESUME_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
    expect(POSTER_MAX_BYTES).toBe(2_097_152);
    expect(ORIGINAL_MIME).toEqual(["video/mp4", "video/quicktime"]);
    expect(POSTER_MIME).toBe("image/jpeg");
  });

  it("splits the largest original into 128 parts", () => {
    expect(ORIGINAL_MAX_BYTES / PART_BYTES).toBe(128);
    expect(partCount(ORIGINAL_MAX_BYTES, PART_BYTES)).toBe(128);
  });
});

describe("partCount and expectedPartSize", () => {
  it("rounds up: a remainder makes one more part", () => {
    expect(partCount(1, PART_BYTES)).toBe(1);
    expect(partCount(PART_BYTES, PART_BYTES)).toBe(1);
    expect(partCount(PART_BYTES + 1, PART_BYTES)).toBe(2);
    expect(partCount(10, 4)).toBe(3);
  });

  it("gives every part partSize but the last, which holds the remainder", () => {
    const file = { size: 10, partSize: 4 };
    expect([1, 2, 3].map((n) => expectedPartSize(n, file))).toEqual([4, 4, 2]);
  });

  it("gives an exact multiple a full last part", () => {
    const file = { size: 8, partSize: 4 };
    expect([1, 2].map((n) => expectedPartSize(n, file))).toEqual([4, 4]);
  });
});

describe("mimeFromFileName", () => {
  it.each([
    ["clip.mp4", "video/mp4"],
    ["a.Mp4", "video/mp4"],
    ["CLIP.MP4", "video/mp4"],
    ["IMG_0001.MOV", "video/quicktime"],
    ["holiday.mov", "video/quicktime"],
    ["my.clip.v2.mov", "video/quicktime"],
  ])("%s → %s", (name, mime) => {
    expect(mimeFromFileName(name)).toBe(mime);
  });

  it.each([
    "a.webm",
    "poster.jpg",
    "noext",
    "",
    "mp4",
    ".",
    "clip.mp4 ",
    "clip.mp4.zip",
    "clip.mp4/",
  ])("%j → null", (name) => {
    expect(mimeFromFileName(name)).toBeNull();
  });

  it.each(["clip.constructor", "a.CONSTRUCTOR", "a.toString", "a.valueOf"])(
    "%j → null (an inherited Object property is no extension)",
    (name) => {
      expect(mimeFromFileName(name)).toBeNull();
    },
  );
});
