// A video's postings as the owner's "Where was it posted?" step reads them (02 §5.12; 07 D70), client-safe: the server's
// listVideoPostings builds them, and the step's pure helpers and client islands read them.
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
  /** The posting's account, when it has one: a verified row whose account is `disconnected` is "no longer linked". */
  accountStatus: SocialAccountStatus | null;
  /** Verified rows only: the post's image through the creator-only proxy (P11's postThumbnail, with its `?v=`). */
  thumbnailSrc: string | null;
  /** Verified rows only: the post's length where the platform gives one (07 D39's duration warning). */
  durationSec: number | null;
  /** Verified rows only: the post's visibility from its social_post row (P11c, additive: the D18 unlisted note). */
  visibility: SocialPostVisibility | null;
  showLink: boolean;
  /** The last check, as ISO; null for a posting never checked (unverifiable, no link). */
  checkedAt: string | null;
  position: number;
};
