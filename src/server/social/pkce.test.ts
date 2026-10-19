import { describe, expect, it } from "vitest";
import { createPkcePair, pkceChallenge } from "./pkce";

describe("PKCE (RFC 7636, S256)", () => {
  it("matches the RFC 7636 Appendix B vector", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("makes a 43-character base64url verifier with its challenge, new each time", () => {
    const a = createPkcePair();
    const b = createPkcePair();
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.challenge).toBe(pkceChallenge(a.verifier));
    expect(a.verifier).not.toBe(b.verifier);
  });
});
