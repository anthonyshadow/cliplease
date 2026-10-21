import "server-only";
import { deriveSubkey } from "../crypto/token-cipher";
import { env } from "../env";
import { createLocalStorage, type LocalStorage } from "./local";

// Private object storage (02 §5.9, 07 D61, D80): keys only, signed short-lived URLs only. CORE runs the local driver;
// the R2 driver arrives in P23 behind the same interface.

export interface ObjectStorage {
  /** A single PUT (posters). It signs the exact type and size (owner answer Q-36), so the body must match both. */
  presignPut(i: {
    key: string;
    contentType: string;
    contentLength: number;
    expiresIn: number;
  }): Promise<{ url: string; headers: Record<string, string> }>;
  createMultipart(i: {
    key: string;
    contentType: string;
  }): Promise<{ uploadId: string }>;
  /** An UploadPart URL: no checksum parameters (R2, 07 D80). */
  presignPart(i: {
    key: string;
    uploadId: string;
    partNumber: number;
    expiresIn: number;
  }): Promise<string>;
  listParts(i: {
    key: string;
    uploadId: string;
  }): Promise<
    Array<{ partNumber: number; size: number; etag: string }> | "no_such_upload"
  >;
  completeMultipart(i: {
    key: string;
    uploadId: string;
    parts: Array<{ partNumber: number; etag: string }>;
  }): Promise<void>;
  /** A missing upload is fine (NoSuchUpload → ok). */
  abortMultipart(i: { key: string; uploadId: string }): Promise<void>;
  head(
    key: string,
  ): Promise<{ size: number; contentType: string | null } | null>;
  /** Bytes `start`..`end` inclusive; fewer when the object is shorter. */
  readRange(key: string, start: number, end: number): Promise<Uint8Array>;
  presignGet(i: {
    key: string;
    expiresIn: number;
    disposition: string;
    contentType?: string;
  }): Promise<string>;
  putSmall(key: string, body: Uint8Array, contentType: string): Promise<void>;
  getStream(key: string): Promise<{
    body: ReadableStream<Uint8Array>;
    contentType: string | null;
    size: number;
  } | null>;
  /** A missing object is fine. */
  delete(key: string): Promise<void>;
  /** Every object under a folder `prefix` (ending in `/`) and when it was written; [] when there is none. */
  list(prefix: string): Promise<Array<{ key: string; lastModified: Date }>>;
}

let local: LocalStorage | undefined;

/** The local driver behind STORAGE_DRIVER=local (07 D51 allows it only in development and test). */
export function localDriver(): LocalStorage {
  local ??= createLocalStorage({
    appUrl: env.APP_URL,
    subkey: deriveSubkey("local-storage-url"),
  });
  return local;
}

/** The driver env.STORAGE_DRIVER names; R2 says so at call time until P23 builds it. */
export function storage(): ObjectStorage {
  if (env.STORAGE_DRIVER === "r2") {
    throw new Error("STORAGE_DRIVER=r2 arrives in P23");
  }
  return localDriver();
}
