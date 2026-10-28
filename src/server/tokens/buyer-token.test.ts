import { describe, expect, it } from "vitest";
import { TokenCipherError } from "../crypto/token-cipher";
import {
  generateBuyerToken,
  hashBuyerToken,
  revealBuyerToken,
} from "./buyer-token";

const ID = "6f4c8d7e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const OTHER = "00000000-0000-4000-8000-000000000999";

describe("buyer tokens (02 §5.11; 07 D14)", () => {
  it("is 32 random bytes in base64url, a different one each time", () => {
    const a = generateBuyerToken(ID);
    const b = generateBuyerToken(ID);
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a.token, "base64url")).toHaveLength(32);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).not.toBe(b.hash);
  });

  it("stores sha256 in lowercase hex and a sealed v1 copy, never the key", () => {
    expect(hashBuyerToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    const { token, hash, enc } = generateBuyerToken(ID);
    expect(hash).toBe(hashBuyerToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(enc.startsWith("v1.")).toBe(true);
    expect(enc).not.toContain(token);
  });

  it("reveals the key for its own row only", () => {
    const { token, enc } = generateBuyerToken(ID);
    expect(revealBuyerToken({ id: ID, buyerTokenEnc: enc })).toBe(token);
    expect(() => revealBuyerToken({ id: OTHER, buyerTokenEnc: enc })).toThrow(
      TokenCipherError,
    );
  });
});
