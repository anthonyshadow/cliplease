import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../../db/client";
import type { PostingPlatform } from "../../lib/domain/values";
import { POSTING_LOOKUP_MAX_PAGES, verifyPostingLink } from "./verify";

// The steps that answer before any read (07 D68 steps 1 and 2). The rest needs the database and the mock provider:
// tests/integration/postings.test.ts.

const CREATOR = "0b6f3c1e-8d2a-4f5b-9c7e-1a2b3c4d5e6f";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("verifyPostingLink", () => {
  it.each<[PostingPlatform, string | null]>([
    ["facebook", "1234567890123"],
    ["x", "1790000000000000001"],
    ["snapchat", "W7_EDlXWTBiXAEEniNoMPwAAYYWx"],
    ["other", null],
    ["facebook", null],
  ])(
    "finds %s (key %s) unverifiable without reading anything",
    async (platform, linkKey) => {
      const select = vi.spyOn(db, "select");
      await expect(
        verifyPostingLink(CREATOR, { platform, linkKey, url: null }),
      ).resolves.toEqual({
        verification: "unverified",
        reason: "unverifiable",
      });
      expect(select).not.toHaveBeenCalled();
    },
  );

  it.each<PostingPlatform>(["instagram", "tiktok", "youtube", "mock"])(
    "finds a %s posting with no link no_link without reading anything",
    async (platform) => {
      const select = vi.spyOn(db, "select");
      await expect(
        verifyPostingLink(CREATOR, { platform, linkKey: null, url: null }),
      ).resolves.toEqual({ verification: "unverified", reason: "no_link" });
      expect(select).not.toHaveBeenCalled();
    },
  );

  it("lets Instagram's lookup scan 4 pages (07 §7.2)", () => {
    expect(POSTING_LOOKUP_MAX_PAGES).toBe(4);
  });
});
