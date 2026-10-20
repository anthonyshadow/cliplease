import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  type PosterTokenPayload,
  readPosterToken,
  signPosterToken,
} from "./poster-token";

const SUBKEY = Buffer.alloc(32, 5);
const OTHER_SUBKEY = Buffer.alloc(32, 6);
const NOW_S = 1_800_000_000;
const VIDEO_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_VIDEO_ID = "66666666-6666-4666-8666-666666666666";
const CREATOR_ID = "11111111-1111-4111-8111-111111111111";

const payload: PosterTokenPayload = {
  videoId: VIDEO_ID,
  creatorId: CREATOR_ID,
  key: `posters/${VIDEO_ID}/55555555-5555-4555-8555-555555555555.jpg`,
  size: 48_213,
  posterOrigin: "frame_capture",
  exp: NOW_S + 3900,
};

/** A token whose body is `json` (any shape), signed correctly under `subkey`. */
function signRaw(subkey: Buffer, json: unknown): string {
  const body = Buffer.from(JSON.stringify(json)).toString("base64url");
  const sig = createHmac("sha256", subkey)
    .update(`v1.${body}`)
    .digest("base64url");
  return `v1.${body}.${sig}`;
}

describe("signPosterToken / readPosterToken (owner answer Q-34 a)", () => {
  it("round-trips a valid token", () => {
    const token = signPosterToken(SUBKEY, payload);
    expect(token).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    expect(readPosterToken(SUBKEY, token, NOW_S)).toEqual(payload);
  });

  it("round-trips the creator_image origin", () => {
    const creatorImage = { ...payload, posterOrigin: "creator_image" as const };
    expect(
      readPosterToken(SUBKEY, signPosterToken(SUBKEY, creatorImage), NOW_S),
    ).toEqual(creatorImage);
  });

  it("is valid through its exp second, then expired", () => {
    const token = signPosterToken(SUBKEY, payload);
    expect(readPosterToken(SUBKEY, token, payload.exp)).toEqual(payload);
    expect(readPosterToken(SUBKEY, token, payload.exp + 1)).toBeNull();
  });

  it("refuses a token signed under another subkey", () => {
    const token = signPosterToken(OTHER_SUBKEY, payload);
    expect(readPosterToken(SUBKEY, token, NOW_S)).toBeNull();
  });

  it("refuses a tampered payload (another video) kept with the old signature", () => {
    const token = signPosterToken(SUBKEY, payload);
    const [, , sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...payload, videoId: OTHER_VIDEO_ID }),
    ).toString("base64url");
    expect(readPosterToken(SUBKEY, `v1.${forged}.${sig}`, NOW_S)).toBeNull();
  });

  it("refuses a tampered size and a tampered key", () => {
    const [, , sig] = signPosterToken(SUBKEY, payload).split(".");
    for (const changed of [
      { ...payload, size: payload.size + 1 },
      { ...payload, key: `posters/${OTHER_VIDEO_ID}/x.jpg` },
      { ...payload, exp: payload.exp + 86_400 },
    ]) {
      const body = Buffer.from(JSON.stringify(changed)).toString("base64url");
      expect(readPosterToken(SUBKEY, `v1.${body}.${sig}`, NOW_S)).toBeNull();
    }
  });

  it("refuses a tampered signature", () => {
    const token = signPosterToken(SUBKEY, payload);
    const [, body, sig = ""] = token.split(".");
    const bytes = Buffer.from(sig, "base64url");
    bytes[0] = (bytes[0] as number) ^ 0x01;
    expect(
      readPosterToken(
        SUBKEY,
        `v1.${body}.${bytes.toString("base64url")}`,
        NOW_S,
      ),
    ).toBeNull();
  });

  it.each([
    ["empty", ""],
    ["no version", "abc.def"],
    ["another version", (t: string) => t.replace(/^v1\./, "v2.")],
    ["missing signature", (t: string) => t.slice(0, t.lastIndexOf("."))],
    ["short signature", (t: string) => t.slice(0, -1)],
    ["long signature", (t: string) => `${t}A`],
    ["extra part", (t: string) => `${t}.x`],
    ["padding", (t: string) => `${t}=`],
    ["standard base64", (t: string) => t.replace(/^v1\./, "v1.+/")],
    ["whitespace", (t: string) => ` ${t}`],
  ])("refuses a wrong format: %s", (_, make) => {
    const token = signPosterToken(SUBKEY, payload);
    const bad = typeof make === "string" ? make : make(token);
    expect(readPosterToken(SUBKEY, bad, NOW_S)).toBeNull();
  });

  it("refuses a correctly signed body that is not JSON", () => {
    const body = Buffer.from("not json").toString("base64url");
    const sig = createHmac("sha256", SUBKEY)
      .update(`v1.${body}`)
      .digest("base64url");
    expect(readPosterToken(SUBKEY, `v1.${body}.${sig}`, NOW_S)).toBeNull();
  });

  it.each([
    ["videoId not a uuid", { ...payload, videoId: "video-1" }],
    ["creatorId missing", { ...payload, creatorId: undefined }],
    ["size zero", { ...payload, size: 0 }],
    ["size fractional", { ...payload, size: 1.5 }],
    ["size as a string", { ...payload, size: "48213" }],
    ["unknown origin", { ...payload, posterOrigin: "platform_copy" }],
    ["exp as a string", { ...payload, exp: String(payload.exp) }],
    ["an extra field", { ...payload, admin: true }],
    ["an array", [payload]],
    ["null", null],
  ])("refuses a correctly signed payload failing the schema: %s", (_, json) => {
    expect(readPosterToken(SUBKEY, signRaw(SUBKEY, json), NOW_S)).toBeNull();
  });

  it("accepts a payload signed by hand the same way (the format is stable)", () => {
    expect(readPosterToken(SUBKEY, signRaw(SUBKEY, payload), NOW_S)).toEqual(
      payload,
    );
  });
});
