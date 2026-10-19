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
