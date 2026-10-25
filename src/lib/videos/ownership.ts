// The ownership label's words (01 §4.5, 04 §9.19; 07 D43, D70, D89). Pure and client-safe: VerifiedOwnerBadge renders
// them, and createVideoFromPost stores verifiedAs's result as the source posting's verified_username.
import { APP_NAME } from "../app-name";
import type {
  Ownership,
  PostingPlatform,
  SocialAccountStatus,
} from "../domain/values";
import { formatPostDate, joinList } from "../format";
import type {
  OwnerPostingDTO,
  PublicPostingDTO,
  PublicPostings,
} from "../postings/types";
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
  /** The other verified postings' platform names, in posting order: lg's line 3 (04 §9.19). */
  alsoVerifiedOn?: readonly string[];
};

/** No verified posting (07 D89): the badge names no platform, even when unverified postings exist. */
type SelfAttestedBadgeInput = {
  size: BadgeSize;
  ownership: Extract<Ownership, "self_attested">;
  /** The video has an unverified posting: the explainer adds the D70 sentence (04 §9.19). */
  hasUnverifiedPosting?: boolean;
};

export type BadgeInput = VerifiedBadgeInput | SelfAttestedBadgeInput;

/**
 * The badge's lines; `line2` is lg's "Account linked …" line and `line3` its "Also verified on …", each null for sm and
 * self-attested.
 */
type BadgeText = { line1: string; line2: string | null; line3: string | null };

/** "TikTok" · "TikTok and YouTube" · "TikTok, YouTube and Demo": each platform once, in order (04 §9.19). */
const joinPlatforms = (names: readonly string[]) =>
  joinList([...new Set(names)], "and");

/**
 * The words of every 04 §9.19 variant. lg: "Verified · @maya.films on Instagram" / "Account linked 12 Oct 2026" (+ " · no
 * longer linked"). sm: "Verified · @maya.films · Instagram", one line. A channel without a handle reads "Verified ·
 * {channel title} on YouTube" through the same template. Demo, at both sizes: "Verified · @demo.creator (demo account)",
 * lg keeping its line 2. lg's line 3, "Also verified on TikTok and YouTube", when other postings are verified too.
 * Self-attested: "Self-attested by the creator". `showUnlinked` (the video page's sm, 05 §6.7 States): line 1 ends
 * " · no longer linked" when the posting's account is disconnected.
 */
export function badgeText(
  input: BadgeInput,
  { showUnlinked = false }: { showUnlinked?: boolean } = {},
): BadgeText {
  if (input.ownership === "self_attested") {
    return { line1: BADGE_COPY.selfAttested, line2: null, line3: null };
  }
  const { size, provider, platformLabel, verifiedUsername } = input;
  const verified = `Verified · ${verifiedUsername}`;
  let line1: string;
  if (provider === "mock") line1 = `${verified} (demo account)`;
  else if (size === "lg") line1 = `${verified} on ${platformLabel}`;
  else line1 = `${verified} · ${platformLabel}`;
  if (size === "sm") {
    const unlinked = showUnlinked && input.noLongerLinked;
    return {
      line1: unlinked ? `${line1} · no longer linked` : line1,
      line2: null,
      line3: null,
    };
  }
  const linked = `Account linked ${formatPostDate(new Date(input.linkedAt))}`;
  const also = input.alsoVerifiedOn ?? [];
  return {
    line1,
    line2: input.noLongerLinked ? `${linked} · no longer linked` : linked,
    line3: also.length > 0 ? `Also verified on ${joinPlatforms(also)}` : null,
  };
}

/**
 * The "What does this mean?" sheet's paragraphs (04 §9.19, 07 D70): verified (Demo included) adds the postings sentence
 * to D43's explainer; self-attested is 01 §4.5's line, with the postings sentence when the video has an unverified one.
 */
export function badgeExplainer(input: BadgeInput): string[] {
  if (input.ownership === "verified_owner") {
    return [BADGE_COPY.verifiedExplainer, BADGE_COPY.postingsExplainer];
  }
  return input.hasUnverifiedPosting
    ? [BADGE_COPY.selfAttestedExplainer, BADGE_COPY.postingsExplainer]
    : [BADGE_COPY.selfAttestedExplainer];
}

/** The primary verified posting (07 D70): the verified source posting, else the lowest-position verified one. */
export function primaryVerifiedPosting<
  T extends { isSource: boolean; verification: string; position: number },
>(postings: readonly T[]): T | null {
  const verified = postings
    .filter((p) => p.verification === "verified")
    .sort((x, y) => x.position - y.position);
  return verified.find((p) => p.isSource) ?? verified[0] ?? null;
}

/** What a badge is built from: the primary verified posting (07 D70), or none. */
type BadgeSource = {
  primary: Pick<
    PublicPostingDTO,
    "platform" | "label" | "verifiedUsername" | "linkedAt" | "noLongerLinked"
  > | null;
  /** The other verified postings' platform names, in posting order. */
  alsoVerifiedOn: readonly string[];
  hasUnverifiedPosting: boolean;
};

/** The badge for `size` (04 §9.19; 07 D70, D89): verified from the primary posting, else self-attested. */
function badgeFrom(source: BadgeSource, size: BadgeSize): BadgeInput {
  const { primary } = source;
  if (!primary?.verifiedUsername || !primary.linkedAt) {
    return {
      size,
      ownership: "self_attested",
      hasUnverifiedPosting: source.hasUnverifiedPosting,
    };
  }
  return {
    size,
    ownership: "verified_owner",
    provider: primary.platform,
    platformLabel: primary.label,
    verifiedUsername: primary.verifiedUsername,
    linkedAt: primary.linkedAt,
    noLongerLinked: primary.noLongerLinked,
    alsoVerifiedOn: source.alsoVerifiedOn,
  };
}

/**
 * The badge the owner's postings give (07 D70, D89): the Review's (a draft's postings have no public read) and the
 * creator's video cards'. The primary verified posting's, with the other verified platforms for line 3, else
 * self-attested, with the D70 sentence when a posting isn't verified.
 */
export function ownerBadge(
  postings: readonly Pick<
    OwnerPostingDTO,
    | "platform"
    | "label"
    | "isSource"
    | "verification"
    | "position"
    | "verifiedUsername"
    | "verifiedAccountLinkedAt"
    | "accountStatus"
  >[],
  size: BadgeSize,
): BadgeInput {
  const primary = primaryVerifiedPosting(postings);
  return badgeFrom(
    {
      primary: primary && {
        platform: primary.platform,
        label: primary.label,
        verifiedUsername: primary.verifiedUsername,
        linkedAt: primary.verifiedAccountLinkedAt,
        noLongerLinked: primary.accountStatus === "disconnected",
      },
      alsoVerifiedOn: postings
        .filter((p) => p !== primary && p.verification === "verified")
        .sort((x, y) => x.position - y.position)
        .map((p) => p.label),
      hasUnverifiedPosting: postings.some((p) => p.verification !== "verified"),
    },
    size,
  );
}

/**
 * The badge buyers see (07 D70, D89), from a published video's public read (getPublicPostings): the success view's,
 * the public grid's and the license page's (P15).
 */
export function publicBadge(
  { primary, postings }: PublicPostings,
  size: BadgeSize,
): BadgeInput {
  return badgeFrom(
    {
      primary,
      alsoVerifiedOn: postings
        .filter((p) => p !== primary && p.verified)
        .map((p) => p.label),
      hasUnverifiedPosting: postings.some((p) => !p.verified),
    },
    size,
  );
}
