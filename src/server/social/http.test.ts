import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  SocialAuthError,
  SocialRateLimitError,
  SocialUpstreamError,
} from "./errors";
import { fetchJson } from "./http";

const URL_WITH_SECRETS =
  "https://graph.example.com/v1/me?access_token=SECRET_TOKEN&code=SECRET_CODE&client_secret=SECRET_CLIENT";
const schema = z.object({ id: z.string() });

const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchJson (02 §5.3)", () => {
  it("parses a 2xx body with the schema and passes a timeout signal", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "a" }));
    await expect(fetchJson(URL_WITH_SECRETS, { schema })).resolves.toEqual({
      id: "a",
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("maps a body that doesn't match the schema to SocialUpstreamError", async () => {
    fetchMock.mockResolvedValueOnce(json({ other: 1 }));
    await expect(
      fetchJson(URL_WITH_SECRETS, { schema }),
    ).rejects.toBeInstanceOf(SocialUpstreamError);
  });

  it("maps 401 to SocialAuthError without retrying", async () => {
    fetchMock.mockResolvedValue(json({}, 401));
    await expect(
      fetchJson(URL_WITH_SECRETS, { schema, retries: 3 }),
    ).rejects.toBeInstanceOf(SocialAuthError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["seconds", "120", 120],
    ["missing", undefined, 60],
    ["unreadable", "soon", 60],
  ])(
    "maps 429 to SocialRateLimitError (Retry-After %s)",
    async (_, header, sec) => {
      fetchMock.mockResolvedValueOnce(
        json({}, 429, header ? { "retry-after": header } : {}),
      );
      const error = await fetchJson(URL_WITH_SECRETS, {
        schema,
        retries: 3,
      }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SocialRateLimitError);
      expect((error as SocialRateLimitError).retryAfterSec).toBe(sec);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("reads Retry-After as an HTTP date", async () => {
    vi.setSystemTime(new Date("2026-10-18T12:00:00Z"));
    fetchMock.mockResolvedValueOnce(
      json({}, 429, { "retry-after": "Sun, 18 Oct 2026 12:05:00 GMT" }),
    );
    const error = await fetchJson(URL_WITH_SECRETS, { schema }).catch(
      (e: unknown) => e,
    );
    expect((error as SocialRateLimitError).retryAfterSec).toBe(300);
  });

  it("caps Retry-After at a day, in seconds or as a date", async () => {
    vi.setSystemTime(new Date("2026-10-18T12:00:00Z"));
    for (const header of ["99999999", "Wed, 18 Oct 2028 12:00:00 GMT"]) {
      fetchMock.mockResolvedValueOnce(json({}, 429, { "retry-after": header }));
      const error = await fetchJson(URL_WITH_SECRETS, { schema }).catch(
        (e: unknown) => e,
      );
      expect((error as SocialRateLimitError).retryAfterSec).toBe(86_400);
    }
  });

  it("doesn't retry by default, and maps another 4xx to SocialUpstreamError", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 503));
    await expect(
      fetchJson(URL_WITH_SECRETS, { schema }),
    ).rejects.toBeInstanceOf(SocialUpstreamError);
    fetchMock.mockResolvedValueOnce(json({}, 404));
    await expect(
      fetchJson(URL_WITH_SECRETS, { schema, retries: 3 }),
    ).rejects.toBeInstanceOf(SocialUpstreamError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries 5xx three times after 250 ms, 1 s and 4 s, then gives up", async () => {
    fetchMock.mockImplementation(async () => json({}, 502));
    const result = fetchJson(URL_WITH_SECRETS, { schema, retries: 3 });
    const settled = expect(result).rejects.toBeInstanceOf(SocialUpstreamError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(249);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await settled;
  });

  it("succeeds when a retry gets a 2xx, and retries a network failure", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(json({}, 500))
      .mockResolvedValueOnce(json({ id: "b" }));
    const result = fetchJson(URL_WITH_SECRETS, { schema, retries: 2 });
    await vi.advanceTimersByTimeAsync(250 + 1_000);
    await expect(result).resolves.toEqual({ id: "b" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("maps the timeout to SocialUpstreamError", async () => {
    fetchMock.mockRejectedValueOnce(
      new DOMException("timed out", "TimeoutError"),
    );
    await expect(
      fetchJson(URL_WITH_SECRETS, { schema }),
    ).rejects.toBeInstanceOf(SocialUpstreamError);
  });

  it("lets the adapter's mapError read a non-2xx body (Google invalid_grant, Instagram code 190)", async () => {
    const google = (_: number, body: unknown) =>
      (body as { error?: unknown } | null)?.error === "invalid_grant"
        ? new SocialAuthError()
        : null;
    const instagram = (_: number, body: unknown) =>
      (body as { error?: { code?: unknown } } | null)?.error?.code === 190
        ? new SocialAuthError()
        : null;
    fetchMock.mockResolvedValueOnce(json({ error: "invalid_grant" }, 400));
    await expect(
      fetchJson(URL_WITH_SECRETS, { schema, mapError: google }),
    ).rejects.toBeInstanceOf(SocialAuthError);
    fetchMock.mockResolvedValueOnce(json({ error: { code: 190 } }, 400));
    await expect(
      fetchJson(URL_WITH_SECRETS, { schema, mapError: instagram }),
    ).rejects.toBeInstanceOf(SocialAuthError);
    fetchMock.mockResolvedValueOnce(json({ error: "invalid_grant" }, 400));
    await expect(
      fetchJson(URL_WITH_SECRETS, { schema }),
    ).rejects.toBeInstanceOf(SocialUpstreamError);
  });

  it("falls back to the defaults when mapError returns null, and maps no body", async () => {
    const mapError = vi.fn(() => null);
    fetchMock.mockResolvedValueOnce(json({}, 401));
    await expect(
      fetchJson(URL_WITH_SECRETS, { schema, mapError }),
    ).rejects.toBeInstanceOf(SocialAuthError);
    fetchMock.mockResolvedValueOnce(new Response("not json", { status: 400 }));
    const error = (await fetchJson(URL_WITH_SECRETS, {
      schema,
      mapError,
    }).catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(SocialUpstreamError);
    expect(error.message).not.toMatch(/not json/);
    expect(mapError.mock.calls).toEqual([
      [401, {}],
      [400, null],
    ]);
  });

  it("reads or cancels every answer it doesn't return, so the connection is reused", async () => {
    const failed = json({}, 503);
    const ok = json({ id: "c" });
    fetchMock.mockResolvedValueOnce(failed).mockResolvedValueOnce(ok);
    const result = fetchJson(URL_WITH_SECRETS, { schema, retries: 1 });
    await vi.advanceTimersByTimeAsync(250);
    await expect(result).resolves.toEqual({ id: "c" });
    expect(failed.bodyUsed).toBe(true);

    const answers = [json({}, 400), json({}, 401), json({}, 429)];
    for (const answer of answers) {
      fetchMock.mockResolvedValueOnce(answer);
      await fetchJson(URL_WITH_SECRETS, { schema }).catch(() => null);
      expect(answer.bodyUsed).toBe(true);
    }
  });

  it("stops at once, with no retry, when the caller's signal aborts", async () => {
    const before = new AbortController();
    before.abort();
    await expect(
      fetchJson(URL_WITH_SECRETS, {
        schema,
        retries: 3,
        signal: before.signal,
      }),
    ).rejects.toBeInstanceOf(SocialUpstreamError);
    expect(fetchMock).not.toHaveBeenCalled();

    const during = new AbortController();
    fetchMock.mockImplementation(async (_: string, init: RequestInit) => {
      expect(init.signal?.aborted).toBe(false);
      during.abort();
      expect(init.signal?.aborted).toBe(true);
      throw new DOMException("aborted", "AbortError");
    });
    const error = (await fetchJson(URL_WITH_SECRETS, {
      schema,
      retries: 3,
      signal: during.signal,
    }).catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(SocialUpstreamError);
    expect(error.message).toBe("GET https://graph.example.com/v1/me aborted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops during a retry's wait when the caller's signal aborts", async () => {
    const budget = new AbortController();
    fetchMock.mockImplementation(async () => json({}, 503));
    const result = fetchJson(URL_WITH_SECRETS, {
      schema,
      retries: 3,
      signal: budget.signal,
    });
    const settled = expect(result).rejects.toThrow(
      "GET https://graph.example.com/v1/me aborted",
    );
    await vi.advanceTimersByTimeAsync(250);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 100 ms into the 1 s wait before the third try.
    await vi.advanceTimersByTimeAsync(100);
    budget.abort();
    await settled;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never puts the query or the body in an error message", async () => {
    const bodies = [
      json({ error: "SECRET_BODY" }, 400),
      json({ token: "SECRET_BODY" }),
      json({}, 503),
    ];
    for (const body of bodies) {
      fetchMock.mockResolvedValueOnce(body);
      const error = (await fetchJson(URL_WITH_SECRETS, { schema }).catch(
        (e: unknown) => e,
      )) as Error;
      expect(error.message).not.toMatch(/SECRET|\?/);
      expect(error.message).toContain("https://graph.example.com/v1/me");
    }
  });
});
