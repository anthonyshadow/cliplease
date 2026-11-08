// Public URLs: a creator and their videos (02 §4.3: /@handle is rewritten to /u/handle), a buyer's request and licenses.
import type { DownloadKind } from "./domain/values";
import { DOWNLOAD_FAILED } from "./licensing/download-copy";

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

/** /l's two downloads, `/api/licenses/{token}/original|pdf` (02 §4.2; P20). Plain links only (Q-185). Never logged. */
export const licenseDownloadPath = (token: string, kind: DownloadKind) =>
  `/api/licenses/${token}/${kind}`;

/** My licenses, a signed-in buyer's list (02 §4.2; P20b). */
export const myLicensesPath = "/licenses";

/** A license in My licenses, by its id (P20b). */
export const myLicensePath = (licenseId: string) =>
  `${myLicensesPath}/${licenseId}`;

/** The session's two downloads, `/api/my/licenses/{id}/original|pdf` (02 §4.2; P20b). */
export const myLicenseDownloadPath = (licenseId: string, kind: DownloadKind) =>
  `/api/my/licenses/${licenseId}/${kind}`;

/** `/licenses/{id}?download=failed`: where a session download goes when it fails unexpectedly (Q-185 on My licenses). */
export const myLicenseDownloadFailedPath = (licenseId: string) =>
  `${myLicensePath(licenseId)}?${DOWNLOAD_FAILED.param}=${DOWNLOAD_FAILED.value}`;

/** A license's public record (02 §4.1; P20). */
export const verifyPath = (code: string) => `/verify/${code}`;
