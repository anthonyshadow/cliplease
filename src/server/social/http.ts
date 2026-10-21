import "server-only";
import type { z } from "zod";
import {
  DEFAULT_RETRY_AFTER_SEC,
  SocialAuthError,
  SocialRateLimitError,
  SocialUpstreamError,
} from "./errors";

// The adapters' fetch wrapper (02 §5.3), used by the real platforms from P27. Thrown messages carry the method, the URL
// without its query and the status only: never a token, a code, a secret or a response body.

const RETRY_DELAYS_MS = [250, 1_000, 4_000] as const;

type FetchJsonInit<T> = RequestInit & {
  schema: z.ZodType<T>;
  timeoutMs?: number;
  /** Only for idempotent GETs and list calls: retried on 5xx and network failures. */
  retries?: 0 | 1 | 2 | 3;
  /**
   * The adapter's reading of a non-2xx answer (research/social.md's error table: Instagram code 190 or Google
   * invalid_grant on a 400 → SocialAuthError, YouTube quotaExceeded on a 403 → SocialRateLimitError). It returns one of
   * the fixed-message errors, or null for the defaults (401 → auth, 429 → rate limit, anything else → upstream). The
   * body never reaches a message or a log.
   */
  mapError?: (status: number, body: unknown) => Error | null;
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

/**
 * Retry-After in seconds or as an HTTP date, as read: 60 s when missing, and NaN when unreadable. SocialRateLimitError
 * rounds, caps and defaults it.
 */
function retryAfterSec(header: string | null): number {
  if (!header) return DEFAULT_RETRY_AFTER_SEC;
  const seconds = Number(header);
  if (seconds >= 0) return seconds;
  return (Date.parse(header) - Date.now()) / 1000;
}

/** Waits `ms`, or less when `signal` aborts first; the loop then throws. */
const sleep = (ms: number, signal: AbortSignal | null | undefined) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });

/** The base delay plus up to 20 % jitter. */
const backoff = (attempt: number) => {
  const base = RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[2];
  return base + Math.floor(Math.random() * base * 0.2);
};

/** Lets the connection go back to the pool without reading an answer we won't use. */
async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => {});
}

/**
 * GETs or POSTs `url` and parses the JSON answer with `schema`. Each attempt has its own `timeoutMs`; a caller's
 * `signal` (a refresh's deadline, a sync budget) ends the call at once, with no retry.
 */
export async function fetchJson<T>(
  url: URL | string,
  {
    schema,
    timeoutMs = 10_000,
    retries = 0,
    mapError,
    signal,
    ...init
  }: FetchJsonInit<T>,
): Promise<T> {
  const label = `${init.method ?? "GET"} ${safeUrl(url)}`;
  const aborted = () => new SocialUpstreamError(`${label} aborted`);
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw aborted();
    const timeout = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch {
      if (signal?.aborted) throw aborted();
      // A network failure or the timeout: worth another try.
      if (attempt < retries) {
        await sleep(backoff(attempt), signal);
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
    if (response.status >= 500 && attempt < retries) {
      await discard(response);
      await sleep(backoff(attempt), signal);
      continue;
    }
    if (mapError) {
      const mapped = mapError(
        response.status,
        await response.json().catch(() => null),
      );
      if (mapped) throw mapped;
    } else {
      await discard(response);
    }
    if (response.status === 401) throw new SocialAuthError();
    if (response.status === 429) {
      throw new SocialRateLimitError(
        retryAfterSec(response.headers.get("retry-after")),
      );
    }
    throw new SocialUpstreamError(`${label} answered ${response.status}`);
  }
}
