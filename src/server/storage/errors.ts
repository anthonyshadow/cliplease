import "server-only";

/** Thrown by completeMultipart: the upload is gone, or its parts don't make one file under R2's rules. */
export class MultipartError extends Error {
  constructor(readonly reason: "no_such_upload" | "invalid_part") {
    super(reason);
    this.name = "MultipartError";
  }
}

/** A key or upload id the local driver refuses before touching the disk (path traversal, a stray character). */
export class StorageKeyError extends Error {
  constructor() {
    super("invalid storage key");
    this.name = "StorageKeyError";
  }
}
