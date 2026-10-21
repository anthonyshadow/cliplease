import "server-only";

/** RFC 8187's ext-value: encodeURIComponent, plus the ' ( ) * it leaves as they are (' is the value's own delimiter). */
const extValue = (filename: string) =>
  encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/**
 * A Content-Disposition with an ASCII fallback and the UTF-8 name (research/infra.md §1, "Signed downloads"). P20's
 * downloads use it: the original as `${APP_NAME}-${code}-original.${ext}`, the license PDF inline.
 */
export function contentDisposition(
  kind: "attachment" | "inline",
  filename: string,
): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${extValue(filename)}`;
}
