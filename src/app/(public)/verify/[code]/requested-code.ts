import { LICENSE_CODE_PATTERN } from "@/lib/licensing/snapshot";

/**
 * The code a /verify address names, for its not-found view (owner answer Q-184): the last path segment of the page
 * path src/proxy.ts forwards (PAGE_PATH_HEADER, without its query), decoded, and only when it is a canonical code.
 * Anything else is null, so the view never echoes what someone typed.
 */
export function requestedCode(pagePath: string | null): string | null {
  if (!pagePath) return null;
  const [path] = pagePath.split("?");
  let segment: string;
  try {
    segment = decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
  } catch {
    return null;
  }
  return LICENSE_CODE_PATTERN.test(segment) ? segment : null;
}
