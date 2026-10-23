import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { openAsBlob } from "node:fs";
import {
  type FileHandle,
  link,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { readCapped } from "../read-capped";
import { MultipartError, StorageKeyError } from "./errors";
import type { ObjectStorage } from "./index";
import {
  ORIGINAL_EXTENSION,
  ORIGINAL_MIME,
  PART_BYTES,
  UPLOAD_RESUME_WINDOW_MS,
} from "./limits";
import {
  localRequestUrl,
  type SignedRequest,
  verifyLocalRequest,
} from "./local-url";

// The local driver (02 §5.9, 07 D80): objects under .data/storage/<key>, "presigned" URLs to the signed dev route, and
// multipart emulated under .data/storage/.multipart/{uploadId}/ (manifest.json, {n}.part with its MD5 in {n}.etag) with
// R2's rules. Every write goes to a temp file renamed on success, so a cut-off PUT leaves no partial object or part.

/**
 * Where the local driver keeps objects (the [int] helpers clean up under it). Its turbopackIgnore comment, and those on
 * objectPath and uploadDir, keep the build from tracing the project, .data included, into the server output: this
 * driver runs only in development and test (07 D51).
 */
export const LOCAL_STORAGE_ROOT = path.join(
  /*turbopackIgnore: true*/ process.cwd(),
  ".data",
  "storage",
);

const KEY = /^(originals|posters|licenses)\/[A-Za-z0-9._/-]+$/;
const SEGMENT = /^[A-Za-z0-9._-]+$/;
const UPLOAD_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PART_FILE = /^(\d+)\.part$/;
const MIN_PART_BYTES = 5 * 1024 ** 2; // R2: every part but the last ≥ 5 MiB
const MAX_PART_NUMBER = 10_000;

/** A storage key the driver accepts: one of the three prefixes, plain segments, no `.` or `..` step. */
export function isStorageKey(key: string): boolean {
  return (
    KEY.test(key) &&
    key.split("/").every((s) => SEGMENT.test(s) && s !== "." && s !== "..")
  );
}

export const isUploadId = (id: string) => UPLOAD_ID.test(id);

const TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  ...Object.fromEntries(ORIGINAL_MIME.map((m) => [ORIGINAL_EXTENSION[m], m])),
  jpg: "image/jpeg",
  pdf: "application/pdf",
};

/** The object's Content-Type by its key's extension (keys carry the validated type, 07 D61). */
export function contentTypeOf(key: string): string {
  const ext = key.slice(key.lastIndexOf(".") + 1);
  return (
    (Object.hasOwn(TYPE_BY_EXTENSION, ext) && TYPE_BY_EXTENSION[ext]) ||
    "application/octet-stream"
  );
}

type Manifest = { key: string; contentType: string; createdAt: number };

/**
 * What the dev route did with a single PUT's body: written; more or fewer bytes than the URL signed; or refused because
 * the object exists (a key is written once, like P23's If-None-Match: *, so a verified poster can't be swapped).
 */
type Received = "ok" | "too_large" | "short" | "exists";

export type LocalStorage = ObjectStorage & {
  /** Checks a signed dev-route request against this driver's key. */
  verifyRequest(r: SignedRequest, sig: string, nowS: number): boolean;
  /** The dev route's single PUT: exactly `length` bytes to `key`. */
  receiveObject(
    key: string,
    body: ReadableStream<Uint8Array>,
    length: number,
  ): Promise<Received>;
  /** The dev route's part PUT: at most PART_BYTES to an open upload's part; its quoted MD5 ETag on success. */
  receivePart(
    i: { key: string; uploadId: string; partNumber: number },
    body: ReadableStream<Uint8Array>,
  ): Promise<{ etag: string } | "no_such_upload" | "too_large">;
};

const quoted = (md5: string) => `"${md5}"`;
const unquoted = (etag: string) => etag.replace(/^"|"$/g, "");
const isCode = (error: unknown, code: string) =>
  error instanceof Error && "code" in error && error.code === code;

