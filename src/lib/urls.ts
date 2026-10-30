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

/** Settings, at its payouts section: where every "Set up payouts" goes (07 D74, D77). */
export const PAYOUTS_SETTINGS_PATH = "/dashboard/settings#payouts";

/** A request's page in the creator's dashboard (S15). */
export const requestDetailPath = (requestId: string) =>
  `/dashboard/requests/${requestId}`;

/** A buyer's license page, `/l/{token}` (02 §9.5; P20): the request's buyer key opens it. Never logged. */
export const licensePath = (token: string) => `/l/${token}`;

/** A license's public record (02 §4.1; P20). */
export const verifyPath = (code: string) => `/verify/${code}`;
