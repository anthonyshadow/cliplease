import { describe, expect, it } from "vitest";
import { APPROVAL_WINDOW_HOURS } from "../domain/values";
import { creatorSettingsSchema } from "./creator-settings";

describe("creatorSettingsSchema (02 §5.2, 07 D81)", () => {
  it.each(
    APPROVAL_WINDOW_HOURS.flatMap((hours) => [
      [hours, true],
      [hours, false],
    ]),
  )(
    "accepts %i hours with auto-approve %s",
    (approvalWindowHours, autoApprove) => {
      expect(
        creatorSettingsSchema.parse({ approvalWindowHours, autoApprove }),
      ).toEqual({ approvalWindowHours, autoApprove });
    },
  );

  it.each([
    ["36", 36],
    ["0", 0],
    ["NaN", Number.NaN],
    ['"48"', "48"],
    ["48.5", 48.5],
  ])("refuses a window of %s", (_label, approvalWindowHours) => {
    expect(
      creatorSettingsSchema.safeParse({
        approvalWindowHours,
        autoApprove: false,
      }).success,
    ).toBe(false);
  });

  it("refuses a missing autoApprove", () => {
    expect(
      creatorSettingsSchema.safeParse({ approvalWindowHours: 48 }).success,
    ).toBe(false);
  });
});
