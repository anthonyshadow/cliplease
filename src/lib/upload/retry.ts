// The retry policy of a part and of the route calls that are safe to repeat (07 D80; owner answer Q-45 a). Pure and
// client-safe: no DOM, timers only through setTimeout.
import type { ApiResult } from "./http";
import { PART_MAX_ATTEMPTS } from "./limits";

/** The wait before retries 1–5 (PART_MAX_ATTEMPTS retries after the first send, Q-45 a). */
export const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000] as const;

/** Retry `retry`'s wait (1-based) plus a jitter of 0–25 %: `base + floor(random() × base × 0.25)`. */
export function retryDelayMs(
  retry: number,
  random: () => number = Math.random,
) {
  const index = Math.min(Math.max(retry, 1), RETRY_DELAYS_MS.length) - 1;
  const base = RETRY_DELAYS_MS[index] ?? RETRY_DELAYS_MS[0];
  return base + Math.floor(random() * base * 0.25);
}

/** How a part PUT failed: no answer (a dropped connection, or R2's opaque 403 without CORS), or an HTTP status. */
export type SendFailure =
  | { kind: "network" }
  | { kind: "http"; status: number };

/**
 * done: stored. paused: PART_MAX_ATTEMPTS retries spent (the upload pauses, and choosing the file resumes it). gone: 404,
 * the upload isn't open any more (aborted, replaced, expired or already assembled). failed: a request the server refuses
 * for good (400, 413), which no retry fixes.
 */
export type PartOutcome = "done" | "paused" | "gone" | "failed";

export const abortError = () =>
  new DOMException("The upload was cancelled.", "AbortError");

export const isAbort = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";

/** Resolves after `ms`, or rejects with an AbortError (clearing the timer) when `signal` aborts first. */
export function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** `promise`'s value, or `late` once `ms` passed first; the timer goes as soon as either settles. */
export function within<T, L>(
  promise: Promise<T>,
  ms: number,
  late: L,
): Promise<T | L> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<L>((resolve) => {
    timer = setTimeout(() => resolve(late), ms);
  });
  return Promise.race([promise, timedOut]).finally(() => clearTimeout(timer));
}

const isFailure = (error: unknown): error is SendFailure =>
  typeof error === "object" &&
  error !== null &&
  "kind" in error &&
  (error.kind === "network" || error.kind === "http");

/** What both retry loops wait on: `signal` ends every wait, and a failure while offline waits for `waitForOnline`. */
type RetryWatch = {
  signal: AbortSignal;
  isOnline: () => boolean;
  waitForOnline: (signal: AbortSignal) => Promise<void>;
  random?: () => number;
};

/**
 * Sends one part until it is stored (07 D80): a network error or a 403 gets the part's one re-sign (`resign`, a fresh URL
 * from /api/uploads/parts) and every later retry reuses that URL; a 5xx, 408 or 429 waits and retries without one. The
 * waits are RETRY_DELAYS_MS plus jitter; after PART_MAX_ATTEMPTS retries the part is 'paused'. A failure while the browser
 * is offline spends nothing: it waits for `waitForOnline` and sends again. Time offline can outlast the URL, so after it
 * the next failure gets a re-sign again; so does one after a re-sign that brought no URL. Rejects with an AbortError on
 * `signal`.
 */
export async function sendPartWithRetry(
  i: RetryWatch & {
    url: string;
    send: (url: string) => Promise<void>;
    /** A fresh URL for this part; null when the upload is gone (the parts route answers 404). */
    resign: () => Promise<string | null>;
    onRetrying?: (retry: number) => void;
  },
): Promise<PartOutcome> {
  let url = i.url;
  let resigned = false;
  let retries = 0;
  for (;;) {
    if (i.signal.aborted) throw abortError();
    let failure: SendFailure;
    try {
      await i.send(url);
      return "done";
    } catch (error) {
      if (i.signal.aborted) throw abortError();
      if (!isFailure(error)) throw error;
      failure = error;
    }
    const status = failure.kind === "http" ? failure.status : null;
    if (status === 404) return "gone";
    if (
      status !== null &&
      status !== 403 &&
      status < 500 &&
      status !== 408 &&
      status !== 429
    ) {
      return "failed";
    }
    // Offline (the 'offline' event can come after the failure): nothing is spent; send again once back online.
    if (!i.isOnline()) {
      await i.waitForOnline(i.signal);
      resigned = false;
      continue;
    }
    if (retries >= PART_MAX_ATTEMPTS) return "paused";
    retries += 1;
    i.onRetrying?.(retries);
    if (!resigned && (status === null || status === 403)) {
      try {
        const fresh = await i.resign();
        if (fresh === null) return "gone";
        url = fresh;
        resigned = true;
      } catch (error) {
        if (i.signal.aborted) throw abortError();
        // No fresh URL this time: keep the old one; the waits go on, and the next failure asks again.
        if (!isFailure(error)) throw error;
      }
    }
    await wait(retryDelayMs(retries, i.random), i.signal);
    if (!i.isOnline()) {
      await i.waitForOnline(i.signal);
      resigned = false;
    }
  }
}

/**
 * A route call that is safe to repeat (part URLs, a resume's start, complete), by sendPartWithRetry's rules: a dropped
 * connection (`network`) is called again after the same waits, up to PART_MAX_ATTEMPTS retries, and one while offline
 * waits for the connection without spending a retry. Any other answer comes back as it is; an abort of `signal` ends it
 * as canceled.
 */
export async function withRetries<T>(
  call: () => Promise<ApiResult<T>>,
  i: RetryWatch,
): Promise<ApiResult<T>> {
  let retries = 0;
  for (;;) {
    const result = await call();
    if (result.ok || result.code !== "network") return result;
    try {
      if (!i.isOnline()) {
        await i.waitForOnline(i.signal);
        continue;
      }
      if (retries >= PART_MAX_ATTEMPTS) return result;
      retries += 1;
      await wait(retryDelayMs(retries, i.random), i.signal);
      if (!i.isOnline()) await i.waitForOnline(i.signal);
    } catch {
      return { ok: false, code: "canceled" };
    }
  }
}
