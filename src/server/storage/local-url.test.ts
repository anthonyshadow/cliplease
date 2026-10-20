import { describe, expect, it } from "vitest";
import {
  localRequestUrl,
  type SignedRequest,
  signLocalRequest,
  verifyLocalRequest,
} from "./local-url";

const SUBKEY = Buffer.alloc(32, 3);
const OTHER_SUBKEY = Buffer.alloc(32, 4);
const NOW_S = 1_800_000_000;
const KEY =
  "originals/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.mp4";
const UPLOAD_ID = "44444444-4444-4444-8444-444444444444";

const objectPut = {
  method: "PUT",
  key: "posters/22222222-2222-4222-8222-222222222222/55555555-5555-4555-8555-555555555555.jpg",
  exp: NOW_S + 3600,
  ct: "image/jpeg",
  len: 12_345,
} satisfies SignedRequest;
const partPut = {
  method: "PUT",
  key: KEY,
  exp: NOW_S + 3600,
  uploadId: UPLOAD_ID,
  partNumber: 2,
} satisfies SignedRequest;
const get = {
  method: "GET",
  key: KEY,
  exp: NOW_S + 300,
  cd: `attachment; filename="clip.mp4"; filename*=UTF-8''clip.mp4`,
} satisfies SignedRequest;

describe("signLocalRequest", () => {
  it("is 64 lower-case hex characters and deterministic", () => {
    for (const r of [objectPut, partPut, get]) {
      const sig = signLocalRequest(SUBKEY, r);
      expect(sig).toMatch(/^[0-9a-f]{64}$/);
      expect(signLocalRequest(SUBKEY, r)).toBe(sig);
    }
  });

  it("differs per subkey", () => {
    expect(signLocalRequest(SUBKEY, partPut)).not.toBe(
      signLocalRequest(OTHER_SUBKEY, partPut),
    );
  });
});

describe("verifyLocalRequest", () => {
  it.each([
    ["an object PUT", objectPut],
    ["a part PUT", partPut],
    ["a GET", get],
  ])("accepts %s it signed", (_, r) => {
    expect(
      verifyLocalRequest(SUBKEY, r, signLocalRequest(SUBKEY, r), NOW_S),
    ).toBe(true);
  });

  it("accepts up to and including the expiry second, then refuses", () => {
    const sig = signLocalRequest(SUBKEY, partPut);
    expect(verifyLocalRequest(SUBKEY, partPut, sig, partPut.exp)).toBe(true);
    expect(verifyLocalRequest(SUBKEY, partPut, sig, partPut.exp + 1)).toBe(
      false,
    );
  });

  it("refuses an expired request even with a valid signature", () => {
    const expired = { ...get, exp: NOW_S - 1 };
    expect(
      verifyLocalRequest(
        SUBKEY,
        expired,
        signLocalRequest(SUBKEY, expired),
        NOW_S,
      ),
    ).toBe(false);
  });

  it("refuses another subkey's signature", () => {
    expect(
      verifyLocalRequest(
        SUBKEY,
        partPut,
        signLocalRequest(OTHER_SUBKEY, partPut),
        NOW_S,
      ),
    ).toBe(false);
  });

  const tampered: Array<[string, SignedRequest, SignedRequest]> = [
    ["key (object)", objectPut, { ...objectPut, key: `${objectPut.key}x` }],
    ["key (part)", partPut, { ...partPut, key: KEY.replace(".mp4", ".mov") }],
    ["key (GET)", get, { ...get, key: "posters/a/b.jpg" }],
    [
      "method",
      get,
      { method: "PUT", key: get.key, exp: get.exp, ct: "x", len: 1 },
    ],
    ["exp (object)", objectPut, { ...objectPut, exp: objectPut.exp + 1 }],
    ["exp (part)", partPut, { ...partPut, exp: partPut.exp + 60 }],
    ["exp (GET)", get, { ...get, exp: get.exp + 1 }],
    ["cd", get, { ...get, cd: `inline; filename="clip.mp4"` }],
    [
      "uploadId",
      partPut,
      { ...partPut, uploadId: "44444444-4444-4444-8444-444444444445" },
    ],
    ["partNumber", partPut, { ...partPut, partNumber: 3 }],
    ["ct", objectPut, { ...objectPut, ct: "image/png" }],
    ["len", objectPut, { ...objectPut, len: objectPut.len + 1 }],
  ];

  it.each(tampered)("refuses a tampered %s", (_, signed, sent) => {
    const sig = signLocalRequest(SUBKEY, signed);
    expect(verifyLocalRequest(SUBKEY, sent, sig, NOW_S)).toBe(false);
  });

  it("does not let a part signature stand for an object PUT of the same key", () => {
    const sig = signLocalRequest(SUBKEY, partPut);
    const asObject: SignedRequest = {
      method: "PUT",
      key: KEY,
      exp: partPut.exp,
      ct: "video/mp4",
      len: 1,
    };
    expect(verifyLocalRequest(SUBKEY, asObject, sig, NOW_S)).toBe(false);
  });

  it("refuses a non-hex, upper-case, short, long or empty signature", () => {
    const sig = signLocalRequest(SUBKEY, partPut);
    for (const bad of [
      `${sig.slice(0, 63)}g`,
      sig.toUpperCase(),
      sig.slice(0, 62),
      `${sig}00`,
      "",
    ]) {
      expect(verifyLocalRequest(SUBKEY, partPut, bad, NOW_S)).toBe(false);
    }
  });

  it("refuses a one-character change to the signature", () => {
    const sig = signLocalRequest(SUBKEY, partPut);
    const flipped = `${sig.slice(0, -1)}${sig.endsWith("0") ? "1" : "0"}`;
    expect(verifyLocalRequest(SUBKEY, partPut, flipped, NOW_S)).toBe(false);
  });
});

