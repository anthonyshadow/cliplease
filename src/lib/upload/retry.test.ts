import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiResult } from "./http";
import { PART_MAX_ATTEMPTS } from "./limits";
import {
  abortError,
  isAbort,
  RETRY_DELAYS_MS,
  retryDelayMs,
  type SendFailure,
  sendPartWithRetry,
  wait,
  within,
  withRetries,
} from "./retry";

const OLD_URL = "https://storage.test/part-1?sig=old";
const FRESH_URL = "https://storage.test/part-1?sig=fresh";
const FRESHER_URL = "https://storage.test/part-1?sig=fresher";
const network: SendFailure = { kind: "network" };
const http = (status: number): SendFailure => ({ kind: "http", status });
const times = (n: number, failure: SendFailure) =>
  Array.from({ length: n }, () => failure);
/** The waits before retries 1–5 at random 0 and 0.999: base and base + floor(0.999 × base × 0.25). */
const WAITS_AT_0 = [1000, 2000, 4000, 8000, 16000];
const WAITS_AT_0999 = [1249, 2499, 4999, 9998, 19996];

/** One part whose sends fail with `failures` in turn and then succeed. `start` runs sendPartWithRetry on it. */
function part(...failures: SendFailure[]) {
  const controller = new AbortController();
  const send = vi.fn((_url: string): Promise<void> => {
    const failure = failures.shift();
    return failure ? Promise.reject(failure) : Promise.resolve();
  });
  const resign = vi.fn(
    (): Promise<string | null> => Promise.resolve(FRESH_URL),
  );
  const isOnline = vi.fn(() => true);
  const waitForOnline = vi.fn((_signal: AbortSignal) => Promise.resolve());
  const onRetrying = vi.fn((_retry: number) => undefined);
  const start = (random: () => number = () => 0) =>
    sendPartWithRetry({
      url: OLD_URL,
      send,
      resign,
      signal: controller.signal,
      isOnline,
      waitForOnline,
      random,
      onRetrying,
    });
  const urls = () => send.mock.calls.map(([url]) => url);
  return {
    controller,
    send,
    resign,
    isOnline,
    waitForOnline,
    onRetrying,
    start,
    urls,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("retryDelayMs (07 D80, Q-45 a)", () => {
  it("has one wait per retry", () => {
    expect(RETRY_DELAYS_MS).toEqual(WAITS_AT_0);
    expect(RETRY_DELAYS_MS).toHaveLength(PART_MAX_ATTEMPTS);
  });

  it.each([
    [0, WAITS_AT_0],
    [0.999, WAITS_AT_0999],
  ])("waits base + floor(random × base × 0.25) with random %s", (r, waits) => {
    const delays = [1, 2, 3, 4, 5].map((retry) => retryDelayMs(retry, () => r));
    expect(delays).toEqual(waits);
    delays.forEach((delay, i) => {
      expect(delay).toBeLessThan(RETRY_DELAYS_MS[i] * 1.25);
    });
  });

  it("clamps a retry outside 1…5 to the first or last wait", () => {
    expect(retryDelayMs(0, () => 0)).toBe(1000);
    expect(retryDelayMs(6, () => 0)).toBe(16000);
  });
});

describe("sendPartWithRetry (07 D80)", () => {
  it("returns done on a first send that succeeds, with no timer", async () => {
    const p = part();
    await expect(p.start()).resolves.toBe("done");
    expect(p.urls()).toEqual([OLD_URL]);
    expect(p.resign).not.toHaveBeenCalled();
    expect(p.onRetrying).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("re-signs after a network error and sends the fresh URL after 1–1.25 s", async () => {
    const p = part(network);
    const outcome = p.start(Math.random);
    await vi.advanceTimersByTimeAsync(999);
    expect(p.send).toHaveBeenCalledTimes(1);
    expect(p.resign).toHaveBeenCalledTimes(1);
    expect(p.onRetrying.mock.calls).toEqual([[1]]);
    await vi.advanceTimersByTimeAsync(250);
    await expect(outcome).resolves.toBe("done");
    expect(p.urls()).toEqual([OLD_URL, FRESH_URL]);
  });

  it.each([
    ["random 0", () => 0, WAITS_AT_0],
    ["random 0.999", () => 0.999, WAITS_AT_0999],
  ])(
    "waits 1/2/4/8/16 s (%s), then pauses after PART_MAX_ATTEMPTS retries",
    async (_name, random, delays) => {
      const p = part(...times(PART_MAX_ATTEMPTS + 1, network));
      const outcome = p.start(random);
      for (const [i, delay] of delays.entries()) {
        await vi.advanceTimersByTimeAsync(delay - 1);
        expect(p.send).toHaveBeenCalledTimes(i + 1);
        await vi.advanceTimersByTimeAsync(1);
        expect(p.send).toHaveBeenCalledTimes(i + 2);
      }
      await expect(outcome).resolves.toBe("paused");
      expect(p.send).toHaveBeenCalledTimes(6);
      expect(p.onRetrying.mock.calls).toEqual([[1], [2], [3], [4], [5]]);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("re-signs once per part however many network errors and 403s follow", async () => {
    const p = part(network, http(403), network, http(403), network);
    const outcome = p.start();
    await vi.runAllTimersAsync();
    await expect(outcome).resolves.toBe("done");
    expect(p.resign).toHaveBeenCalledTimes(1);
    expect(p.urls()).toEqual([OLD_URL, ...Array<string>(5).fill(FRESH_URL)]);
  });

  it("re-signs after a 403", async () => {
    const p = part(http(403));
    const outcome = p.start();
    await vi.runAllTimersAsync();
    await expect(outcome).resolves.toBe("done");
    expect(p.resign).toHaveBeenCalledTimes(1);
    expect(p.urls()).toEqual([OLD_URL, FRESH_URL]);
  });

  it("retries a 500 with the same URL and re-signs only at a later 403", async () => {
    const p = part(http(500), http(500), http(403));
    const outcome = p.start();
    await vi.advanceTimersByTimeAsync(1000 + 1999);
    expect(p.resign).not.toHaveBeenCalled();
    expect(p.urls()).toEqual([OLD_URL, OLD_URL]);
    await vi.runAllTimersAsync();
    await expect(outcome).resolves.toBe("done");
    expect(p.resign).toHaveBeenCalledTimes(1);
    expect(p.urls()).toEqual([OLD_URL, OLD_URL, OLD_URL, FRESH_URL]);
  });

  it.each([408, 429, 500, 503])(
    "retries a %i without a re-sign",
    async (status) => {
      const p = part(http(status));
      const outcome = p.start();
      await vi.advanceTimersByTimeAsync(1000);
      await expect(outcome).resolves.toBe("done");
      expect(p.resign).not.toHaveBeenCalled();
      expect(p.urls()).toEqual([OLD_URL, OLD_URL]);
    },
  );

  it("gives up as gone on a 404 at once", async () => {
    const p = part(http(404));
    await expect(p.start()).resolves.toBe("gone");
    expect(p.send).toHaveBeenCalledTimes(1);
    expect(p.resign).not.toHaveBeenCalled();
    expect(p.onRetrying).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([400, 413])("fails on a %i at once", async (status) => {
    const p = part(http(status));
    await expect(p.start()).resolves.toBe("failed");
    expect(p.send).toHaveBeenCalledTimes(1);
    expect(p.resign).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is gone when the re-sign finds no upload", async () => {
    const p = part(network);
    p.resign.mockResolvedValueOnce(null);
    await expect(p.start()).resolves.toBe("gone");
    expect(p.send).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the old URL when the re-sign fails, and re-signs at the next failure", async () => {
    const p = part(network, network);
    p.resign.mockRejectedValueOnce(network);
    const outcome = p.start();
    await vi.runAllTimersAsync();
    await expect(outcome).resolves.toBe("done");
    expect(p.resign).toHaveBeenCalledTimes(2);
    expect(p.urls()).toEqual([OLD_URL, OLD_URL, FRESH_URL]);
  });

  it.each<[string, SendFailure[], boolean[]]>([
    // Online at the failure, offline after the wait; online again at the 403.
    ["during a retry wait", [network, http(403)], [true, false]],
    // Online at the failure and after the wait, offline at the next failure; online again at the 403.
    ["after a failure", [network, network, http(403)], [true, true, false]],
  ])(
    "re-signs again after time offline %s: the URL may have expired meanwhile",
    async (_, failures, online) => {
      const p = part(...failures);
      for (const value of online) p.isOnline.mockReturnValueOnce(value);
      p.resign
        .mockResolvedValueOnce(FRESH_URL)
        .mockResolvedValueOnce(FRESHER_URL);
      const outcome = p.start();
      await vi.runAllTimersAsync();
      await expect(outcome).resolves.toBe("done");
      expect(p.waitForOnline).toHaveBeenCalledTimes(1);
      expect(p.resign).toHaveBeenCalledTimes(2);
      expect(p.urls().at(-1)).toBe(FRESHER_URL);
    },
  );

  it("spends no retry and no re-sign on failures while offline", async () => {
    const p = part(...times(5, network));
    p.isOnline.mockReturnValue(false);
    await expect(p.start()).resolves.toBe("done");
    expect(p.send).toHaveBeenCalledTimes(6);
    expect(p.waitForOnline).toHaveBeenCalledTimes(5);
    expect(p.waitForOnline).toHaveBeenCalledWith(p.controller.signal);
    expect(p.resign).not.toHaveBeenCalled();
    expect(p.onRetrying).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("still has every retry after offline failures", async () => {
    const p = part(...times(5 + PART_MAX_ATTEMPTS + 1, network));
    for (let n = 0; n < 5; n++) p.isOnline.mockReturnValueOnce(false);
    const outcome = p.start();
    await vi.runAllTimersAsync();
    await expect(outcome).resolves.toBe("paused");
    expect(p.send).toHaveBeenCalledTimes(11);
    expect(p.resign).toHaveBeenCalledTimes(1);
    expect(p.onRetrying.mock.calls).toEqual([[1], [2], [3], [4], [5]]);
  });

  it("sends again only once waitForOnline resolves", async () => {
    const p = part(network);
    const online = Promise.withResolvers<void>();
    p.isOnline.mockReturnValueOnce(false);
    p.waitForOnline.mockReturnValueOnce(online.promise);
    const outcome = p.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(p.send).toHaveBeenCalledTimes(1);
    online.resolve();
    await expect(outcome).resolves.toBe("done");
    expect(p.urls()).toEqual([OLD_URL, OLD_URL]);
  });

  it("waits for online when the browser went offline during a retry wait", async () => {
    const p = part(network);
    const online = Promise.withResolvers<void>();
    p.isOnline.mockReturnValueOnce(true).mockReturnValueOnce(false);
    p.waitForOnline.mockReturnValueOnce(online.promise);
    const outcome = p.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(p.waitForOnline).toHaveBeenCalledTimes(1);
    expect(p.send).toHaveBeenCalledTimes(1);
    online.resolve();
    await expect(outcome).resolves.toBe("done");
    expect(p.urls()).toEqual([OLD_URL, FRESH_URL]);
    expect(p.onRetrying.mock.calls).toEqual([[1]]);
  });

  it("rejects with an AbortError on an abort during a wait and leaves no timer", async () => {
    const p = part(network);
    const outcome = p.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(vi.getTimerCount()).toBe(1);
    p.controller.abort();
    await expect(outcome).rejects.toMatchObject({ name: "AbortError" });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(p.send).toHaveBeenCalledTimes(1);
  });

  it("rejects at once when the signal is already aborted", async () => {
    const p = part();
    p.controller.abort();
    await expect(p.start()).rejects.toMatchObject({ name: "AbortError" });
    expect(p.send).not.toHaveBeenCalled();
  });

  it("rejects with an AbortError when a send fails because of the abort", async () => {
    const p = part();
    p.send.mockImplementationOnce(() => {
      p.controller.abort();
      return Promise.reject(network);
    });
    await expect(p.start()).rejects.toMatchObject({ name: "AbortError" });
    expect(p.resign).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rethrows an error that is not a send failure", async () => {
    const p = part();
    const bug = new TypeError("file.slice is not a function");
    p.send.mockRejectedValueOnce(bug);
    await expect(p.start()).rejects.toBe(bug);
    expect(p.send).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rethrows an error from the re-sign that is not a send failure", async () => {
    const p = part(network);
    const bug = new TypeError("bad parts response");
    p.resign.mockRejectedValueOnce(bug);
    await expect(p.start()).rejects.toBe(bug);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("wait", () => {
  it("resolves after `ms` without a signal", async () => {
    const resolved = vi.fn();
    const waiting = wait(1000).then(resolved);
    await vi.advanceTimersByTimeAsync(999);
    expect(resolved).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(resolved).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("tells its AbortError from other errors", () => {
    expect(isAbort(abortError())).toBe(true);
    expect(isAbort(new DOMException("blocked", "SecurityError"))).toBe(false);
    expect(isAbort(new TypeError("Failed to fetch"))).toBe(false);
  });
});

describe("within", () => {
  it("is the promise's value when it settles first, and leaves no timer", async () => {
    await expect(within(Promise.resolve("id"), 1000, null)).resolves.toBe("id");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is `late` once `ms` passed first", async () => {
    const result = vi.fn();
    const racing = within(
      new Promise<string>(() => undefined),
      1000,
      null,
    ).then(result);
    await vi.advanceTimersByTimeAsync(999);
    expect(result).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await racing;
    expect(result).toHaveBeenCalledWith(null);
  });
});

describe("withRetries (07 D80)", () => {
  const OK: ApiResult<string> = { ok: true, data: "urls" };
  const DROPPED: ApiResult<string> = { ok: false, code: "network" };
  const dropped = (n: number) => Array.from({ length: n }, () => DROPPED);

  /** A route call that answers `answers` in turn and then OK. `start` runs withRetries on it. */
  function route(...answers: ApiResult<string>[]) {
    const controller = new AbortController();
    const call = vi.fn(
      (): Promise<ApiResult<string>> => Promise.resolve(answers.shift() ?? OK),
    );
    const isOnline = vi.fn(() => true);
    const waitForOnline = vi.fn((_signal: AbortSignal) => Promise.resolve());
    const start = (random: () => number = () => 0) =>
      withRetries(call, {
        signal: controller.signal,
        isOnline,
        waitForOnline,
        random,
      });
    return { controller, call, isOnline, waitForOnline, start };
  }

  it("returns a first answer that succeeds, with no timer", async () => {
    const r = route();
    await expect(r.start()).resolves.toEqual(OK);
    expect(r.call).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["not_found", "unauthorized", "internal", "canceled"] as const)(
    "returns %s at once, with no retry",
    async (code) => {
      const r = route({ ok: false, code });
      await expect(r.start()).resolves.toEqual({ ok: false, code });
      expect(r.call).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each([
    ["random 0", () => 0, WAITS_AT_0],
    ["random 0.999", () => 0.999, WAITS_AT_0999],
  ])(
    "calls again after 1/2/4/8/16 s (%s), then gives up as network after PART_MAX_ATTEMPTS retries",
    async (_name, random, delays) => {
      const r = route(...dropped(PART_MAX_ATTEMPTS + 1));
      const outcome = r.start(random);
      for (const [i, delay] of delays.entries()) {
        await vi.advanceTimersByTimeAsync(delay - 1);
        expect(r.call).toHaveBeenCalledTimes(i + 1);
        await vi.advanceTimersByTimeAsync(1);
        expect(r.call).toHaveBeenCalledTimes(i + 2);
      }
      await expect(outcome).resolves.toEqual(DROPPED);
      expect(r.call).toHaveBeenCalledTimes(6);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("returns the answer of a later call", async () => {
    const r = route(DROPPED, { ok: false, code: "not_found" });
    const outcome = r.start();
    await vi.runAllTimersAsync();
    await expect(outcome).resolves.toEqual({ ok: false, code: "not_found" });
    expect(r.call).toHaveBeenCalledTimes(2);
  });

  it("spends no retry on dropped connections while offline", async () => {
    const r = route(...dropped(5));
    r.isOnline.mockReturnValue(false);
    await expect(r.start()).resolves.toEqual(OK);
    expect(r.call).toHaveBeenCalledTimes(6);
    expect(r.waitForOnline).toHaveBeenCalledTimes(5);
    expect(r.waitForOnline).toHaveBeenCalledWith(r.controller.signal);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("still has every retry after offline failures", async () => {
    const r = route(...dropped(5 + PART_MAX_ATTEMPTS + 1));
    for (let n = 0; n < 5; n++) r.isOnline.mockReturnValueOnce(false);
    const outcome = r.start();
    await vi.runAllTimersAsync();
    await expect(outcome).resolves.toEqual(DROPPED);
    expect(r.call).toHaveBeenCalledTimes(11);
  });

  it("waits for online when the browser went offline during a retry wait", async () => {
    const r = route(DROPPED);
    const online = Promise.withResolvers<void>();
    r.isOnline.mockReturnValueOnce(true).mockReturnValueOnce(false);
    r.waitForOnline.mockReturnValueOnce(online.promise);
    const outcome = r.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(r.waitForOnline).toHaveBeenCalledTimes(1);
    expect(r.call).toHaveBeenCalledTimes(1);
    online.resolve();
    await expect(outcome).resolves.toEqual(OK);
    expect(r.call).toHaveBeenCalledTimes(2);
  });

  it("is canceled on an abort during a wait and leaves no timer", async () => {
    const r = route(DROPPED);
    const outcome = r.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(vi.getTimerCount()).toBe(1);
    r.controller.abort();
    await expect(outcome).resolves.toEqual({ ok: false, code: "canceled" });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(r.call).toHaveBeenCalledTimes(1);
  });

  it("is canceled when the wait for the connection is aborted", async () => {
    const r = route(DROPPED);
    r.isOnline.mockReturnValue(false);
    r.waitForOnline.mockRejectedValueOnce(abortError());
    await expect(r.start()).resolves.toEqual({ ok: false, code: "canceled" });
    expect(r.call).toHaveBeenCalledTimes(1);
  });
});
