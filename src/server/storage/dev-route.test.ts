import { describe, expect, it } from "vitest";
import { isDevStorageEnabled, parseDevStorageRequest } from "./dev-route";
import {
  localRequestUrl,
  type SignedRequest,
  verifyLocalRequest,
} from "./local-url";

const SUBKEY = Buffer.alloc(32, 8);
const SIG = "a".repeat(64);
const EXP = "1800000000";
const UPLOAD_ID = "44444444-4444-4444-8444-444444444444";
const SEGMENTS = [
  "originals",
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333.mp4",
];
const KEY = SEGMENTS.join("/");
const POSTER_SEGMENTS = [
  "posters",
  "22222222-2222-4222-8222-222222222222",
  "55555555-5555-4555-8555-555555555555.jpg",
];
const CD = `attachment; filename="clip.mp4"; filename*=UTF-8''clip.mp4`;

const q = (params: Record<string, string>) => new URLSearchParams(params);

describe("isDevStorageEnabled (07 D51)", () => {
  it.each([
    ["development", "local", true],
    ["test", "local", true],
    ["production", "local", false],
    ["preview", "local", false],
    ["development", "r2", false],
    ["test", "r2", false],
    ["production", "r2", false],
  ] as const)(
    "APP_ENV=%s STORAGE_DRIVER=%s → %s",
    (APP_ENV, STORAGE_DRIVER, enabled) => {
      expect(isDevStorageEnabled({ APP_ENV, STORAGE_DRIVER })).toBe(enabled);
    },
  );
});