describe("localRequestUrl", () => {
  const ORIGIN = "http://localhost:3000";

  it("builds a part URL with uploadId, partNumber, exp and sig, and no checksum or type", () => {
    const url = new URL(localRequestUrl(ORIGIN, SUBKEY, partPut));
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe(`/api/dev/storage/${KEY}`);
    expect([...url.searchParams.keys()].sort()).toEqual(
      ["exp", "partNumber", "sig", "uploadId"].sort(),
    );
    expect(url.searchParams.get("uploadId")).toBe(UPLOAD_ID);
    expect(url.searchParams.get("partNumber")).toBe("2");
    expect(url.searchParams.get("exp")).toBe(String(partPut.exp));
    expect(url.searchParams.get("sig")).toBe(signLocalRequest(SUBKEY, partPut));
  });

  it("builds an object PUT URL with ct and len", () => {
    const url = new URL(localRequestUrl(ORIGIN, SUBKEY, objectPut));
    expect([...url.searchParams.keys()].sort()).toEqual(
      ["ct", "exp", "len", "sig"].sort(),
    );
    expect(url.searchParams.get("ct")).toBe("image/jpeg");
    expect(url.searchParams.get("len")).toBe("12345");
  });

  it("builds a GET URL whose cd round-trips through the query", () => {
    const url = new URL(localRequestUrl(ORIGIN, SUBKEY, get));
    expect([...url.searchParams.keys()].sort()).toEqual(
      ["cd", "exp", "sig"].sort(),
    );
    expect(url.searchParams.get("cd")).toBe(get.cd);
  });

  it("verifies from the values read back out of the URL", () => {
    const url = new URL(localRequestUrl(ORIGIN, SUBKEY, partPut));
    const parsed: SignedRequest = {
      method: "PUT",
      key: decodeURIComponent(url.pathname.replace("/api/dev/storage/", "")),
      exp: Number(url.searchParams.get("exp")),
      uploadId: url.searchParams.get("uploadId") ?? "",
      partNumber: Number(url.searchParams.get("partNumber")),
    };
    expect(
      verifyLocalRequest(
        SUBKEY,
        parsed,
        url.searchParams.get("sig") ?? "",
        NOW_S,
      ),
    ).toBe(true);
  });

  it("encodes each key segment but keeps the slashes", () => {
    const r: SignedRequest = { ...get, key: "licenses/a b/c#d?.pdf" };
    const raw = localRequestUrl(ORIGIN, SUBKEY, r);
    expect(raw).toContain("/api/dev/storage/licenses/a%20b/c%23d%3F.pdf?");
    const url = new URL(raw);
    expect(url.pathname.split("/").slice(4).map(decodeURIComponent)).toEqual([
      "licenses",
      "a b",
      "c#d?.pdf",
    ]);
  });
});
