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

/** The Banner for ?error=: info when the creator canceled, an error otherwise; nothing for any other value. */
export function connectErrorBanner(
  raw: string | string[] | undefined,
): { tone: "info" | "error"; message: string } | null {
  const code = first(raw);
  if (!code || !isOneOf(CONNECT_ERROR_CODES, code)) return null;
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

/** 05 §1.5's account status labels (disconnected accounts aren't listed). */
const STATUS_LABELS = {
  connected: "Connected",
  needs_reconnect: "Needs reconnect",
  disconnected: "Disconnected",
} as const satisfies Record<SocialAccountStatus, string>;

/** "@demo.creator · Demo · Connected" (the display name when the platform gives no username). */
export function accountLine(a: {
  platform: SocialProviderId;
  username: string | null;
  displayName: string | null;
  status: SocialAccountStatus;
}): string {
  const name = a.username ? `@${a.username}` : (a.displayName ?? "");
  return `${name} · ${PLATFORM_LABELS[a.platform]} · ${STATUS_LABELS[a.status]}`;
}

/** The start route for `platform`, coming back to `returnTo` (encoded once, by URLSearchParams). */
export function connectStartHref(
  platform: SocialProviderId,
  returnTo: string,
): string {
  return `/api/connect/${platform}/start?${new URLSearchParams({ returnTo })}`;
}
