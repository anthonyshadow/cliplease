import "server-only";

/**
 * A Content-Disposition with an ASCII fallback and the UTF-8 name (research/infra.md §1, "Signed downloads"). P20's
 * downloads use it: the original as `${APP_NAME}-${code}-original.${ext}`, the license PDF inline.
 */
export function contentDisposition(
  kind: "attachment" | "inline",
  filename: string,
): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
