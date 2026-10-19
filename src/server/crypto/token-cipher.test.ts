import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createTokenCipher, TokenCipherError } from "./token-cipher";

const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 9).toString("base64");
const AAD = "social_account.access_token:00000000-0000-4000-8000-000000000001";
const SECRET = "mock_access_c4180ab2_0123456789abcdef";

/** `payload` with one byte of part `index` (0-based among the five) flipped. */
function flipByte(payload: string, index: number): string {
  const parts = payload.split(".");
  const bytes = Buffer.from(parts[index] as string, "base64url");
  bytes[0] = (bytes[0] as number) ^ 0x01;
  parts[index] = bytes.toString("base64url");
  return parts.join(".");
}

function reasonOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(TokenCipherError);
    return (error as TokenCipherError).reason;
  }
}

describe("createTokenCipher (02 §5.11, §9.4)", () => {
  const cipher = createTokenCipher(KEY);

  it("round-trips with the same AAD", () => {
    expect(cipher.decrypt(cipher.encrypt(SECRET, AAD), AAD)).toBe(SECRET);
  });

  it("refuses a wrong AAD, a changed ciphertext byte and a changed tag byte", () => {
    const payload = cipher.encrypt(SECRET, AAD);
    expect(reasonOf(() => cipher.decrypt(payload, `${AAD}x`))).toBe(
      "auth_failed",
    );
    expect(reasonOf(() => cipher.decrypt(flipByte(payload, 4), AAD))).toBe(
      "auth_failed",
    );
    expect(reasonOf(() => cipher.decrypt(flipByte(payload, 3), AAD))).toBe(
      "auth_failed",
    );
  });

  it.each([31, 33, 0])("refuses a %i-byte key at creation", (bytes) => {
    expect(
      reasonOf(() =>
        createTokenCipher(Buffer.alloc(bytes, 1).toString("base64")),
      ),
    ).toBe("bad_key");
  });

  it("uses a new IV each time, and names the key in the payload", () => {
    const a = cipher.encrypt(SECRET, AAD);
    const b = cipher.encrypt(SECRET, AAD);
    expect(a).not.toBe(b);
    const kid = createHash("sha256")
      .update(Buffer.from(KEY, "base64"))
      .digest("hex")
      .slice(0, 8);
    expect(cipher.kid).toBe(kid);
    expect(a.startsWith(`v1.${kid}.`)).toBe(true);
    expect(a.split(".")).toHaveLength(5);
  });

  it("refuses another key's payload and malformed input", () => {
    const other = createTokenCipher(OTHER_KEY);
    expect(
      reasonOf(() => cipher.decrypt(other.encrypt(SECRET, AAD), AAD)),
    ).toBe("unknown_key");
    for (const bad of ["", "v1", "v2.a.b.c.d", "v1.a.b.c", "v1.a.b.c.d.e"]) {
      expect(reasonOf(() => cipher.decrypt(bad, AAD))).toBe("malformed");
    }
    const payload = cipher.encrypt(SECRET, AAD);
    const parts = payload.split(".");
    parts[2] = "AAAA";
    expect(reasonOf(() => cipher.decrypt(parts.join("."), AAD))).toBe(
      "malformed",
    );
  });

  it("never puts the payload or the plaintext in an error message", () => {
    const payload = cipher.encrypt(SECRET, AAD);
    for (const attempt of [
      () => cipher.decrypt(payload, "wrong"),
      () => cipher.decrypt(flipByte(payload, 4), AAD),
      () => createTokenCipher(OTHER_KEY).decrypt(payload, AAD),
    ]) {
      try {
        attempt();
      } catch (error) {
        const message = (error as Error).message;
        expect(message).not.toContain(payload);
        expect(message).not.toContain(SECRET);
        expect(message).toMatch(/^token_cipher_[a-z_]+$/);
      }
    }
  });

  it("derives distinct, stable 32-byte subkeys per purpose", () => {
    const state = cipher.deriveSubkey("oauth-state");
    const storage = cipher.deriveSubkey("local-storage-url");
    expect(state).toHaveLength(32);
    expect(storage).toHaveLength(32);
    expect(state.equals(cipher.deriveSubkey("oauth-state"))).toBe(true);
    expect(state.equals(storage)).toBe(false);
    expect(state.equals(Buffer.from(KEY, "base64"))).toBe(false);
  });
});
