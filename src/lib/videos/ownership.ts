// The ownership label's words (01 §4.5, 04 §9.19; 07 D43, D70, D89). Pure and client-safe: VerifiedOwnerBadge renders
// them, and createVideoFromPost stores verifiedAs's result as the source posting's verified_username.
import { APP_NAME } from "../app-name";
import type {
  Ownership,
  PostingPlatform,
  SocialAccountStatus,
} from "../domain/values";
import { formatPostDate } from "../format";
import { tidyText } from "../text/tidy";

/**
 * How a linked account is named after "Verified · " (07 D43): "@{username}" (never "@@": a handle the platform gave
 * with its "@" keeps one), else the display name or YouTube channel title, else null. Tidied as text others read
 * (owner answer Q-43 a): buyers see it on the badge, the license and its PDF.
 */
export function verifiedUsernameDisplay(account: {
  username: string | null;
  displayName: string | null;
}): string | null {
  const handle = tidyText(tidyText(account.username ?? "").replace(/^@+/, ""));
  if (handle !== "") return `@${handle}`;
  const name = tidyText(account.displayName ?? "");
  return name === "" ? null : name;
}

/**
 * The name a linked account verifies a post under: verifiedUsernameDisplay's, while the account is connected. Null when
 * it isn't, or when the platform gave neither a handle nor a name (verified_username can't be empty): only a reconnect,
 * which reads the profile again, lets it verify. createVideoFromPost refuses such an account before any platform call,
 * and the Source page shows it the reconnect state.
 */
export function verifiedAs(account: {
  status: SocialAccountStatus;
  username: string | null;
  displayName: string | null;
}): string | null {
  return account.status === "connected"
    ? verifiedUsernameDisplay(account)
    : null;
}

/** The badge's fixed words and its explainer (04 §9.19, §11.2; 01 §4.5; 07 D43, D70). */
export const BADGE_COPY = {
  selfAttested: "Self-attested by the creator",
  explainerLink: "What does this mean?",
  /** The sheet's title (04 §11.2); 04 §9.19 names none for self-attested, which reuses it (owner answer Q-65 a). */
  sheetTitle: "What “Verified” means.",
  verifiedExplainer: `The creator connected the account that posted this video. This confirms who controls the account, not who filmed it. ${APP_NAME} didn't compare the delivered file with the post.`,
  selfAttestedExplainer: `The creator uploaded this file and confirmed they own the rights. ${APP_NAME} hasn't matched it to a linked social account.`,
  postingsExplainer: `Verified means the post is on an account the creator linked to ${APP_NAME}. Not verified means the creator added the link, but we couldn't confirm the account is theirs.`,
} as const;

type BadgeSize = "lg" | "sm";

/** A badge read from the video's primary verified posting (07 D70): the source posting, else the lowest-position one. */
export type VerifiedBadgeInput = {
  size: BadgeSize;
  ownership: Extract<Ownership, "verified_owner">;
  /** The posting's platform; `mock` reads as the demo account (07 D43, 04 §8.2: never shown as a real platform). */
  provider: PostingPlatform;
  platformLabel: string;
  /** The posting's verified_username, in display form ("@maya.films" or a channel title); never given an "@" here. */
  verifiedUsername: string;
  /** The posting's verified_account_linked_at. */
  linkedAt: Date | string;
  /** The posting's account is disconnected (01 J2.15): lg's line 2 says so. */
  noLongerLinked: boolean;
};

/** No verified posting (07 D89): the badge names no platform, even when unverified postings exist. */
type SelfAttestedBadgeInput = {
  size: BadgeSize;
  ownership: Extract<Ownership, "self_attested">;
};

export type BadgeInput = VerifiedBadgeInput | SelfAttestedBadgeInput;

/** The badge's two lines; `line2` is lg's "Account linked …" line, null for sm and self-attested. */
type BadgeText = { line1: string; line2: string | null };

/**
 * The words of every 04 §9.19 variant. lg: "Verified · @maya.films on Instagram" / "Account linked 12 Oct 2026" (+ " · no
 * longer linked"). sm: "Verified · @maya.films · Instagram", one line. A channel without a handle reads "Verified ·
 * {channel title} on YouTube" through the same template. Demo, at both sizes: "Verified · @demo.creator (demo account)",
 * lg keeping its line 2. Self-attested: "Self-attested by the creator". Line 3 ("Also verified on …") waits for the other
 * postings (P11b).
 */
export function badgeText(input: BadgeInput): BadgeText {
  if (input.ownership === "self_attested") {
    return { line1: BADGE_COPY.selfAttested, line2: null };
  }
  const { size, provider, platformLabel, verifiedUsername } = input;
  const verified = `Verified · ${verifiedUsername}`;
  let line1: string;
  if (provider === "mock") line1 = `${verified} (demo account)`;
  else if (size === "lg") line1 = `${verified} on ${platformLabel}`;
  else line1 = `${verified} · ${platformLabel}`;
  if (size === "sm") return { line1, line2: null };
  const linked = `Account linked ${formatPostDate(new Date(input.linkedAt))}`;
  return {
    line1,
    line2: input.noLongerLinked ? `${linked} · no longer linked` : linked,
  };
}

/**
 * The "What does this mean?" sheet's paragraphs (04 §9.19, 07 D70): verified (Demo included) adds the postings sentence
 * to D43's explainer; self-attested is 01 §4.5's line alone (P11b, which adds unverified postings, adds the sentence for
 * a video with one).
 */
export function badgeExplainer(ownership: Ownership): string[] {
  return ownership === "verified_owner"
    ? [BADGE_COPY.verifiedExplainer, BADGE_COPY.postingsExplainer]
    : [BADGE_COPY.selfAttestedExplainer];
}
