// The buyer's "Where it was posted" rows (04 §9.34; 07 D70; owner answers Q-111 a, Q-112 a): what each posting row says
// and links to. Pure and client-safe; PostingList draws it on the license page, and P20 on /l, the PDF and /verify.
import type { PostingPlatform } from "../domain/values";
import type { PublicPostingDTO } from "./types";

export const BUYER_POSTINGS_COPY = {
  title: "Where it was posted",
  removed: "Original post no longer available",
  alsoPostedOn: "Also posted on",
} as const;

export type BuyerPostingLink = { href: string; text: string; label: string };

/**
 * `verified`: "{verified_username} on {Platform}" and the Verified pill. `named`: the platform's name, with the Not
 * verified pill unless it is an Other site (never verifiable). `also`: "Also posted on {Platform}", a posting with no link.
 */
export type BuyerPostingRow = {
  kind: "verified" | "named" | "also";
  /** Verified only: the account's name as stored, which carries its own "@" (07 D43). */
  handle: string | null;
  pill: "verified" | "not_verified" | null;
  link: BuyerPostingLink | null;
  /** A verified post the platform removed: "Original post no longer available" in place of the link. */
  removed: boolean;
};

/**
 * The row's link: "View post ↗" (YouTube: "View on YouTube ↗"; an Other site: its hostname, "vimeo.com ↗"). The name a
 * screen reader hears starts with the words on screen and says it opens a new tab (owner answer Q-111 a).
 */
export function buyerPostingLink(posting: {
  platform: PostingPlatform;
  label: string;
  url: string;
  hostLabel: string | null;
}): BuyerPostingLink {
  const { platform, label, url, hostLabel } = posting;
  // P27: the official YouTube icon joins this link as its own <a> (04 §8.2); words only until the brand files exist
  // (owner answer Q-18 a), as on the Source page.
  if (platform === "youtube") {
    return {
      href: url,
      text: "View on YouTube ↗",
      label: "View on YouTube (opens in a new tab)",
    };
  }
  if (platform === "other" && hostLabel) {
    return {
      href: url,
      text: `${hostLabel} ↗`,
      label: `${hostLabel} (opens in a new tab)`,
    };
  }
  return {
    href: url,
    text: "View post ↗",
    label: `View post on ${label} (opens in a new tab)`,
  };
}

/**
 * 04 §9.34's row variants. A verified row keeps its handle and pill even when its link is hidden or its post removed;
 * an unverified row never shows a handle; a hidden unverified link still reads "{Platform} · Not verified" (Q-112 a).
 */
export function buyerPostingRow(posting: PublicPostingDTO): BuyerPostingRow {
  const link = posting.url
    ? buyerPostingLink({ ...posting, url: posting.url })
    : null;
  if (posting.verified) {
    return {
      kind: "verified",
      handle: posting.verifiedUsername,
      pill: "verified",
      link,
      removed: posting.removed,
    };
  }
  if (!posting.hasLink) {
    return {
      kind: "also",
      handle: null,
      pill: null,
      link: null,
      removed: false,
    };
  }
  return {
    kind: "named",
    handle: null,
    pill: posting.platform === "other" ? null : "not_verified",
    link,
    removed: false,
  };
}
