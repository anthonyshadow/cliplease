// The connect round trip's messages (05 §6.2 States, 04 §11.7, 07 D37). Client-safe: no server imports.
import { APP_NAME, SUPPORT_EMAIL } from "@/lib/app-name";
import { PLATFORM_LABELS } from "@/lib/brand";
import {
  CONNECT_ERROR_CODES,
  type ConnectErrorCode,
  isOneOf,
  SOCIAL_PROVIDERS,
  type SocialAccountStatus,
  type SocialProviderId,
} from "@/lib/domain/values";
import { formatRelative } from "@/lib/format";

/** The line both connect pages show once, above the rows (04 §11.7, §9.17). */
export const CONNECT_PAGE_LINE = `Your profile and your videos. Read-only. ${APP_NAME} never posts.`;

/** One line per error code. The error redirect carries no platform name, so provider_error names none (owner Q2 a). */
export const CONNECT_ERROR_MESSAGES = {
  denied: "Nothing was linked.",
  state: "Finish in the same browser you started in. Try again.",
  missing_scope: `Allow access to your videos so ${APP_NAME} can show them.`,
  ig_personal: "Instagram needs a professional account. Switching is free.",
  ig_not_tester:
    "This Instagram account isn't a tester yet. Ask the owner to invite it.",
  no_channel:
    "This Google account has no YouTube channel. Try another account.",
  already_linked: `This account is already connected to another ${APP_NAME} account. If it's yours, contact ${SUPPORT_EMAIL}.`,
  provider_error: "Couldn't reach the platform. Try again.",
} as const satisfies Record<ConnectErrorCode, string>;

const first = (raw: string | string[] | undefined) =>
  Array.isArray(raw) ? raw[0] : raw;

/** A callback's ?error= when it is one of the eight codes (07 D04); any other value is ignored. */
export function connectErrorCode(
  raw: string | string[] | undefined,
): ConnectErrorCode | null {
  const code = first(raw);
  return code && isOneOf(CONNECT_ERROR_CODES, code) ? code : null;
}

/** The Banner for ?error=: info when the creator canceled, an error otherwise; nothing for any other value. */
export function connectErrorBanner(
  raw: string | string[] | undefined,
): { tone: "info" | "error"; message: string } | null {
  const code = connectErrorCode(raw);
  if (!code) return null;
  return {
    tone: code === "denied" ? "info" : "error",
    message: CONNECT_ERROR_MESSAGES[code],
  };
}

/** The toast for ?connected=<provider>; nothing for any other value. */
export function connectedToastMessage(
  raw: string | string[] | undefined,
): string | null {
  const platform = first(raw);
  if (!platform || !isOneOf(SOCIAL_PROVIDERS, platform)) return null;
  return `${PLATFORM_LABELS[platform]} connected. Showing your latest videos.`;
}

/** How the card names the account (04 §9.18, 07 D43): @username, else the display name or channel title, else the platform. */
export function accountName(a: {
  platform: SocialProviderId;
  username: string | null;
  displayName: string | null;
}): string {
  if (a.username) return `@${a.username}`;
  return a.displayName ?? PLATFORM_LABELS[a.platform];
}

const INSTAGRAM_ACCOUNT_TYPES: Record<string, string> = {
  Media_Creator: `${PLATFORM_LABELS.instagram} · Creator account`,
  Business: `${PLATFORM_LABELS.instagram} · Business account`,
};

/** The card's platform line (04 §9.18): "Instagram · Creator account", "YouTube channel", "Demo" (the mock says Media_Creator too). */
export function platformLine(a: {
  platform: SocialProviderId;
  accountType: string | null;
}): string {
  if (a.platform === "instagram") {
    return (
      INSTAGRAM_ACCOUNT_TYPES[a.accountType ?? ""] ?? PLATFORM_LABELS.instagram
    );
  }
  if (a.platform === "youtube") return "YouTube channel";
  return PLATFORM_LABELS[a.platform];
}

/** What row 3 of a card shows (04 §9.18, 05 §6.2 States), most urgent first. */
export type CardState =
  | { kind: "needs_reconnect" | "syncing" | "sync_problem" | "connected" }
  | { kind: "rate_limited"; minutes: number };

export function cardState(a: {
  status: SocialAccountStatus;
  syncing: boolean;
  blockedMinutes: number | null;
  syncProblem: boolean;
}): CardState {
  if (a.status === "needs_reconnect") return { kind: "needs_reconnect" };
  if (a.syncing) return { kind: "syncing" };
  if (a.blockedMinutes !== null) {
    return { kind: "rate_limited", minutes: a.blockedMinutes };
  }
  return { kind: a.syncProblem ? "sync_problem" : "connected" };
}

/** Row 3 of a card by state (04 §11.7, §11.8). */
export const reconnectMessage = (platform: SocialProviderId) =>
  `${PLATFORM_LABELS[platform]} signed you out. Reconnect to keep syncing.`;
export const SYNC_PROBLEM_MESSAGE = "Couldn't sync. Try again or reconnect.";
export const rateLimitMessage = (platform: SocialProviderId, minutes: number) =>
  `${PLATFORM_LABELS[platform]} asked us to slow down. Try again in ${minutes} min.`;

/** The cap note under the sync line (04 §11.8, 01 J3.11); `max` is SOCIAL_SYNC_MAX_POSTS, passed in from the server. */
export const capNote = (max: number) => `Showing your newest ${max} videos.`;

/** The Disconnect sheet (04 §11.7; owner answers Q-19, Q-20). */
export const disconnectTitle = (name: string) => `Disconnect ${name}?`;

/** "{n} live videos came from …", only when some did (05 §6.2 callout 12); one video reads "1 live video" (Q-20). */
export function liveVideosSentence(n: number, name: string): string | null {
  if (n <= 0) return null;
  const sold = "Licenses already sold don't change.";
  return n === 1
    ? `1 live video came from ${name}. It stays live and keeps its Verified label, marked "no longer linked". ${sold}`
    : `${n} live videos came from ${name}. They stay live and keep their Verified label, marked "no longer linked". ${sold}`;
}

export const INSTAGRAM_DISCONNECT_NOTE = `Also remove ${APP_NAME} in Instagram → Settings → Apps and websites.`;
export const GOOGLE_PERMISSIONS_URL =
  "https://myaccount.google.com/permissions";
export const disconnectedToast = (name: string) => `Disconnected ${name}.`;

/**
 * The sync status under an account (04 §11.8, §9.18): "Synced just now · 24 videos", "Synced 3 min ago · 1 video"
 * (owner answer Q-16 a). Null before the first sync has finished.
 */
export function syncLine(
  a: { lastSyncedAt: string | null; postCount: number },
  now: Date,
): string | null {
  if (a.lastSyncedAt === null) return null;
  const videos = `${a.postCount} ${a.postCount === 1 ? "video" : "videos"}`;
  return `${formatRelative(new Date(a.lastSyncedAt), now)} · ${videos}`;
}

/**
 * The start route for `platform`, coming back to `returnTo` (encoded once, by URLSearchParams); `switch` asks the
 * platform to let the creator pick another account (07 D41).
 */
export function connectStartHref(
  platform: SocialProviderId,
  returnTo: string,
  opts: { switch?: boolean } = {},
): string {
  const query = new URLSearchParams(opts.switch ? { switch: "1" } : {});
  query.set("returnTo", returnTo);
  return `/api/connect/${platform}/start?${query}`;
}
