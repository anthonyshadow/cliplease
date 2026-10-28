// Public URLs: a creator and their videos (02 §4.3: /@handle is rewritten to /u/handle), and a buyer's request.
export const creatorUrl = (handle: string) => `/@${handle}`;
export const videoUrl = (handle: string, slug: string) => `/@${handle}/${slug}`;

/**
 * A buyer's request status page, `/r/{id}?t={token}` (02 §9.5), plus any `extra` query (`{ checkout: "canceled" }`).
 * Ids are uuids and tokens base64url, so nothing needs encoding: a value P25 passes stays as written (Stripe's
 * `{CHECKOUT_SESSION_ID}`). Never logged: the link opens the request.
 */
export const requestStatusPath = (
  requestId: string,
  token: string,
  extra: Readonly<Record<string, string>> = {},
) =>
  `/r/${requestId}?t=${token}${Object.entries(extra)
    .map(([key, value]) => `&${key}=${value}`)
    .join("")}`;
