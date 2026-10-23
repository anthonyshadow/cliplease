import { describe, expect, it } from "vitest";
import {
  AlreadyLicensableElsewhereError,
  NotPublicError,
  PostingsLockedError,
} from "../postings/errors";
import {
  AlreadyLinkedError,
  SocialAuthError,
  SocialRateLimitError,
  SocialUpstreamError,
} from "../social/errors";
import {
  confirmSameVideoErrorCode,
  makeLicensableErrorCode,
  NeedsReconnectError,
  NotOnAccountError,
  NoVerifiedPostingError,
  OriginalNotReadyError,
  PostNotFoundError,
  VideoNotFoundError,
} from "./errors";

describe("makeLicensableErrorCode", () => {
  it.each([
    [new PostNotFoundError(), "not_found"],
    [new NeedsReconnectError(), "needs_reconnect"],
    [new NotOnAccountError(), "not_on_account"],
    [new NotPublicError(), "not_public"],
    [new AlreadyLicensableElsewhereError(), "already_licensable_elsewhere"],
    [new SocialUpstreamError(), "upstream"],
    [new SocialRateLimitError(900), "upstream"],
  ])("maps %o to %s", (error, code) => {
    expect(makeLicensableErrorCode(error)).toBe(code);
  });

  it.each([
    [
      "a refused token, which createVideoFromPost turns into NeedsReconnectError",
      new SocialAuthError(),
    ],
    ["another error", new AlreadyLinkedError()],
    ["a bug", new TypeError("x is undefined")],
    ["a confirmSameVideo refusal", new VideoNotFoundError()],
    ["a thrown string", "boom"],
  ])("leaves %s to the caller (null)", (_, error) => {
    expect(makeLicensableErrorCode(error)).toBeNull();
  });
});

describe("confirmSameVideoErrorCode", () => {
  it.each([
    [new VideoNotFoundError(), "not_found"],
    [new PostingsLockedError(), "postings_locked"],
    [new NoVerifiedPostingError(), "no_verified_posting"],
    [new OriginalNotReadyError(), "original_not_ready"],
  ])("maps %o to %s", (error, code) => {
    expect(confirmSameVideoErrorCode(error)).toBe(code);
  });

  it.each([
    new PostNotFoundError(),
    new SocialUpstreamError(),
    new Error("boom"),
    null,
  ])("leaves %o to the caller (null)", (error) => {
    expect(confirmSameVideoErrorCode(error)).toBeNull();
  });
});

describe("the refusals' messages", () => {
  it("are fixed codes, never data", () => {
    expect(
      [
        new PostNotFoundError(),
        new NeedsReconnectError(),
        new NotOnAccountError(),
        new NotPublicError(),
        new AlreadyLicensableElsewhereError(),
        new VideoNotFoundError(),
        new NoVerifiedPostingError(),
        new OriginalNotReadyError(),
      ].map((e) => [e.name, e.message]),
    ).toEqual([
      ["PostNotFoundError", "post_not_found"],
      ["NeedsReconnectError", "needs_reconnect"],
      ["NotOnAccountError", "not_on_account"],
      ["NotPublicError", "not_public"],
      ["AlreadyLicensableElsewhereError", "already_licensable_elsewhere"],
      ["VideoNotFoundError", "video_not_found"],
      ["NoVerifiedPostingError", "no_verified_posting"],
      ["OriginalNotReadyError", "original_not_ready"],
    ]);
  });
});