describe("parseDevStorageRequest", () => {
  describe("well-formed", () => {
    it("parses a GET with cd", () => {
      expect(
        parseDevStorageRequest(
          "GET",
          SEGMENTS,
          q({ cd: CD, exp: EXP, sig: SIG }),
        ),
      ).toEqual({
        request: { method: "GET", key: KEY, exp: 1_800_000_000, cd: CD },
        sig: SIG,
      });
    });

    it("parses a part PUT with uploadId and partNumber", () => {
      expect(
        parseDevStorageRequest(
          "PUT",
          SEGMENTS,
          q({ uploadId: UPLOAD_ID, partNumber: "3", exp: EXP, sig: SIG }),
        ),
      ).toEqual({
        request: {
          method: "PUT",
          key: KEY,
          exp: 1_800_000_000,
          uploadId: UPLOAD_ID,
          partNumber: 3,
        },
        sig: SIG,
      });
    });

    it("accepts part numbers 1 and 10000 (R2's range)", () => {
      for (const partNumber of ["1", "10000"]) {
        const parsed = parseDevStorageRequest(
          "PUT",
          SEGMENTS,
          q({ uploadId: UPLOAD_ID, partNumber, exp: EXP, sig: SIG }),
        );
        expect(parsed?.request).toMatchObject({
          partNumber: Number(partNumber),
        });
      }
    });

    it("parses a single PUT with ct and len", () => {
      expect(
        parseDevStorageRequest(
          "PUT",
          POSTER_SEGMENTS,
          q({ ct: "image/jpeg", len: "48213", exp: EXP, sig: SIG }),
        ),
      ).toEqual({
        request: {
          method: "PUT",
          key: POSTER_SEGMENTS.join("/"),
          exp: 1_800_000_000,
          ct: "image/jpeg",
          len: 48_213,
        },
        sig: SIG,
      });
    });

    it.each<[string, SignedRequest]>([
      ["a GET", { method: "GET", key: KEY, exp: 1_800_000_000, cd: CD }],
      [
        "a part PUT",
        {
          method: "PUT",
          key: KEY,
          exp: 1_800_000_000,
          uploadId: UPLOAD_ID,
          partNumber: 7,
        },
      ],
      [
        "a single PUT",
        {
          method: "PUT",
          key: POSTER_SEGMENTS.join("/"),
          exp: 1_800_000_000,
          ct: "image/jpeg",
          len: 48_213,
        },
      ],
    ])("reads back %s that localRequestUrl signed, and it verifies", (_, r) => {
      const url = new URL(localRequestUrl("http://localhost:3000", SUBKEY, r));
      const segments = url.pathname
        .replace(/^\/api\/dev\/storage\//, "")
        .split("/")
        .map(decodeURIComponent);
      const parsed = parseDevStorageRequest(
        r.method,
        segments,
        url.searchParams,
      );
      expect(parsed?.request).toEqual(r);
      expect(
        parsed &&
          verifyLocalRequest(SUBKEY, parsed.request, parsed.sig, 1_700_000_000),
      ).toBe(true);
    });
  });

  describe("malformed → null", () => {
    const part = { uploadId: UPLOAD_ID, partNumber: "1", exp: EXP, sig: SIG };
    const single = { ct: "video/mp4", len: "10", exp: EXP, sig: SIG };
    const getQuery = { cd: CD, exp: EXP, sig: SIG };

    it.each([
      ["a '..' segment", ["originals", "..", "x.mp4"]],
      ["a '.' segment", ["originals", "a", ".", "b.mp4"]],
      ["an empty segment", ["originals", "", "x.mp4"]],
      ["a trailing empty segment", ["originals", "x", ""]],
      ["a decoded '%2F' carrying '..'", ["originals", "a/../b"]],
      [
        "a decoded '%2F' that would make a valid key",
        ["originals", "a/b", "c.mp4"],
      ],
      ["a still-encoded segment", ["originals", "a%2Fb"]],
      ["a bad prefix", ["secrets", "x.mp4"]],
      ["the prefix alone", ["originals"]],
      ["no segments", []],
      ["a space", ["originals", "a b.mp4"]],
      ["a backslash", ["originals", "a\\b.mp4"]],
      ["an absolute path", ["", "etc", "passwd"]],
    ])("%s", (_, segments) => {
      expect(parseDevStorageRequest("PUT", segments, q(part))).toBeNull();
      expect(parseDevStorageRequest("PUT", segments, q(single))).toBeNull();
      expect(parseDevStorageRequest("GET", segments, q(getQuery))).toBeNull();
    });

    it.each(["", "abc", "-1", "1.5", "1e9", " 1800000000", "1234567890123"])(
      "exp %j",
      (exp) => {
        expect(
          parseDevStorageRequest("PUT", SEGMENTS, q({ ...part, exp })),
        ).toBeNull();
        expect(
          parseDevStorageRequest("GET", SEGMENTS, q({ ...getQuery, exp })),
        ).toBeNull();
      },
    );

    it("a missing exp or sig", () => {
      expect(
        parseDevStorageRequest(
          "PUT",
          SEGMENTS,
          q({ uploadId: UPLOAD_ID, partNumber: "1", sig: SIG }),
        ),
      ).toBeNull();
      expect(
        parseDevStorageRequest(
          "PUT",
          SEGMENTS,
          q({ uploadId: UPLOAD_ID, partNumber: "1", exp: EXP }),
        ),
      ).toBeNull();
    });

    it.each([
      "",
      "a".repeat(63),
      "a".repeat(65),
      "A".repeat(64),
      `${"a".repeat(63)}g`,
      "z".repeat(64),
    ])("sig %j", (sig) => {
      expect(
        parseDevStorageRequest("PUT", SEGMENTS, q({ ...part, sig })),
      ).toBeNull();
      expect(
        parseDevStorageRequest("GET", SEGMENTS, q({ ...getQuery, sig })),
      ).toBeNull();
    });

    it.each([
      "",
      "abc",
      "ABCDEF01-2345-4678-9ABC-DEF012345678",
      UPLOAD_ID.replaceAll("-", ""),
      `${UPLOAD_ID}0`,
      "../44444444-4444-4444-8444-444444444444",
    ])("uploadId %j", (uploadId) => {
      expect(
        parseDevStorageRequest("PUT", SEGMENTS, q({ ...part, uploadId })),
      ).toBeNull();
    });

    it.each([
      "0",
      "10001",
      "99999",
      "100000",
      "01",
      "-1",
      "1.0",
      "",
      "two",
      " 1",
    ])("partNumber %j", (partNumber) => {
      expect(
        parseDevStorageRequest("PUT", SEGMENTS, q({ ...part, partNumber })),
      ).toBeNull();
    });

    it("a GET without cd, or with an empty one", () => {
      expect(
        parseDevStorageRequest("GET", SEGMENTS, q({ exp: EXP, sig: SIG })),
      ).toBeNull();
      expect(
        parseDevStorageRequest("GET", SEGMENTS, q({ ...getQuery, cd: "" })),
      ).toBeNull();
    });

    it("a cd or ct with a newline or a non-ASCII character", () => {
      for (const bad of ["a\nb", "a\r\nSet-Cookie: x", "café", "\t"]) {
        expect(
          parseDevStorageRequest("GET", SEGMENTS, q({ ...getQuery, cd: bad })),
        ).toBeNull();
        expect(
          parseDevStorageRequest("PUT", SEGMENTS, q({ ...single, ct: bad })),
        ).toBeNull();
      }
    });

    it("a cd over 1024 characters", () => {
      expect(
        parseDevStorageRequest(
          "GET",
          SEGMENTS,
          q({ ...getQuery, cd: "a".repeat(1025) }),
        ),
      ).toBeNull();
    });

    it("a single PUT without ct or len, or a len that is not digits", () => {
      const queries: Record<string, string>[] = [
        { len: "10", exp: EXP, sig: SIG },
        { ct: "video/mp4", exp: EXP, sig: SIG },
        { ...single, len: "-1" },
        { ...single, len: "1.5" },
        { ...single, len: "" },
        { ...single, len: "1234567890123" },
      ];
      for (const query of queries) {
        expect(parseDevStorageRequest("PUT", SEGMENTS, q(query))).toBeNull();
      }
    });

    it("mixing: another kind's params on a URL", () => {
      expect(
        parseDevStorageRequest(
          "PUT",
          SEGMENTS,
          q({ ...part, ct: "video/mp4" }),
        ),
      ).toBeNull();
      expect(
        parseDevStorageRequest("PUT", SEGMENTS, q({ ...single, cd: CD })),
      ).toBeNull();
      expect(
        parseDevStorageRequest(
          "GET",
          SEGMENTS,
          q({ ...getQuery, uploadId: UPLOAD_ID }),
        ),
      ).toBeNull();
      expect(
        parseDevStorageRequest("GET", SEGMENTS, q({ ...getQuery, len: "10" })),
      ).toBeNull();
    });

    it("mixing: a part PUT with only one of uploadId and partNumber", () => {
      expect(
        parseDevStorageRequest(
          "PUT",
          SEGMENTS,
          q({ uploadId: UPLOAD_ID, exp: EXP, sig: SIG }),
        ),
      ).toBeNull();
      expect(
        parseDevStorageRequest(
          "PUT",
          SEGMENTS,
          q({ partNumber: "1", exp: EXP, sig: SIG }),
        ),
      ).toBeNull();
      // Half a part request does not fall back to a single PUT.
      expect(
        parseDevStorageRequest(
          "PUT",
          SEGMENTS,
          q({ ...single, uploadId: UPLOAD_ID }),
        ),
      ).toBeNull();
      expect(
        parseDevStorageRequest(
          "PUT",
          SEGMENTS,
          q({ ...single, partNumber: "1" }),
        ),
      ).toBeNull();
    });
  });
});
