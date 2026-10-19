import "server-only";
import type { z } from "zod";
import {
  SocialAuthError,
  SocialRateLimitError,
  SocialUpstreamError,
} from "./errors";

// The adapters' fetch wrapper (02 §5.3), used by the real platforms from P27. Thrown messages carry the method, the URL
// without its query and the status only: never a token, a code, a secret or a response body.

const RETRY_DELAYS_MS = [250, 1_000, 4_000] as const;
const DEFAULT_RETRY_AFTER_SEC = 60;

type FetchJsonInit<T> = RequestInit & {
  schema: z.ZodType<T>;
  timeoutMs?: number;
  /** Only for idempotent GETs and list calls: retried on 5xx and network failures. */
  retries?: 0 | 1 | 2 | 3;
};

/** `url` without its query string or fragment, which can hold access_token, code or client_secret. */
function safeUrl(url: URL | string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "(invalid url)";
  }
}

/** Retry-After in seconds or as an HTTP date; 60 s when missing or unreadable. */
function retryAfterSec(header: string | null): number {
  if (!header) return DEFAULT_RETRY_AFTER_SEC;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const at = Date.parse(header);
  if (Number.isNaN(at)) return DEFAULT_RETRY_AFTER_SEC;
  return Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The base delay plus up to 20 % jitter. */
const backoff = (attempt: number) => {
  const base = RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[2];
  return base + Math.floor(Math.random() * base * 0.2);
};

export async function fetchJson<T>(
  url: URL | string,
  { schema, timeoutMs = 10_000, retries = 0, ...init }: FetchJsonInit<T>,
): Promise<T> {
  const label = `${init.method ?? "GET"} ${safeUrl(url)}`;
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // A network failure or the timeout: worth another try.
      if (attempt < retries) {
        await sleep(backoff(attempt));
        continue;
      }
      throw new SocialUpstreamError(`${label} failed`);
    }
    if (response.ok) {
      const parsed = schema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) {
        throw new SocialUpstreamError(`${label} returned an unexpected body`);
      }
      return parsed.data;
    }
    if (response.status === 401) throw new SocialAuthError();
    if (response.status === 429) {
      throw new SocialRateLimitError(
        retryAfterSec(response.headers.get("retry-after")),
      );
    }
    if (response.status >= 500 && attempt < retries) {
      await sleep(backoff(attempt));
      continue;
    }
    throw new SocialUpstreamError(`${label} answered ${response.status}`);
  }
}
