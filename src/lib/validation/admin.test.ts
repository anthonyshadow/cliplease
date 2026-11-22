import { describe, expect, it } from "vitest";
import { VIDEO_DISABLED_REASONS } from "../domain/values";
import {
  ADMIN_NOTE_MAX,
  AdminDisableVideoSchema,
  AdminEnableVideoSchema,
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