const isMissing = (error: unknown) => isCode(error, "ENOENT");

/** `fn`'s result, or `fallback` when the file isn't there. */
async function unlessMissing<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isMissing(error)) return fallback;
    throw error;
  }
}

/**
 * Writes through a temp file next to `target`: `write` fills it, then `settle` decides what becomes of it (rename,
 * link, or nothing). The temp file never outlives the call, so a cut-off write leaves no partial file. `createDir: false`
 * when `target`'s folder must already exist (an upload's: a missing one means the upload is gone).
 */
async function viaTemp<W, T>(
  target: string,
  write: (file: FileHandle) => Promise<W>,
  settle: (temp: string, written: W) => Promise<T>,
  { createDir = true }: { createDir?: boolean } = {},
): Promise<T> {
  if (createDir) await mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    const file = await open(temp, "wx");
    let written: W;
    try {
      written = await write(file);
    } finally {
      await file.close();
    }
    return await settle(temp, written);
  } finally {
    await rm(temp, { force: true });
  }
}

/** Copies `body` into `file`, at most `max` bytes: its size and MD5, or null once it goes over. */
async function copyCapped(
  file: FileHandle,
  body: ReadableStream<Uint8Array>,
  max: number,
): Promise<{ bytes: number; md5: string } | null> {
  const hash = createHash("md5");
  const bytes = await readCapped(body, max, (chunk) => {
    hash.update(chunk);
    return file.write(chunk);
  });
  return bytes === null ? null : { bytes, md5: hash.digest("hex") };
}

/** Writes `data` to `target` through a temp file. */
const writeAtomic = (
  target: string,
  data: Uint8Array | string,
  options?: { createDir?: boolean },
) =>
  viaTemp(
    target,
    (file) => file.writeFile(data),
    (temp) => rename(temp, target),
    options,
  );

/** Removes an upload: the manifest first, so a listing that loses a part file to the removal sees the upload gone. */
async function removeUpload(dir: string) {
  await rm(path.join(dir, "manifest.json"), { force: true });
  await rm(dir, { recursive: true, force: true });
}

