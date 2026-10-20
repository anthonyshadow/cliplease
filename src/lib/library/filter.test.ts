import { describe, expect, it } from "vitest";
import {
  decodeLibraryCursor,
  encodeLibraryCursor,
  escapeLike,
  LibraryFilterSchema,
  libraryHref,
} from "./filter";

const ID = "6f1c2a4e-8b3d-4f5a-9c7e-1d2b3a4c5e6f";
const AT = new Date("2026-10-01T15:00:00.123Z");

describe("encodeLibraryCursor / decodeLibraryCursor (03 §7.2)", () => {
  it("round-trips a post's position as base64url JSON", () => {
    const cursor = encodeLibraryCursor({ postedAt: AT, id: ID });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeLibraryCursor(cursor)).toEqual({
      p: "2026-10-01T15:00:00.123Z",
      i: ID,
    });
    expect(JSON.parse(Buffer.from(cursor, "base64url").toString())).toEqual({
      p: AT.toISOString(),
      i: ID,
    });
  });

  it("reads anything that isn't one of ours as null", () => {
    const b64 = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    for (const raw of [
      "",
      "garbage",
      "a",
      "%%%",
      "x".repeat(201),
      `${encodeLibraryCursor({ postedAt: AT, id: ID })}=`,
      Buffer.from("not json").toString("base64url"),
      b64(null),
      b64([AT.toISOString(), ID]),
      b64({ p: AT.toISOString() }),
      b64({ p: "yesterday", i: ID }),
      b64({ p: AT.toISOString(), i: "not-a-uuid" }),
      b64({ p: AT.toISOString(), i: ID, extra: 1 }),
      // Postgres has no year 0: a crafted cursor would make the query throw.
      b64({ p: "0000-01-01T00:00:00Z", i: ID }),
    ]) {
      expect(decodeLibraryCursor(raw), raw).toBeNull();
    }
  });
});

describe("escapeLike (03 §7.2)", () => {
  it("makes \\, % and _ match themselves", () => {
    expect(escapeLike("100% real")).toBe("100\\% real");
    expect(escapeLike("snake_case")).toBe("snake\\_case");
    expect(escapeLike("back\\slash")).toBe("back\\\\slash");
    expect(escapeLike("%_\\")).toBe("\\%\\_\\\\");
    expect(escapeLike("plain snow")).toBe("plain snow");
  });
});

describe("LibraryFilterSchema (07 D48)", () => {
  const parse = (params: Record<string, string | string[] | undefined>) =>
    LibraryFilterSchema.parse(params);

  it("reads the four params, ?account= as accountId, q trimmed", () => {
    const cursor = encodeLibraryCursor({ postedAt: AT, id: ID });
    expect(
      parse({ platform: "mock", account: ID, q: "  snow ", cursor }),
    ).toEqual({ platform: "mock", accountId: ID, q: "snow", cursor });
    expect(parse({})).toEqual({});
  });

  it("drops each invalid param on its own, never throwing", () => {
    expect(parse({ platform: "myspace", q: "snow" })).toEqual({ q: "snow" });
    expect(parse({ account: "not-a-uuid", platform: "tiktok" })).toEqual({
      platform: "tiktok",
    });
    expect(parse({ cursor: "garbage", q: "snow" })).toEqual({ q: "snow" });
  });

  it("keeps q of 2 to 100 characters and drops 1 and 101", () => {
    expect(parse({ q: "ab" })).toEqual({ q: "ab" });
    expect(parse({ q: "a".repeat(100) })).toEqual({ q: "a".repeat(100) });
    expect(parse({ q: "a" })).toEqual({});
    expect(parse({ q: " a " })).toEqual({});
    expect(parse({ q: "a".repeat(101) })).toEqual({});
    expect(parse({ q: "   " })).toEqual({});
    // Postgres refuses NUL in text.
    expect(parse({ q: "a\u0000b" })).toEqual({});
  });

  it("drops a repeated param", () => {
    expect(parse({ platform: ["mock", "tiktok"], q: ["a", "b"] })).toEqual({});
  });
});

describe("libraryHref", () => {
  it("writes the params in a fixed order and drops the empty ones", () => {
    expect(libraryHref({})).toBe("/dashboard/library");
    expect(
      libraryHref({ q: "100% real", accountId: ID, platform: "mock" }),
    ).toBe(`/dashboard/library?platform=mock&account=${ID}&q=100%25+real`);
    expect(libraryHref({ cursor: "abc", q: undefined })).toBe(
      "/dashboard/library?cursor=abc",
    );
  });
});
