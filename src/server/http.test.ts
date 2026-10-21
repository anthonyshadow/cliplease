import { describe, expect, it } from "vitest";
import { countingStream } from "../../tests/helpers/streams";
import { readJsonCapped } from "./http";

const ROUTE_URL = "http://localhost:3000/api/uploads/start";
const MAX = 64;

const post = (body: BodyInit | null) =>
  new Request(ROUTE_URL, { method: "POST", body });

/** A body of `chunks` chunks of `size` bytes each, pulled one at a time; reports how many were pulled and the cancel. */
function chunkedBody(
  chunks: number,
  size: number,
  headers: Record<string, string> = {},
) {
  const chunk = new TextEncoder().encode(" ".repeat(size));
  const { stream, ...counts } = countingStream(
    Array.from({ length: chunks }, () => chunk),
  );
  // Node's fetch needs `duplex` for a stream body; the DOM's RequestInit doesn't list it.
  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    body: stream,
    headers,
    duplex: "half",
  };
  return { request: new Request(ROUTE_URL, init), ...counts };
}

describe("readJsonCapped", () => {
  it("parses a JSON body up to the cap, exactly the cap included", async () => {
    expect(await readJsonCapped(post('{"a":1}'), MAX)).toEqual({
      ok: true,
      body: { a: 1 },
    });
    const atCap = `${" ".repeat(MAX - 7)}{"a":1}`;
    expect(await readJsonCapped(post(atCap), MAX)).toEqual({
      ok: true,
      body: { a: 1 },
    });
  });

  it("refuses a body one byte over the cap", async () => {
    const over = `${" ".repeat(MAX - 6)}{"a":1}`;
    expect(await readJsonCapped(post(over), MAX)).toEqual({ ok: false });
  });

  it("refuses unread when the Content-Length says more than the cap", async () => {
    const { request, pulled } = chunkedBody(1, 2, {
      "content-length": String(MAX + 1),
    });
    expect(await readJsonCapped(request, MAX)).toEqual({ ok: false });
    expect(pulled()).toBe(0);
  });

  it("stops reading a body with no length once it goes over, and cancels it", async () => {
    const { request, pulled, cancelled } = chunkedBody(1000, 16);
    expect(await readJsonCapped(request, MAX)).toEqual({ ok: false });
    expect(pulled()).toBeLessThanOrEqual(MAX / 16 + 2);
    expect(cancelled()).toBe(true);
  });

  it("refuses no body, an empty one, one that isn't JSON and one that isn't UTF-8", async () => {
    expect(await readJsonCapped(post(null), MAX)).toEqual({ ok: false });
    expect(await readJsonCapped(post(""), MAX)).toEqual({ ok: false });
    expect(await readJsonCapped(post("{not json"), MAX)).toEqual({
      ok: false,
    });
    const latin1 = new Uint8Array([0x22, 0xe9, 0x22]); // "é" in Latin-1, quoted
    expect(await readJsonCapped(post(latin1), MAX)).toEqual({ ok: false });
  });
});