export function createLocalStorage({
  root = LOCAL_STORAGE_ROOT,
  appUrl,
  subkey,
  now = Date.now,
}: {
  root?: string;
  appUrl: string;
  subkey: Buffer;
  now?: () => number;
}): LocalStorage {
  const objectPath = (key: string) => {
    const resolved = path.resolve(/*turbopackIgnore: true*/ root, key);
    if (!isStorageKey(key) || !resolved.startsWith(root + path.sep)) {
      throw new StorageKeyError();
    }
    return resolved;
  };
  const uploadDir = (uploadId: string) => {
    if (!isUploadId(uploadId)) throw new StorageKeyError();
    return path.join(/*turbopackIgnore: true*/ root, ".multipart", uploadId);
  };
  const expS = (expiresIn: number) => Math.floor(now() / 1000) + expiresIn;

  /** The upload is open for `key` and younger than the resume window. */
  async function isOpenUpload(key: string, uploadId: string) {
    const text = await unlessMissing(
      () => readFile(path.join(uploadDir(uploadId), "manifest.json"), "utf8"),
      null,
    );
    if (text === null) return false;
    const manifest = JSON.parse(text) as Manifest;
    return (
      manifest.key === key &&
      now() - manifest.createdAt < UPLOAD_RESUME_WINDOW_MS
    );
  }

  /** The upload's stored parts, sorted; null when its folder is gone (a complete or an abort removed it meanwhile). */
  async function storedParts(uploadId: string) {
    const dir = uploadDir(uploadId);
    const names = await unlessMissing(() => readdir(dir), null);
    if (names === null) return null;
    const listed = await Promise.all(
      names.map(async (name) => {
        const n = PART_FILE.exec(name)?.[1];
        if (!n) return null;
        const [info, md5] = await Promise.all([
          unlessMissing(() => stat(path.join(dir, name)), null),
          unlessMissing(
            () => readFile(path.join(dir, `${n}.etag`), "utf8"),
            null,
          ),
        ]);
        return info && md5
          ? { partNumber: Number(n), size: info.size, etag: quoted(md5) }
          : null;
      }),
    );
    const parts = listed.filter((p) => p !== null);
    // A complete or an abort removes the manifest before the parts: if it is gone now, this listing may be partial.
    const manifest = path.join(dir, "manifest.json");
    if (!(await unlessMissing(() => stat(manifest), null))) return null;
    return parts.sort((a, b) => a.partNumber - b.partNumber);
  }

  /** Assembles the parts in order into `key` (R2's part rules, ETags checked) and removes the upload. */
  async function assemble({
    key,
    uploadId,
    parts,
  }: {
    key: string;
    uploadId: string;
    parts: Array<{ partNumber: number; etag: string }>;
  }) {
    const target = objectPath(key);
    if (!(await isOpenUpload(key, uploadId))) {
      throw new MultipartError("no_such_upload");
    }
    const listed = await storedParts(uploadId);
    if (!listed) throw new MultipartError("no_such_upload");
    const stored = new Map(listed.map((p) => [p.partNumber, p]));
    const chosen = parts.map((p) => stored.get(p.partNumber));
    const valid =
      parts.length > 0 &&
      parts.every(
        (p, i) => i === 0 || p.partNumber > (parts[i - 1]?.partNumber ?? 0),
      ) &&
      chosen.every(
        (s, i) =>
          s !== undefined &&
          unquoted(s.etag) === unquoted(parts[i]?.etag ?? "") &&
          (i === chosen.length - 1 ||
            (s.size === chosen[0]?.size && s.size >= MIN_PART_BYTES)),
      );
    if (!valid) throw new MultipartError("invalid_part");

    // Concatenate in order, re-hashing each part against its ETag as it streams (a part re-sent since the listing fails
    // like R2's InvalidPart). A part file gone means the upload went with a parallel complete or an abort: no rule removes
    // one part, and the assembled file is already at the key before a complete removes the folder.
    const dir = uploadDir(uploadId);
    const chunk = new Uint8Array(1024 ** 2);
    try {
      await viaTemp(
        target,
        async (file) => {
          for (const part of parts) {
            const source = await open(
              path.join(dir, `${part.partNumber}.part`),
            );
            try {
              const hash = createHash("md5");
              for (;;) {
                const { bytesRead } = await source.read(chunk, 0, chunk.length);
                if (bytesRead === 0) break;
                hash.update(chunk.subarray(0, bytesRead));
                await file.write(chunk.subarray(0, bytesRead));
              }
              if (hash.digest("hex") !== unquoted(part.etag)) {
                throw new MultipartError("invalid_part");
              }
            } finally {
              await source.close();
            }
          }
        },
        (temp) => rename(temp, target),
      );
    } catch (error) {
      if (isMissing(error)) throw new MultipartError("no_such_upload");
      throw error;
    }
    await removeUpload(dir);
  }

  return {
    verifyRequest(r, sig, nowS) {
      return verifyLocalRequest(subkey, r, sig, nowS);
    },

    async presignPut({ key, contentType, contentLength, expiresIn }) {
      objectPath(key);
      const url = localRequestUrl(appUrl, subkey, {
        method: "PUT",
        key,
        exp: expS(expiresIn),
        ct: contentType,
        len: contentLength,
      });
      return { url, headers: { "Content-Type": contentType } };
    },

    async createMultipart({ key, contentType }) {
      objectPath(key);
      const uploadId = randomUUID();
      const manifest: Manifest = { key, contentType, createdAt: now() };
      await writeAtomic(
        path.join(uploadDir(uploadId), "manifest.json"),
        JSON.stringify(manifest),
      );
      return { uploadId };
    },

    async presignPart({ key, uploadId, partNumber, expiresIn }) {
      objectPath(key);
      uploadDir(uploadId);
      return localRequestUrl(appUrl, subkey, {
        method: "PUT",
        key,
        exp: expS(expiresIn),
        uploadId,
        partNumber,
      });
    },

    async listParts({ key, uploadId }) {
      objectPath(key);
      if (!(await isOpenUpload(key, uploadId))) return "no_such_upload";
      return (await storedParts(uploadId)) ?? "no_such_upload";
    },

    completeMultipart: assemble,

    async abortMultipart({ key, uploadId }) {
      objectPath(key);
      await removeUpload(uploadDir(uploadId));
    },

    async head(key) {
      const info = await unlessMissing(() => stat(objectPath(key)), null);
      return info?.isFile() ? { size: info.size, contentType: null } : null;
    },

    async readRange(key, start, end) {
      const file = await open(objectPath(key), "r");
      try {
        const buffer = new Uint8Array(end - start + 1);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
        return buffer.subarray(0, bytesRead);
      } finally {
        await file.close();
      }
    },

    async presignGet({ key, expiresIn, disposition }) {
      objectPath(key);
      return localRequestUrl(appUrl, subkey, {
        method: "GET",
        key,
        exp: expS(expiresIn),
        cd: disposition,
      });
    },

    async putSmall(key, body) {
      await writeAtomic(objectPath(key), body);
    },

    async getStream(key) {
      const target = objectPath(key);
      const info = await unlessMissing(() => stat(target), null);
      if (!info?.isFile()) return null;
      const blob = await openAsBlob(target);
      return {
        body: blob.stream(),
        contentType: contentTypeOf(key),
        size: info.size,
      };
    },

    async delete(key) {
      await rm(objectPath(key), { force: true });
    },

    async list(prefix) {
      if (!prefix.endsWith("/")) throw new StorageKeyError();
      const folder = prefix.slice(0, -1);
      const dir = objectPath(folder);
      const names = await unlessMissing(
        () => readdir(dir, { recursive: true }),
        [],
      );
      const listed = await Promise.all(
        names
          // A write still in its temp file is no object yet.
          .filter((name) => !name.endsWith(".tmp"))
          .map(async (name) => {
            const info = await unlessMissing(
              () => stat(path.join(dir, name)),
              null,
            );
            return info?.isFile()
              ? {
                  key: `${folder}/${name.split(path.sep).join("/")}`,
                  lastModified: info.mtime,
                }
              : null;
          }),
      );
      return listed
        .filter((o) => o !== null)
        .sort((a, b) => a.key.localeCompare(b.key));
    },

    async receiveObject(key, body, length) {
      const target = objectPath(key);
      if (await unlessMissing(() => stat(target), null)) {
        await body.cancel();
        return "exists";
      }
      return viaTemp(
        target,
        (file) => copyCapped(file, body, length),
        async (temp, written): Promise<Received> => {
          if (!written) return "too_large";
          if (written.bytes !== length) return "short";
          // A hard link fails atomically on an existing file: written once, like P23's If-None-Match: *.
          try {
            await link(temp, target);
            return "ok";
          } catch (error) {
            if (isCode(error, "EEXIST")) return "exists";
            throw error;
          }
        },
      );
    },

    async receivePart({ key, uploadId, partNumber }, body) {
      objectPath(key);
      if (partNumber < 1 || partNumber > MAX_PART_NUMBER) {
        throw new StorageKeyError();
      }
      if (!(await isOpenUpload(key, uploadId))) return "no_such_upload";
      const dir = uploadDir(uploadId);
      const part = path.join(dir, `${partNumber}.part`);
      // The upload's folder must exist: a part never brings back an upload a complete or an abort just removed.
      const inUpload = { createDir: false };
      try {
        const md5 = await viaTemp(
          part,
          (file) => copyCapped(file, body, PART_BYTES),
          async (temp, written) => {
            if (written) await rename(temp, part);
            return written?.md5 ?? null;
          },
          inUpload,
        );
        if (md5 === null) return "too_large";
        await writeAtomic(path.join(dir, `${partNumber}.etag`), md5, inUpload);
        return { etag: quoted(md5) };
      } catch (error) {
        if (isMissing(error)) return "no_such_upload";
        throw error;
      }
    },
  };
}
