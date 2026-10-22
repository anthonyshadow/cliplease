import { describe, expect, it } from "vitest";
import {
  AlreadyLicensableElsewhereError,
  AlreadyOnYourVideoError,
  InvalidPostingsError,
  NotPublicError,
  PostingsLockedError,
} from "./errors";

describe("the postings refusals", () => {
  it("have fixed codes as messages, never data", () => {
    expect(
      [
        new AlreadyLicensableElsewhereError(),
        new AlreadyOnYourVideoError(
          "He saw snow for the first time and lost it",
        ),
        new NotPublicError(),
        new PostingsLockedError(),
        new InvalidPostingsError("too_many"),
        new InvalidPostingsError("not_posted_library"),
      ].map((e) => [e.name, e.message]),
    ).toEqual([
      ["AlreadyLicensableElsewhereError", "already_licensable_elsewhere"],
      ["AlreadyOnYourVideoError", "already_on_your_video"],
      ["NotPublicError", "not_public"],
      ["PostingsLockedError", "postings_locked"],
      ["InvalidPostingsError", "too_many"],
      ["InvalidPostingsError", "not_posted_library"],
    ]);
  });

  it("carry the other video's title and the refusal code as fields", () => {
    expect(new AlreadyOnYourVideoError("Snow day").videoTitle).toBe("Snow day");
    expect(new InvalidPostingsError("not_posted_library").code).toBe(
      "not_posted_library",
    );
  });
});
