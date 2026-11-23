import { describe, expect, it } from "vitest";
import {
  LICENSE_REVOKED_REASONS,
  VIDEO_DISABLED_REASONS,
} from "../domain/values";
import {
  ADMIN_NOTE_MAX,
  AdminDisableVideoSchema,
  AdminEnableVideoSchema,
  AdminRetryMoneyMovementSchema,
  AdminRevokeLicenseSchema,
} from "./admin";

const videoId = "00000000-0000-4000-8000-000000000002";

describe("AdminDisableVideoSchema (02 §6.1)", () => {
  it.each(VIDEO_DISABLED_REASONS)(
    "takes the reason %s with no note",
    (reason) => {
      expect(AdminDisableVideoSchema.parse({ videoId, reason })).toEqual({
        videoId,
        reason,
        sweepOnly: false,
      });
    },
  );

  it("trims the note, and an empty one is no note", () => {
    expect(
      AdminDisableVideoSchema.parse({
        videoId,
        reason: "other",
        note: "  ticket-4821 ",
      }).note,
    ).toBe("ticket-4821");
    for (const note of ["", "   "]) {
      expect(
        AdminDisableVideoSchema.parse({ videoId, reason: "other", note }),
      ).toEqual({ videoId, reason: "other", sweepOnly: false });
    }
  });

  it("takes sweepOnly, the sheet's Try again (owner answer Q-198 a), false unless sent", () => {
    expect(
      AdminDisableVideoSchema.parse({
        videoId,
        reason: "other",
        sweepOnly: true,
      }).sweepOnly,
    ).toBe(true);
    expect(
      AdminDisableVideoSchema.parse({ videoId, reason: "other" }).sweepOnly,
    ).toBe(false);
  });

  it("takes a note of 200 characters and refuses 201", () => {
    const at = (n: number) =>
      AdminDisableVideoSchema.safeParse({
        videoId,
        reason: "other",
        note: "x".repeat(n),
      }).success;
    expect(ADMIN_NOTE_MAX).toBe(200);
    expect(at(200)).toBe(true);
    expect(at(201)).toBe(false);
  });

  it.each([
    ["an unknown reason", { videoId, reason: "spam" }],
    ["no reason", { videoId }],
    ["an empty reason", { videoId, reason: "" }],
    ["a video id that isn't a uuid", { videoId: "v1", reason: "other" }],
    [
      "a sweepOnly that isn't a boolean",
      { videoId, reason: "other", sweepOnly: "yes" },
    ],
  ])("refuses %s", (_label, input) => {
    expect(AdminDisableVideoSchema.safeParse(input).success).toBe(false);
  });

  it('says "Choose a reason." when the reason is missing', () => {
    const result = AdminDisableVideoSchema.safeParse({ videoId, reason: "" });
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ["reason"],
        message: "Choose a reason.",
      }),
    ]);
  });
});

describe("AdminEnableVideoSchema (02 §6.1)", () => {
  it("takes a video id and drops anything else", () => {
    expect(AdminEnableVideoSchema.parse({ videoId, reason: "other" })).toEqual({
      videoId,
    });
  });

  it("refuses an id that isn't a uuid", () => {
    expect(AdminEnableVideoSchema.safeParse({ videoId: "v1" }).success).toBe(
      false,
    );
  });
});

const licenseId = "00000000-0000-4000-8000-000000000003";

describe("AdminRevokeLicenseSchema (02 §6.1; 05 §7 callout 10)", () => {
  it.each(LICENSE_REVOKED_REASONS)(
    "takes the reason %s with no note",
    (reason) => {
      expect(AdminRevokeLicenseSchema.parse({ licenseId, reason })).toEqual({
        licenseId,
        reason,
      });
    },
  );

  it("trims the note, and an empty one is no note", () => {
    expect(
      AdminRevokeLicenseSchema.parse({
        licenseId,
        reason: "rights_claim",
        note: "  claim-77 ",
      }).note,
    ).toBe("claim-77");
    for (const note of ["", "   "]) {
      expect(
        AdminRevokeLicenseSchema.parse({
          licenseId,
          reason: "rights_claim",
          note,
        }),
      ).toEqual({ licenseId, reason: "rights_claim" });
    }
  });

  it("takes a note of 200 characters and refuses 201", () => {
    const at = (n: number) =>
      AdminRevokeLicenseSchema.safeParse({
        licenseId,
        reason: "issued_in_error",
        note: "x".repeat(n),
      }).success;
    expect(at(200)).toBe(true);
    expect(at(201)).toBe(false);
  });

  it.each([
    ["an unknown reason", { licenseId, reason: "other" }],
    ["a video's reason", { licenseId, reason: "prohibited_content" }],
    ["no reason", { licenseId }],
    ["an empty reason", { licenseId, reason: "" }],
    [
      "a license id that isn't a uuid",
      { licenseId: "CL-7K3M-9QXA", reason: "rights_claim" },
    ],
    ["no license id", { reason: "rights_claim" }],
    ["a note that isn't text", { licenseId, reason: "rights_claim", note: 7 }],
  ])("refuses %s", (_label, input) => {
    expect(AdminRevokeLicenseSchema.safeParse(input).success).toBe(false);
  });

  it('says "Choose a reason." when the reason is missing or unknown', () => {
    for (const reason of ["", "other"]) {
      const result = AdminRevokeLicenseSchema.safeParse({ licenseId, reason });
      expect(result.error?.issues).toEqual([
        expect.objectContaining({
          path: ["reason"],
          message: "Choose a reason.",
        }),
      ]);
    }
  });
});

describe("AdminRetryMoneyMovementSchema (02 §6.1)", () => {
  const movementId = "00000000-0000-4000-8000-000000000004";

  it("takes a movement id and drops anything else", () => {
    expect(
      AdminRetryMoneyMovementSchema.parse({ movementId, kind: "buyer_refund" }),
    ).toEqual({ movementId });
  });

  it.each([["not-a-uuid"], [""], [42]])("refuses the id %j", (id) => {
    expect(
      AdminRetryMoneyMovementSchema.safeParse({ movementId: id }).success,
    ).toBe(false);
  });
});
