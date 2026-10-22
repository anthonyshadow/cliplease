// The Demo provider's id formats (07 D36, D68), in one client-safe place: the mock provider issues and reads them, and the
// "Where was it posted?" parser reads a Demo post's link in the browser. An account suffix is the first 8 hex of
// sha256(user id), plus "_2" for the second account, or "shared" in the shared_account scenario; a post id is
// "mock_post_{suffix}_{nn}", and its link is https://example.com/mock/{post id}.

/** A Demo account suffix as a regex source, a non-capturing group: "c4180ab2", "c4180ab2_2" or "shared". */
export const MOCK_ACCOUNT_SUFFIX = "(?:[0-9a-f]{8}(?:_2)?|shared)";

/** A mock post's canonical URL, made from its id alone (07 D68): the sync's permalink, and the Demo chip's url. */
export const mockPermalink = (externalId: string) =>
  `https://example.com/mock/${externalId}`;
