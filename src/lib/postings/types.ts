// A video's postings as DTOs (02 §5.12; 07 D70), client-safe: the owner's "Where was it posted?" step reads them as the
// server's listVideoPostings builds them, and buyers read a published video's as getPublicPostings builds them.
import type {
  PostingPlatform,
  PostingUnverifiedReason,
  PostingVerification,
  SocialAccountStatus,
  SocialPostVisibility,
} from "../domain/values";

/** One posting on the owner's "Where was it posted?" step (02 §5.12). */
export type OwnerPostingDTO = {
  id: string;
  platform: PostingPlatform;
  /** postingPlatformLabel: the platform's name, or the creator's name for an Other posting. */
  label: string;
  /** The stored canonical url (the owner always sees their own link); null for a posting with no link. */
  url: string | null;
  isSource: boolean;
  verification: PostingVerification;
  unverifiedReason: PostingUnverifiedReason | null;
  /** Verified rows only: 07 D43's display form, printed as stored. */
  verifiedUsername: string | null;
  /** Verified rows only: when its account was linked, as ISO (the badge's "Account linked {date}"). */
  verifiedAccountLinkedAt: string | null;
  /** The posting's account, when it has one: a verified row whose account is `disconnected` is "no longer linked". */
  accountStatus: SocialAccountStatus | null;
  /** Verified rows only: the post's image through the creator-only proxy (P11's postThumbnail, with its `?v=`). */
  thumbnailSrc: string | null;
  /** Verified rows only: the post's length where the platform gives one (07 D39's duration warning). */
  durationSec: number | null;
  /** Verified rows only: the post's visibility from its social_post row (P11c, additive: the D18 unlisted note). */
  visibility: SocialPostVisibility | null;
  /** Verified rows only: when the platform removed the post, as ISO (01 J3.9's banner, P14b); null while it is there. */
  removedAt: string | null;
  showLink: boolean;
  /** The last check, as ISO; null for a posting never checked (unverifiable, no link). */
  checkedAt: string | null;
  position: number;
};

/** One posting as buyers see it (02 §5.12, 07 D70): a handle only when verified, never an id or an image. */
export type PublicPostingDTO = {
  platform: PostingPlatform;
  label: string;
  verified: boolean;
  /** Verified only: an unverified posting never shows a handle. */
  verifiedUsername: string | null;
  /** Verified only: the account's connect time when it verified, as ISO ("Account linked {date}"). */
  linkedAt: string | null;
  /** Verified and its account is `disconnected` (OQ-14): "· no longer linked". */
  noLongerLinked: boolean;
  /**
   * The stored canonical url when the creator shows it (`show_link`) and the row is unverified or its post wasn't
   * removed; else null.
   */
  url: string | null;
  /** Other with a url: its hostname as text, without a leading "www." ("vimeo.com"). */
  hostLabel: string | null;
  /** Verified, and the platform removed its post (01 J3.9): "Original post no longer available" (owner answer Q-112 a). */
  removed: boolean;
  /**
   * The posting has a link, shown or not: a hidden one reads "{Platform} · Not verified" rather than "Also posted on
   * {Platform}" (owner answer Q-112 a). Never the link itself.
   */
  hasLink: boolean;
};

/** A published video's postings: verified first, then the creator's order, and the badge's primary posting (07 D70). */
export type PublicPostings = {
  primary: PublicPostingDTO | null;
  postings: PublicPostingDTO[];
};
