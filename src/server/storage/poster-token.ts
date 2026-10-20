import "server-only";
import { z } from "zod";
import { POSTER_ORIGINS } from "../../lib/domain/values";
import { bytesEqual, hmacSha256 } from "../crypto/hmac";

// The poster's upload token (owner answer Q-34 a). `start` (kind poster) makes a new key but changes no row, so `complete`
// learns which key belongs to the video from this token: `v1.<payload>.<sig>`, base64url JSON plus HMAC-SHA256 under
// deriveSubkey("poster-upload"). It names the video, its creator, the key, the declared size and the poster's origin, and
// expires shortly after the PUT URL does.

const PosterTokenPayload = z.strictObject({
  videoId: z.uuid(),
  creatorId: z.uuid(),
  key: z.string(),
  size: z.int().positive(),
  posterOrigin: z.enum(POSTER_ORIGINS),
  exp: z.int().positive(),
});
export type PosterTokenPayload = z.infer<typeof PosterTokenPayload>;

/** The subkey's HKDF name (02 §5.11). */
export const POSTER_TOKEN_SUBKEY = "poster-upload";

const sign = (subkey: Buffer, body: string) => hmacSha256(subkey, `v1.${body}`);

export function signPosterToken(
  subkey: Buffer,
  payload: PosterTokenPayload,
): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `v1.${body}.${sign(subkey, body).toString("base64url")}`;
}

/** The token's payload when it is ours, untampered and not expired at `nowS`; null otherwise. */
export function readPosterToken(
  subkey: Buffer,
  token: string,
  nowS: number,
): PosterTokenPayload | null {
  const match = /^v1\.([A-Za-z0-9_-]{1,2048})\.([A-Za-z0-9_-]{43})$/.exec(
    token,
  );
  if (!match) return null;
  const [, body = "", sig = ""] = match;
  if (!bytesEqual(Buffer.from(sig, "base64url"), sign(subkey, body))) {
    return null;
  }
  try {
    const parsed = PosterTokenPayload.safeParse(
      JSON.parse(Buffer.from(body, "base64url").toString("utf8")),
    );
    return parsed.success && parsed.data.exp >= nowS ? parsed.data : null;
  } catch {
    return null;
  }
}
