import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { env } from "../env";

// AES-256-GCM for secrets at rest (02 §5.11, §9.4; research/infra.md §10). One key in CORE: rotation
// (a previous key, re-encryption) is [H7]. Relative imports: the P09 seed loads this file under tsx.

const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = "v1";

type TokenCipherErrorReason =
  | "bad_key"
  | "malformed"
  | "unknown_key"
  | "auth_failed";

/** Every failure: the message names the reason only, never the payload or the plaintext. */
export class TokenCipherError extends Error {
  constructor(readonly reason: TokenCipherErrorReason) {
    super(`token_cipher_${reason}`);
    this.name = "TokenCipherError";
  }
}

export type TokenCipher = {
  /** The first 8 hex of sha256(key): which key sealed a payload. */
  readonly kid: string;
  /** `v1.<kid>.<iv>.<tag>.<ciphertext>`, base64url parts; `aad` binds the payload to where it is stored. */
  encrypt(plaintext: string, aad: string): string;
  decrypt(payload: string, aad: string): string;
  /** A 32-byte key for one purpose, from HKDF-SHA256 with `info` (e.g. "oauth-state"). */
  deriveSubkey(info: string): Buffer;
};

/** A cipher for a base64 key that decodes to exactly 32 bytes. */
export function createTokenCipher(keyB64: string): TokenCipher {
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) throw new TokenCipherError("bad_key");
  const kid = createHash("sha256").update(key).digest("hex").slice(0, 8);

  return {
    kid,
    encrypt(plaintext, aad) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv, {
        authTagLength: TAG_BYTES,
      });
      cipher.setAAD(Buffer.from(aad, "utf8"));
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]);
      return [
        VERSION,
        kid,
        iv.toString("base64url"),
        cipher.getAuthTag().toString("base64url"),
        ciphertext.toString("base64url"),
      ].join(".");
    },
    decrypt(payload, aad) {
      const parts = payload.split(".");
      if (parts.length !== 5 || parts[0] !== VERSION) {
        throw new TokenCipherError("malformed");
      }
      const [, payloadKid, ivPart, tagPart, ciphertextPart] = parts as [
        string,
        string,
        string,
        string,
        string,
      ];
      if (payloadKid !== kid) throw new TokenCipherError("unknown_key");
      const iv = Buffer.from(ivPart, "base64url");
      const tag = Buffer.from(tagPart, "base64url");
      if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
        throw new TokenCipherError("malformed");
      }
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, iv, {
          authTagLength: TAG_BYTES,
        });
        decipher.setAAD(Buffer.from(aad, "utf8"));
        decipher.setAuthTag(tag);
        return Buffer.concat([
          decipher.update(Buffer.from(ciphertextPart, "base64url")),
          decipher.final(),
        ]).toString("utf8");
      } catch {
        // Node's own error can name the input; the wrong key, AAD or a changed byte all end here.
        throw new TokenCipherError("auth_failed");
      }
    },
    deriveSubkey(info) {
      return Buffer.from(hkdfSync("sha256", key, Buffer.alloc(0), info, 32));
    },
  };
}

let fromEnv: TokenCipher | undefined;
const envCipher = () => {
  fromEnv ??= createTokenCipher(env.TOKEN_ENCRYPTION_KEY);
  return fromEnv;
};

/** Seals `plaintext` with TOKEN_ENCRYPTION_KEY; `aad` names the column and row, e.g. "social_account.access_token:<id>". */
export function encryptSecret(plaintext: string, aad: string): string {
  return envCipher().encrypt(plaintext, aad);
}

/** Opens a payload sealed by encryptSecret with the same `aad`; throws TokenCipherError otherwise. */
export function decryptSecret(payload: string, aad: string): string {
  return envCipher().decrypt(payload, aad);
}

/** A 32-byte subkey of TOKEN_ENCRYPTION_KEY for one purpose ("oauth-state", later "local-storage-url", "poster-upload"). */
export function deriveSubkey(info: string): Buffer {
  return envCipher().deriveSubkey(info);
}
