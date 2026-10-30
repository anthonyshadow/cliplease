import { describe, expect, it } from "vitest";
import { LICENSE_CODE_PATTERN } from "@/lib/licensing/snapshot";
import {
  generateLicenseCode,
  LICENSE_CODE_ALPHABET,
  normalizeLicenseCode,
} from "./license-code";

// 07 D101's goldens; LICENSE_CODE_PATTERN is the license_code_format CHECK's.

describe("normalizeLicenseCode (07 D101)", () => {
  it.each([
    ["cl7k3m9qxa", "CL-7K3M-9QXA"],
    ["CL-7K3M-9QXA ", "CL-7K3M-9QXA"],
    [" cl 7k3m 9qxa", "CL-7K3M-9QXA"],
    ["7K3M9QXA", "CL-7K3M-9QXA"],
    ["CL-IL0O-0000", "CL-1100-0000"],
    // 8 symbols: the leading "CL" is the code's own "C1", not the prefix.
    ["CLAB2345", "CL-C1AB-2345"],
  ])("%j → %s", (input, code) => {
    expect(normalizeLicenseCode(input)).toBe(code);
  });

  it.each([
    "CLR-7K3M-9QXA", // the old prefix
    "CL-7K3M-9QXU", // U isn't in the alphabet
    "CL-7K3M",
    "",
  ])("%j → null", (input) => {
    expect(normalizeLicenseCode(input)).toBeNull();
  });
});

describe("generateLicenseCode", () => {
  it("draws from the 32-symbol alphabet", () => {
    expect(new Set(LICENSE_CODE_ALPHABET).size).toBe(32);
  });

  it("1,000 codes match the CHECK's format and are fixed points of normalizeLicenseCode", () => {
    for (let i = 0; i < 1_000; i += 1) {
      const code = generateLicenseCode();
      expect(code).toMatch(LICENSE_CODE_PATTERN);
      expect(normalizeLicenseCode(code)).toBe(code);
    }
  });
});
