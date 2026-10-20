import { describe, expect, it } from "vitest";
import { memoryStorage } from "../../../tests/helpers/upload-fakes";
import { UPLOAD_ROUTE_CODES, type UploadErrorCode } from "./codes";
import { PART_BYTES } from "./limits";
import {
  clearResumeHint,
  keepsResumeHint,
  matchesResumeHint,
  planResume,
  type ResumeHint,
  readResumeHint,
  resumeHintKey,
  writeResumeHint,
} from "./resume";

const MIB = 1024 ** 2;
const SIZE = 40 * MIB;
const VIDEO_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_VIDEO_ID = "22222222-2222-4222-8222-222222222222";
const KEY = resumeHintKey(VIDEO_ID);
const HINT: ResumeHint = {
  uploadId: "upload-1",
  name: "IMG_0001.MOV",
  size: SIZE,
  lastModified: 1_760_000_000_000,
};

const storageError = (name: string) => () => {
  throw new DOMException("Storage is not available.", name);
};

describe("planResume (07 D80)", () => {
  it.each<[number[], number[], number]>([
    [[], [1, 2, 3], 0],
    [[1, 2], [3], 32 * MIB],
    [[3], [1, 2], 8 * MIB],
    [[1, 2, 3], [], SIZE],
    [[2, 1, 2, 1], [3], 32 * MIB],
    [[0, 4, -1, 1.5], [1, 2, 3], 0],
    [[3, 0, 3, 4, -1, 1.5], [1, 2], 8 * MIB],
  ])(
    "doneParts %j of 40 MiB → missing %j, %i bytes done",
    (doneParts, missing, doneBytes) => {
      expect(
        planResume({ size: SIZE, partSize: PART_BYTES, doneParts }),
      ).toEqual({ missing, doneBytes });
    },
  );
});

