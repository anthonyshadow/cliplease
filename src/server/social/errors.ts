import "server-only";

// Provider errors (02 §5.3). Messages are fixed codes: never a token, a URL or a response body.

/** The platform no longer accepts the token: the account needs reconnecting. */
export class SocialAuthError extends Error {
  constructor(message = "auth_failed") {
    super(message);
    this.name = "SocialAuthError";
  }
}

/** A missing scope, an Instagram personal account, a non-tester, or a Google account with no YouTube channel. */
export class SocialPermissionError extends Error {
  constructor(message = "permission_denied") {
    super(message);
    this.name = "SocialPermissionError";
  }
}

export class SocialRateLimitError extends Error {
  constructor(readonly retryAfterSec: number) {
    super("rate_limited");
    this.name = "SocialRateLimitError";
  }
}

/** A 5xx, a network failure or an unexpected response, after any retries. */
export class SocialUpstreamError extends Error {
  constructor(message = "upstream_error") {
    super(message);
    this.name = "SocialUpstreamError";
  }
}

/** The platform account is live on another creator's profile (07 D37). */
export class AlreadyLinkedError extends Error {
  constructor() {
    super("already_linked");
    this.name = "AlreadyLinkedError";
  }
}
