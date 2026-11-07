/** The query a failed download comes back to /l with (owner answer Q-185). */
export const DOWNLOAD_FAILED = { param: "download", value: "failed" } as const;

/** /l's download words (Q-185): a leaf module, so LicenseDownloads' client chunk carries only these. */
export const DOWNLOAD_COPY = {
  /** "Download original · MP4 · 84 MB". */
  downloadOriginal: (type: string, size: string) =>
    `Download original · ${type} · ${size}`,
  downloadPdf: "Download license PDF",
  preparing: "Preparing…",
  downloadFailed: "Couldn't start the download. Try again.",
  expired: "Expired. Only the license PDF stays available.",
} as const;