describe("resume hint storage (07 D103)", () => {
  it("keys the hint by video", () => {
    expect(resumeHintKey("v")).toBe("cliplease.upload.v");
  });

  it("round-trips a valid hint with exactly its four keys", () => {
    const store = memoryStorage();
    writeResumeHint(store, VIDEO_ID, HINT);
    expect(JSON.parse(store.items.get(KEY) ?? "")).toStrictEqual(HINT);
    expect(readResumeHint(store, VIDEO_ID)).toStrictEqual(HINT);
    expect(store.items.has(KEY)).toBe(true);
  });

  it("reads null when there is no hint", () => {
    const store = memoryStorage();
    expect(readResumeHint(store, VIDEO_ID)).toBeNull();
    expect(store.removeItem).not.toHaveBeenCalled();
  });

  const { lastModified: _lastModified, ...withoutLastModified } = HINT;
  it.each([
    ["corrupt JSON", '{"uploadId":'],
    ["JSON null", "null"],
    ["a number", "42"],
    ["an array", "[]"],
    ["a string size", JSON.stringify({ ...HINT, size: String(SIZE) })],
    ["a number uploadId", JSON.stringify({ ...HINT, uploadId: 7 })],
    ["a null name", JSON.stringify({ ...HINT, name: null })],
    ["a string lastModified", JSON.stringify({ ...HINT, lastModified: "x" })],
    ["a missing field", JSON.stringify(withoutLastModified)],
    ["an extra field", JSON.stringify({ ...HINT, key: "originals/a/b/c.mp4" })],
    ["size 0", JSON.stringify({ ...HINT, size: 0 })],
    ["size 1.5", JSON.stringify({ ...HINT, size: 1.5 })],
    ["a negative size", JSON.stringify({ ...HINT, size: -1 })],
    ["an empty uploadId", JSON.stringify({ ...HINT, uploadId: "" })],
  ])("reads %s as null and removes the key", (_name, raw) => {
    const otherKey = resumeHintKey(OTHER_VIDEO_ID);
    const store = memoryStorage({
      [KEY]: raw,
      [otherKey]: JSON.stringify(HINT),
    });
    expect(readResumeHint(store, VIDEO_ID)).toBeNull();
    expect(store.items.has(KEY)).toBe(false);
    expect(store.items.has(otherKey)).toBe(true);
  });

  it("reads null when getItem throws", () => {
    const store = memoryStorage({ [KEY]: JSON.stringify(HINT) });
    store.getItem.mockImplementation(storageError("SecurityError"));
    expect(readResumeHint(store, VIDEO_ID)).toBeNull();
  });

  it("reads null when the bad key can't be removed", () => {
    const store = memoryStorage({ [KEY]: "{" });
    store.removeItem.mockImplementation(storageError("SecurityError"));
    expect(readResumeHint(store, VIDEO_ID)).toBeNull();
  });

  it("doesn't throw when setItem throws (quota)", () => {
    const store = memoryStorage();
    store.setItem.mockImplementation(storageError("QuotaExceededError"));
    expect(() => writeResumeHint(store, VIDEO_ID, HINT)).not.toThrow();
    expect(store.items.has(KEY)).toBe(false);
  });

  it("clears the hint, and doesn't throw when removeItem throws", () => {
    const store = memoryStorage({ [KEY]: JSON.stringify(HINT) });
    clearResumeHint(store, VIDEO_ID);
    expect(store.items.has(KEY)).toBe(false);
    store.removeItem.mockImplementation(storageError("SecurityError"));
    expect(() => clearResumeHint(store, VIDEO_ID)).not.toThrow();
  });

  it("with an upload id, clears only a hint naming that upload (owner answer Q-50)", () => {
    const store = memoryStorage({ [KEY]: JSON.stringify(HINT) });
    clearResumeHint(store, VIDEO_ID, "another-upload");
    expect(readResumeHint(store, VIDEO_ID)).toEqual(HINT);
    clearResumeHint(store, VIDEO_ID, HINT.uploadId);
    expect(store.items.has(KEY)).toBe(false);
    expect(() => clearResumeHint(null, VIDEO_ID, HINT.uploadId)).not.toThrow();
  });

  it("treats a null store as no hint and does nothing", () => {
    expect(readResumeHint(null, VIDEO_ID)).toBeNull();
    expect(() => writeResumeHint(null, VIDEO_ID, HINT)).not.toThrow();
    expect(() => clearResumeHint(null, VIDEO_ID)).not.toThrow();
  });
});

describe("keepsResumeHint (07 D80)", () => {
  const KEPT: readonly UploadErrorCode[] = [
    "paused",
    "canceled",
    "network",
    "unauthorized",
    "internal",
    "not_same_file",
  ];
  const EVERY_CODE: readonly UploadErrorCode[] = [
    ...UPLOAD_ROUTE_CODES,
    "network",
    "canceled",
    "unauthorized",
    "paused",
    "stale_upload",
  ];

  it.each(KEPT)("keeps the hint after %s", (code) => {
    expect(keepsResumeHint(code)).toBe(true);
  });

  it.each(EVERY_CODE.filter((code) => !KEPT.includes(code)))(
    "clears it after %s",
    (code) => {
      expect(keepsResumeHint(code)).toBe(false);
    },
  );
});

describe("matchesResumeHint", () => {
  const { uploadId: _uploadId, ...file } = HINT;

  it("matches the same name, size and lastModified", () => {
    expect(matchesResumeHint(HINT, file)).toBe(true);
    const real = new File([new Uint8Array(10)], "a.mp4", { lastModified: 5 });
    expect(
      matchesResumeHint(
        { uploadId: "u", name: "a.mp4", size: 10, lastModified: 5 },
        real,
      ),
    ).toBe(true);
  });

  it.each([
    ["name", { ...file, name: "IMG_0002.MOV" }],
    ["size", { ...file, size: file.size - 1 }],
    ["lastModified", { ...file, lastModified: file.lastModified + 1 }],
  ])("doesn't match a different %s", (_field, other) => {
    expect(matchesResumeHint(HINT, other)).toBe(false);
  });
});
