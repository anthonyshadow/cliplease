import { createHash } from "node:crypto";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { countingStream } from "../../../tests/helpers/streams";
import { MultipartError, StorageKeyError } from "./errors";
import { PART_BYTES, UPLOAD_RESUME_WINDOW_MS } from "./limits";
import {
  contentTypeOf,
  createLocalStorage,
  isStorageKey,
  isUploadId,
  type LocalStorage,
} from "./local";
import { type SignedRequest, verifyLocalRequest } from "./local-url";

const MIB = 1024 ** 2;
const R2_MIN_PART = 5 * MIB;
const APP_URL = "http://localhost:3000";
const SUBKEY = Buffer.alloc(32, 9);
const START_MS = 1_800_000_000_000;
const KEY =
  "originals/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.mp4";
const POSTER_KEY =
  "posters/22222222-2222-4222-8222-222222222222/55555555-5555-4555-8555-555555555555.jpg";
const NEVER_CREATED = "77777777-7777-4777-8777-777777777777";

let root: string;
let clock: number;
let store: LocalStorage;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "cliplease-local-storage-"));
  clock = START_MS;
  store = createLocalStorage({
    root,
    appUrl: APP_URL,
    subkey: SUBKEY,
    now: () => clock,
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** `size` bytes of `fill`: a distinct fill per part makes the assembled order checkable. */
const bytes = (size: number, fill: number) => Buffer.alloc(size, fill);

const md5 = (data: Uint8Array) => createHash("md5").update(data).digest("hex");

/** A web stream of `chunks`, as the dev route hands over `request.body`. */
function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

/** A lazy stream of `total` bytes in 1 MiB chunks (the last one shorter), counting the pulls, reporting a cancel. */
function lazyStream(total: number) {
  const chunk = new Uint8Array(MIB).fill(0x5a);
  return countingStream(
    Array.from({ length: Math.ceil(total / MIB) }, (_, i) =>
      chunk.subarray(0, Math.min(MIB, total - i * MIB)),
    ),
  );
}

async function readAll(body: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** The error `promise` rejects with (fails the test when it resolves). */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

async function multipartReason(promise: Promise<unknown>) {
  const error = await rejection(promise);
  expect(error).toBeInstanceOf(MultipartError);
  return (error as MultipartError).reason;
}

const exists = async (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

const uploadDirOf = (uploadId: string) =>
  path.join(root, ".multipart", uploadId);

async function putPart(
  uploadId: string,
  partNumber: number,
  data: Uint8Array,
  key = KEY,
) {
  return store.receivePart({ key, uploadId, partNumber }, streamOf(data));
}

/** Lists the parts and fails the test if the upload is gone. */
async function partsOf(uploadId: string, key = KEY) {
  const parts = await store.listParts({ key, uploadId });
  if (parts === "no_such_upload") throw new Error("upload is gone");
  return parts;
}

describe("multipart upload", () => {
  it("creates a manifest under .multipart/{uploadId}", async () => {
    const { uploadId } = await store.createMultipart({
      key: KEY,
      contentType: "video/mp4",
    });
    expect(isUploadId(uploadId)).toBe(true);
    const manifest = JSON.parse(
      await readFile(path.join(uploadDirOf(uploadId), "manifest.json"), "utf8"),
    );
    expect(manifest).toEqual({
      key: KEY,
      contentType: "video/mp4",
      createdAt: START_MS,
    });
    expect(await store.listParts({ key: KEY, uploadId })).toEqual([]);
  });

  it("stores three parts, lists them sorted with quoted MD5 ETags, and completes them in order", async () => {
    const { uploadId } = await store.createMultipart({
      key: KEY,
      contentType: "video/mp4",
    });
    const one = bytes(R2_MIN_PART, 1);
    const two = bytes(R2_MIN_PART, 2);
    const three = bytes(4321, 3);

    // Out of order on purpose: listParts sorts.
    expect(await putPart(uploadId, 3, three)).toEqual({
      etag: `"${md5(three)}"`,
    });
    expect(await putPart(uploadId, 1, one)).toEqual({ etag: `"${md5(one)}"` });
    expect(await putPart(uploadId, 2, two)).toEqual({ etag: `"${md5(two)}"` });

    const parts = await partsOf(uploadId);
    expect(parts).toEqual([
      { partNumber: 1, size: R2_MIN_PART, etag: `"${md5(one)}"` },
      { partNumber: 2, size: R2_MIN_PART, etag: `"${md5(two)}"` },
      { partNumber: 3, size: 4321, etag: `"${md5(three)}"` },
    ]);

    await store.completeMultipart({ key: KEY, uploadId, parts });

    const object = await readFile(path.join(root, KEY));
    expect(object.length).toBe(2 * R2_MIN_PART + 4321);
    expect(object.equals(Buffer.concat([one, two, three]))).toBe(true);
    expect(await exists(uploadDirOf(uploadId))).toBe(false);
    expect(await store.listParts({ key: KEY, uploadId })).toBe(
      "no_such_upload",
    );
    // No temp file is left next to the object.
    expect(await readdir(path.dirname(path.join(root, KEY)))).toEqual([
      path.basename(KEY),
    ]);
  });

  it("completes a single part of any size", async () => {
    const { uploadId } = await store.createMultipart({
      key: KEY,
      contentType: "video/mp4",
    });
    const only = bytes(100, 7);
    await putPart(uploadId, 1, only);
    await store.completeMultipart({
      key: KEY,
      uploadId,
      parts: await partsOf(uploadId),
    });
    expect((await readFile(path.join(root, KEY))).equals(only)).toBe(true);
  });

  it("assembles a part streamed in several chunks", async () => {
    const { uploadId } = await store.createMultipart({
      key: KEY,
      contentType: "video/mp4",
    });
    const a = bytes(10, 1);
    const b = bytes(20, 2);
    const result = await store.receivePart(
      { key: KEY, uploadId, partNumber: 1 },
      streamOf(a, b),
    );
    expect(result).toEqual({ etag: `"${md5(Buffer.concat([a, b]))}"` });
    expect(await partsOf(uploadId)).toEqual([
      { partNumber: 1, size: 30, etag: `"${md5(Buffer.concat([a, b]))}"` },
    ]);
  });

  describe("R2's part rules → invalid_part", () => {
    it("refuses a short middle part", async () => {
      const { uploadId } = await store.createMultipart({
        key: KEY,
        contentType: "video/mp4",
      });
      await putPart(uploadId, 1, bytes(R2_MIN_PART, 1));
      await putPart(uploadId, 2, bytes(R2_MIN_PART - 1, 2));
      await putPart(uploadId, 3, bytes(10, 3));
      const parts = await partsOf(uploadId);
      expect(
        await multipartReason(
          store.completeMultipart({ key: KEY, uploadId, parts }),
        ),
      ).toBe("invalid_part");
      expect(await store.head(KEY)).toBeNull();
      // A refused complete leaves the upload open for a retry.
      expect(await partsOf(uploadId)).toHaveLength(3);
    });

    it("refuses equal parts under R2's 5 MiB minimum", async () => {
      const { uploadId } = await store.createMultipart({
        key: KEY,
        contentType: "video/mp4",
      });
      await putPart(uploadId, 1, bytes(1000, 1));
      await putPart(uploadId, 2, bytes(1000, 2));
      await putPart(uploadId, 3, bytes(10, 3));
      expect(
        await multipartReason(
          store.completeMultipart({
            key: KEY,
            uploadId,
            parts: await partsOf(uploadId),
          }),
        ),
      ).toBe("invalid_part");
    });

    it("refuses a wrong ETag", async () => {
      const { uploadId } = await store.createMultipart({
        key: KEY,
        contentType: "video/mp4",
      });
      await putPart(uploadId, 1, bytes(R2_MIN_PART, 1));
      await putPart(uploadId, 2, bytes(10, 2));
      const [, second] = await partsOf(uploadId);
      expect(
        await multipartReason(
          store.completeMultipart({
            key: KEY,
            uploadId,
            parts: [
              { partNumber: 1, etag: `"${"0".repeat(32)}"` },
              { partNumber: 2, etag: second?.etag ?? "" },
            ],
          }),
        ),
      ).toBe("invalid_part");
      expect(await store.head(KEY)).toBeNull();
    });

    it("refuses a part number that was never stored, parts out of order and an empty list", async () => {
      const { uploadId } = await store.createMultipart({
        key: KEY,
        contentType: "video/mp4",
      });
      await putPart(uploadId, 1, bytes(R2_MIN_PART, 1));
      await putPart(uploadId, 2, bytes(10, 2));
      const [first, second] = await partsOf(uploadId);
      if (!first || !second) throw new Error("parts missing");
      for (const parts of [
        [first, second, { partNumber: 3, etag: second.etag }],
        [second, first],
        [first, first],
        [],
      ]) {
        expect(
          await multipartReason(
            store.completeMultipart({ key: KEY, uploadId, parts }),
          ),
        ).toBe("invalid_part");
      }
      expect(await store.head(KEY)).toBeNull();
    });

    it("refuses a part re-PUT after listParts (its ETag changed)", async () => {
      const { uploadId } = await store.createMultipart({
        key: KEY,
        contentType: "video/mp4",
      });
      await putPart(uploadId, 1, bytes(R2_MIN_PART, 1));
      await putPart(uploadId, 2, bytes(10, 2));
      const listed = await partsOf(uploadId);
      const replaced = bytes(10, 0x42);
      expect(await putPart(uploadId, 2, replaced)).toEqual({
        etag: `"${md5(replaced)}"`,
      });
      expect(
        await multipartReason(
          store.completeMultipart({ key: KEY, uploadId, parts: listed }),
        ),
      ).toBe("invalid_part");
      expect(await store.head(KEY)).toBeNull();
    });

    it("refuses a part file changed on disk behind its stored ETag (the re-hash catches it)", async () => {
      const { uploadId } = await store.createMultipart({
        key: KEY,
        contentType: "video/mp4",
      });
      await putPart(uploadId, 1, bytes(R2_MIN_PART, 1));
      await putPart(uploadId, 2, bytes(10, 2));
      const listed = await partsOf(uploadId);
      // Same size, different bytes, and the {n}.etag file left alone.
      await writeFile(path.join(uploadDirOf(uploadId), "2.part"), bytes(10, 9));
      expect(
        await multipartReason(
          store.completeMultipart({ key: KEY, uploadId, parts: listed }),
        ),
      ).toBe("invalid_part");
      expect(await store.head(KEY)).toBeNull();
      expect(await readdir(path.dirname(path.join(root, KEY)))).toEqual([]);
    });
  });

  describe("expiry and missing uploads → no_such_upload", () => {
    it("expires the upload once the clock passes UPLOAD_RESUME_WINDOW_MS", async () => {
      const { uploadId } = await store.createMultipart({
        key: KEY,
        contentType: "video/mp4",
      });
      await putPart(uploadId, 1, bytes(10, 1));

      clock = START_MS + UPLOAD_RESUME_WINDOW_MS - 1;
      expect(await partsOf(uploadId)).toHaveLength(1);

      clock = START_MS + UPLOAD_RESUME_WINDOW_MS;
      expect(await store.listParts({ key: KEY, uploadId })).toBe(
        "no_such_upload",
      );
      expect(await putPart(uploadId, 2, bytes(10, 2))).toBe("no_such_upload");
      expect(
        await multipartReason(
          store.completeMultipart({
            key: KEY,
            uploadId,
            parts: [{ partNumber: 1, etag: `"${md5(bytes(10, 1))}"` }],
          }),
        ),
      ).toBe("no_such_upload");
      expect(await store.head(KEY)).toBeNull();
    });

    it("answers no_such_upload for an upload that never existed", async () => {
      expect(await store.listParts({ key: KEY, uploadId: NEVER_CREATED })).toBe(
        "no_such_upload",
      );
      expect(await putPart(NEVER_CREATED, 1, bytes(10, 1))).toBe(
        "no_such_upload",
      );
      expect(
        await multipartReason(
          store.completeMultipart({
            key: KEY,
            uploadId: NEVER_CREATED,
            parts: [{ partNumber: 1, etag: `"${md5(bytes(10, 1))}"` }],
          }),
        ),
      ).toBe("no_such_upload");
      expect(await exists(uploadDirOf(NEVER_CREATED))).toBe(false);
    });

    it("cancels a refused part's body, unread: an unknown upload or a part number out of range", async () => {
      const unknown = lazyStream(10);
      expect(
        await store.receivePart(
          { key: KEY, uploadId: NEVER_CREATED, partNumber: 1 },
          unknown.stream,
        ),
      ).toBe("no_such_upload");
      expect(unknown.cancelled()).toBe(true);
      const outOfRange = lazyStream(10);
      await expect(
        store.receivePart(
          { key: KEY, uploadId: NEVER_CREATED, partNumber: 0 },
          outOfRange.stream,
        ),
      ).rejects.toBeInstanceOf(StorageKeyError);
      expect(outOfRange.cancelled()).toBe(true);
    });

    it("answers no_such_upload when the key is not the upload's", async () => {
      const { uploadId } = await store.createMultipart({
        key: KEY,
        contentType: "video/mp4",
      });
      const otherKey = KEY.replace(".mp4", ".mov");
      expect(await store.listParts({ key: otherKey, uploadId })).toBe(
        "no_such_upload",
      );
      expect(await putPart(uploadId, 1, bytes(10, 1), otherKey)).toBe(
        "no_such_upload",
      );
    });
  });

  describe("concurrency", () => {
    /** An open upload with parts 1..3 (5 MiB, 5 MiB, 4321 bytes) and its listing. */
    async function threePartUpload() {
      const { uploadId } = await store.createMultipart({
        key: KEY,
        contentType: "video/mp4",
      });
      const data = [
        bytes(R2_MIN_PART, 1),
        bytes(R2_MIN_PART, 2),
        bytes(4321, 3),
      ];
      for (const [i, part] of data.entries()) {
        await putPart(uploadId, i + 1, part);
      }
      return { uploadId, data, parts: await partsOf(uploadId) };
    }

    it("settles two parallel completes of one upload: the same file, or no_such_upload for the one that lost the parts", async () => {
      const { uploadId, data, parts } = await threePartUpload();
      const results = await Promise.allSettled([
        store.completeMultipart({ key: KEY, uploadId, parts }),
        store.completeMultipart({ key: KEY, uploadId, parts }),
      ]);
      expect(results.some((r) => r.status === "fulfilled")).toBe(true);
      for (const result of results) {
        if (result.status === "fulfilled") continue;
        expect(result.reason).toBeInstanceOf(MultipartError);
        expect((result.reason as MultipartError).reason).toBe("no_such_upload");
      }

      const object = await readFile(path.join(root, KEY));
      expect(object.equals(Buffer.concat(data))).toBe(true);
      expect(await exists(uploadDirOf(uploadId))).toBe(false);
      expect(await readdir(path.dirname(path.join(root, KEY)))).toEqual([
        path.basename(KEY),
      ]);
    });

    it("never lets a listParts overlapping a complete see a partial list", async () => {
      const { uploadId, data, parts } = await threePartUpload();
      let settled = false;
      const completing = store
        .completeMultipart({ key: KEY, uploadId, parts })
        .finally(() => {
          settled = true;
        });
      const answers: Awaited<ReturnType<typeof store.listParts>>[] = [];
      while (!settled) {
        answers.push(await store.listParts({ key: KEY, uploadId }));
      }
      await completing;

      expect(answers.length).toBeGreaterThan(0);
      for (const answer of answers) {
        if (answer !== "no_such_upload") expect(answer).toEqual(parts);
      }
      expect(await store.listParts({ key: KEY, uploadId })).toBe(
        "no_such_upload",
      );
      expect(
        (await readFile(path.join(root, KEY))).equals(Buffer.concat(data)),
      ).toBe(true);
    });
  });

  describe("abortMultipart", () => {
    it("removes the upload, and a second abort is fine", async () => {
      const { uploadId } = await store.createMultipart({
        key: KEY,
        contentType: "video/mp4",
      });
      await putPart(uploadId, 1, bytes(10, 1));
      await store.abortMultipart({ key: KEY, uploadId });
      expect(await exists(uploadDirOf(uploadId))).toBe(false);
      expect(await store.listParts({ key: KEY, uploadId })).toBe(
        "no_such_upload",
      );
      await expect(
        store.abortMultipart({ key: KEY, uploadId }),
      ).resolves.toBeUndefined();
    });

    it("removes the manifest too, so listParts answers no_such_upload", async () => {
      const { uploadId } = await store.createMultipart({
        key: KEY,
        contentType: "video/mp4",
      });
      await putPart(uploadId, 1, bytes(10, 1));
      const manifest = path.join(uploadDirOf(uploadId), "manifest.json");
      expect(await exists(manifest)).toBe(true);
      await store.abortMultipart({ key: KEY, uploadId });
      expect(await exists(manifest)).toBe(false);
      expect(await store.listParts({ key: KEY, uploadId })).toBe(
        "no_such_upload",
      );
      expect(await putPart(uploadId, 2, bytes(10, 2))).toBe("no_such_upload");
    });

    it("is fine for an upload that never existed", async () => {
      await expect(
        store.abortMultipart({ key: KEY, uploadId: NEVER_CREATED }),
      ).resolves.toBeUndefined();
    });
  });

  describe("receivePart limits", () => {
    it("refuses more than PART_BYTES and leaves no part file", async () => {
      const { uploadId } = await store.createMultipart({
        key: KEY,
        contentType: "video/mp4",
      });
      const { stream, pulled, cancelled } = lazyStream(PART_BYTES + 64 * MIB);
      expect(
        await store.receivePart({ key: KEY, uploadId, partNumber: 1 }, stream),
      ).toBe("too_large");
      // It stops reading once over the limit instead of draining the body.
      expect(cancelled()).toBe(true);
      expect(pulled()).toBeLessThanOrEqual(PART_BYTES / MIB + 2);
      expect(await readdir(uploadDirOf(uploadId))).toEqual(["manifest.json"]);
      expect(await partsOf(uploadId)).toEqual([]);
    });

    it("accepts exactly PART_BYTES", async () => {
      const { uploadId } = await store.createMultipart({
        key: KEY,
        contentType: "video/mp4",
      });
      const { stream } = lazyStream(PART_BYTES);
      const result = await store.receivePart(
        { key: KEY, uploadId, partNumber: 1 },
        stream,
      );
      expect(result).toMatchObject({
        etag: expect.stringMatching(/^"[0-9a-f]{32}"$/),
      });
      expect(await partsOf(uploadId)).toEqual([
        expect.objectContaining({ partNumber: 1, size: PART_BYTES }),
      ]);
    });

    it.each([0, -1, 10_001])("refuses part number %i", async (partNumber) => {
      const { uploadId } = await store.createMultipart({
        key: KEY,
        contentType: "video/mp4",
      });
      expect(
        await rejection(putPart(uploadId, partNumber, bytes(10, 1))),
      ).toBeInstanceOf(StorageKeyError);
    });
  });
});

describe("receiveObject (single PUT)", () => {
  it("writes exactly `length` bytes", async () => {
    const data = bytes(1000, 0xd8);
    expect(await store.receiveObject(POSTER_KEY, streamOf(data), 1000)).toBe(
      "ok",
    );
    expect((await readFile(path.join(root, POSTER_KEY))).equals(data)).toBe(
      true,
    );
    expect(await readdir(path.dirname(path.join(root, POSTER_KEY)))).toEqual([
      path.basename(POSTER_KEY),
    ]);
  });

  it("refuses a shorter body and leaves no object", async () => {
    expect(
      await store.receiveObject(POSTER_KEY, streamOf(bytes(999, 1)), 1000),
    ).toBe("short");
    expect(await store.head(POSTER_KEY)).toBeNull();
    expect(await readdir(path.dirname(path.join(root, POSTER_KEY)))).toEqual(
      [],
    );
  });

  it("refuses a longer body and leaves no object", async () => {
    expect(
      await store.receiveObject(
        POSTER_KEY,
        streamOf(bytes(600, 1), bytes(401, 2)),
        1000,
      ),
    ).toBe("too_large");
    expect(await store.head(POSTER_KEY)).toBeNull();
    expect(await readdir(path.dirname(path.join(root, POSTER_KEY)))).toEqual(
      [],
    );
  });

  it("refuses an existing key and keeps the original bytes", async () => {
    const original = bytes(10, 1);
    expect(await store.receiveObject(POSTER_KEY, streamOf(original), 10)).toBe(
      "ok",
    );
    expect(
      await store.receiveObject(POSTER_KEY, streamOf(bytes(10, 2)), 10),
    ).toBe("exists");
    expect((await readFile(path.join(root, POSTER_KEY))).equals(original)).toBe(
      true,
    );
  });
});

describe("objects", () => {
  it("head: the size and no content type; null when missing", async () => {
    await store.putSmall(POSTER_KEY, bytes(1234, 1), "image/jpeg");
    expect(await store.head(POSTER_KEY)).toEqual({
      size: 1234,
      contentType: null,
    });
    expect(await store.head(KEY)).toBeNull();
  });

  it("head: null for a prefix that is a directory", async () => {
    await store.putSmall(POSTER_KEY, bytes(1, 1), "image/jpeg");
    expect(
      await store.head("posters/22222222-2222-4222-8222-222222222222"),
    ).toBeNull();
  });

  it("readRange: inclusive end; fewer bytes from a shorter file", async () => {
    const data = Buffer.from(Array.from({ length: 20 }, (_, i) => i));
    await store.putSmall(KEY, data, "video/mp4");
    expect(Buffer.from(await store.readRange(KEY, 0, 11))).toEqual(
      data.subarray(0, 12),
    );
    expect(Buffer.from(await store.readRange(KEY, 4, 7))).toEqual(
      data.subarray(4, 8),
    );
    expect(Buffer.from(await store.readRange(KEY, 15, 30))).toEqual(
      data.subarray(15, 20),
    );
    expect(await store.readRange(KEY, 25, 30)).toHaveLength(0);

    await store.putSmall(POSTER_KEY, bytes(5, 0xff), "image/jpeg");
    expect(await store.readRange(POSTER_KEY, 0, 11)).toHaveLength(5);
  });

  it("getStream: the bytes, the type by extension and the size; null when missing", async () => {
    const data = bytes(3000, 0x2a);
    await store.putSmall(KEY, data, "video/mp4");
    const object = await store.getStream(KEY);
    expect(object?.contentType).toBe("video/mp4");
    expect(object?.size).toBe(3000);
    if (!object) throw new Error("missing");
    expect((await readAll(object.body)).equals(data)).toBe(true);
    expect(await store.getStream(POSTER_KEY)).toBeNull();
  });

  it("putSmall writes through a temp file and replaces an existing object", async () => {
    await store.putSmall(POSTER_KEY, bytes(10, 1), "image/jpeg");
    await store.putSmall(POSTER_KEY, bytes(4, 2), "image/jpeg");
    expect(
      (await readFile(path.join(root, POSTER_KEY))).equals(bytes(4, 2)),
    ).toBe(true);
    expect(await readdir(path.dirname(path.join(root, POSTER_KEY)))).toEqual([
      path.basename(POSTER_KEY),
    ]);
  });

  it("delete removes the object; a missing one is a no-op", async () => {
    await store.putSmall(POSTER_KEY, bytes(10, 1), "image/jpeg");
    await store.delete(POSTER_KEY);
    expect(await store.head(POSTER_KEY)).toBeNull();
    await expect(store.delete(POSTER_KEY)).resolves.toBeUndefined();
    await expect(store.delete(KEY)).resolves.toBeUndefined();
  });

  describe("list", () => {
    const FOLDER = "posters/22222222-2222-4222-8222-222222222222/";
    const OTHER_POSTER =
      "posters/22222222-2222-4222-8222-222222222222/66666666-6666-4666-8666-666666666666.jpg";

    it("lists every object under the folder, sorted, with its mtime; nothing outside it", async () => {
      await store.putSmall(OTHER_POSTER, bytes(2, 1), "image/jpeg");
      await store.putSmall(POSTER_KEY, bytes(1, 1), "image/jpeg");
      await store.putSmall(
        "posters/88888888-8888-4888-8888-888888888888/99999999-9999-4999-8999-999999999999.jpg",
        bytes(1, 1),
        "image/jpeg",
      );
      const at = new Date("2026-01-02T03:04:05.000Z");
      await utimes(path.join(root, POSTER_KEY), at, at);

      const listed = await store.list(FOLDER);
      expect(listed.map((o) => o.key)).toEqual([POSTER_KEY, OTHER_POSTER]);
      expect(listed[0]?.lastModified).toEqual(at);
      expect(listed[1]?.lastModified).toBeInstanceOf(Date);
    });

    it("lists objects in nested folders by their whole key", async () => {
      await store.putSmall(KEY, bytes(1, 1), "video/mp4");
      expect(
        (
          await store.list("originals/11111111-1111-4111-8111-111111111111/")
        ).map((o) => o.key),
      ).toEqual([KEY]);
    });

    it("leaves out a write still in its temp file", async () => {
      await store.putSmall(POSTER_KEY, bytes(1, 1), "image/jpeg");
      await writeFile(path.join(root, `${OTHER_POSTER}.tmp`), "x");
      expect((await store.list(FOLDER)).map((o) => o.key)).toEqual([
        POSTER_KEY,
      ]);
    });

    it("is [] for a folder that doesn't exist", async () => {
      expect(await store.list(FOLDER)).toEqual([]);
    });

    it.each([
      "posters/22222222-2222-4222-8222-222222222222",
      "posters/",
      "/",
      "posters/../",
      "secrets/x/",
    ])("refuses the prefix %j with StorageKeyError", async (prefix) => {
      expect(await rejection(store.list(prefix))).toBeInstanceOf(
        StorageKeyError,
      );
    });
  });
});

describe("presigned URLs", () => {
  const nowS = () => Math.floor(clock / 1000);

  /** The signed request and signature a dev-route URL carries. */
  function read(rawUrl: string) {
    const url = new URL(rawUrl);
    expect(url.origin).toBe(APP_URL);
    expect(url.pathname.startsWith("/api/dev/storage/")).toBe(true);
    const key = url.pathname
      .slice("/api/dev/storage/".length)
      .split("/")
      .map(decodeURIComponent)
      .join("/");
    return { url, key, sig: url.searchParams.get("sig") ?? "" };
  }

  it("presignPut signs the key, type and length for expiresIn seconds", async () => {
    clock = START_MS + 999; // exp is whole seconds from the injected clock
    const { url: raw, headers } = await store.presignPut({
      key: POSTER_KEY,
      contentType: "image/jpeg",
      contentLength: 48_213,
      expiresIn: 3600,
    });
    expect(headers).toEqual({ "Content-Type": "image/jpeg" });
    const { url, key, sig } = read(raw);
    const exp = Number(url.searchParams.get("exp"));
    expect(exp).toBe(nowS() + 3600);
    const r: SignedRequest = {
      method: "PUT",
      key,
      exp,
      ct: url.searchParams.get("ct") ?? "",
      len: Number(url.searchParams.get("len")),
    };
    expect(r).toMatchObject({ key: POSTER_KEY, ct: "image/jpeg", len: 48_213 });
    expect(verifyLocalRequest(SUBKEY, r, sig, nowS())).toBe(true);
    expect(verifyLocalRequest(SUBKEY, r, sig, exp + 1)).toBe(false);
  });

  it("presignPart signs the key, upload id and part number, with no checksum or type", async () => {
    const { uploadId } = await store.createMultipart({
      key: KEY,
      contentType: "video/mp4",
    });
    const { url, key, sig } = read(
      await store.presignPart({
        key: KEY,
        uploadId,
        partNumber: 4,
        expiresIn: 3600,
      }),
    );
    expect([...url.searchParams.keys()].sort()).toEqual([
      "exp",
      "partNumber",
      "sig",
      "uploadId",
    ]);
    const r: SignedRequest = {
      method: "PUT",
      key,
      exp: Number(url.searchParams.get("exp")),
      uploadId: url.searchParams.get("uploadId") ?? "",
      partNumber: Number(url.searchParams.get("partNumber")),
    };
    expect(r).toMatchObject({
      key: KEY,
      uploadId,
      partNumber: 4,
      exp: nowS() + 3600,
    });
    expect(verifyLocalRequest(SUBKEY, r, sig, nowS())).toBe(true);
  });

  it("presignGet signs the key and the Content-Disposition", async () => {
    const cd = `attachment; filename="clip.mp4"; filename*=UTF-8''clip.mp4`;
    const { url, key, sig } = read(
      await store.presignGet({ key: KEY, expiresIn: 300, disposition: cd }),
    );
    const r: SignedRequest = {
      method: "GET",
      key,
      exp: Number(url.searchParams.get("exp")),
      cd: url.searchParams.get("cd") ?? "",
    };
    expect(r).toEqual({ method: "GET", key: KEY, exp: nowS() + 300, cd });
    expect(verifyLocalRequest(SUBKEY, r, sig, nowS())).toBe(true);
    expect(
      verifyLocalRequest(SUBKEY, { ...r, cd: "inline" }, sig, nowS()),
    ).toBe(false);
  });
});

describe("key and upload id safety", () => {
  const BAD_KEYS = [
    "originals/../x",
    "secrets/x",
    "originals//x",
    "originals/a/./b",
    "originals/..",
    "originals/a/../../../etc/passwd",
    "/originals/x",
    "originals/x/",
    "originals",
    "",
    "originals/a b",
    "originals/a\\..\\b",
    "originals/a%2F..%2Fb",
  ];

  it.each(BAD_KEYS)(
    "refuses %j everywhere with StorageKeyError",
    async (key) => {
      const calls: Array<() => Promise<unknown>> = [
        () => store.head(key),
        () => store.readRange(key, 0, 11),
        () => store.getStream(key),
        () => store.delete(key),
        () => store.putSmall(key, bytes(1, 1), "video/mp4"),
        () =>
          store.presignPut({
            key,
            contentType: "video/mp4",
            contentLength: 1,
            expiresIn: 60,
          }),
        () => store.presignGet({ key, expiresIn: 60, disposition: "inline" }),
        () => store.createMultipart({ key, contentType: "video/mp4" }),
        () =>
          store.presignPart({
            key,
            uploadId: NEVER_CREATED,
            partNumber: 1,
            expiresIn: 60,
          }),
        () => store.listParts({ key, uploadId: NEVER_CREATED }),
        () =>
          store.completeMultipart({ key, uploadId: NEVER_CREATED, parts: [] }),
        () => store.abortMultipart({ key, uploadId: NEVER_CREATED }),
        () => store.receiveObject(key, streamOf(bytes(1, 1)), 1),
        () =>
          store.receivePart(
            { key, uploadId: NEVER_CREATED, partNumber: 1 },
            streamOf(bytes(1, 1)),
          ),
      ];
      for (const call of calls) {
        expect(await rejection(call())).toBeInstanceOf(StorageKeyError);
      }
    },
  );

  it.each([
    "abc",
    "../x",
    "../../etc",
    "ABCDEF01-2345-4678-9ABC-DEF012345678",
    `${NEVER_CREATED}/..`,
    "",
  ])("refuses the upload id %j with StorageKeyError", async (uploadId) => {
    const calls: Array<() => Promise<unknown>> = [
      () =>
        store.presignPart({ key: KEY, uploadId, partNumber: 1, expiresIn: 60 }),
      () => store.listParts({ key: KEY, uploadId }),
      () => store.completeMultipart({ key: KEY, uploadId, parts: [] }),
      () => store.abortMultipart({ key: KEY, uploadId }),
      () =>
        store.receivePart(
          { key: KEY, uploadId, partNumber: 1 },
          streamOf(bytes(1, 1)),
        ),
    ];
    for (const call of calls) {
      expect(await rejection(call())).toBeInstanceOf(StorageKeyError);
    }
  });

  it("never writes outside the root for a refused key", async () => {
    await rejection(store.putSmall("originals/../x", bytes(1, 1), "video/mp4"));
    expect(await exists(path.join(root, "x"))).toBe(false);
    expect(await readdir(root)).toEqual([]);
  });
});

describe("isStorageKey", () => {
  it.each([
    KEY,
    POSTER_KEY,
    "licenses/abc/def.pdf",
    "originals/a",
    "originals/a.b-c_d/e",
  ])("accepts %j", (key) => {
    expect(isStorageKey(key)).toBe(true);
  });

  it.each([
    "originals/../x",
    "secrets/x",
    "originals//x",
    "originals/a/./b",
    "originals/.",
    "originals/x/",
    "/originals/x",
    "Originals/x",
    "originals",
    "originals/",
    "",
    "originals/a b",
    "originals/a%2Fb",
    "originals/é",
    "originals/a\nb",
    ".multipart/x",
  ])("refuses %j", (key) => {
    expect(isStorageKey(key)).toBe(false);
  });
});

describe("isUploadId", () => {
  it("accepts a lower-case uuid only", () => {
    expect(isUploadId(NEVER_CREATED)).toBe(true);
    expect(isUploadId("abcdef01-2345-4678-9abc-def012345678")).toBe(true);
    expect(isUploadId("ABCDEF01-2345-4678-9ABC-DEF012345678")).toBe(false);
    expect(isUploadId(`${NEVER_CREATED}x`)).toBe(false);
    expect(isUploadId("")).toBe(false);
  });
});

describe("contentTypeOf", () => {
  it.each([
    [KEY, "video/mp4"],
    ["originals/a/b/c.mov", "video/quicktime"],
    [POSTER_KEY, "image/jpeg"],
    ["licenses/a/b.pdf", "application/pdf"],
    ["originals/a/b/c.MP4", "application/octet-stream"],
    ["originals/a/b/c.webm", "application/octet-stream"],
    ["originals/a/b/noext", "application/octet-stream"],
  ])("%s → %s", (key, type) => {
    expect(contentTypeOf(key)).toBe(type);
  });
});
