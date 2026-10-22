import { describe, expect, it } from "vitest";
import { pgError, wrapped } from "../../../tests/helpers/pg-errors";
import { isVerifiedPostingConflict } from "./ownership";

// uniqueViolationConstraint's reading of an error (SQLSTATE, a missing constraint, plain errors) is db-errors.test.ts's.
const lost = pgError("23505", "video_posting_verified_uidx");

describe("isVerifiedPostingConflict", () => {
  it("spots a lost video_posting_verified_uidx, bare or wrapped by Drizzle", () => {
    expect(isVerifiedPostingConflict(lost)).toBe(true);
    expect(isVerifiedPostingConflict(wrapped(lost))).toBe(true);
  });

  it.each([
    ["another unique index", pgError("23505", "video_posting_video_link_uidx")],
    ["the source index", pgError("23505", "video_posting_source_uidx")],
    [
      "another SQLSTATE on that name",
      pgError("23503", "video_posting_verified_uidx"),
    ],
  ])("is false for %s", (_, error) => {
    expect(isVerifiedPostingConflict(error)).toBe(false);
  });
});
