import { LinkIcon } from "lucide-react";
import {
  isOneOf,
  type PostingPlatform,
  VERIFIABLE_POSTING_PLATFORMS,
} from "@/lib/domain/values";
import { postingPlatformLabel } from "@/lib/postings/labels";

/**
 * 04 §9.16: the platform's name from `postingPlatformLabel` (07 D67), in the surrounding size and color; Other is the
 * creator's name for the site (`otherLabel`). Facebook, X, Snapchat and Other (the link-only platforms, 07 D70) are
 * preceded inline by a 16 px lucide Link. The four providers stay the bare word (PlatformMark draws the official marks;
 * posting rows never show the Instagram glyph, 04 §8.2). An Other name can be one unbroken 40-character word, so the
 * link variant shrinks and wraps anywhere instead of widening a 320 px card (07 D153).
 */
export function PlatformBadge({
  platform,
  otherLabel = null,
}: {
  platform: PostingPlatform;
  otherLabel?: string | null;
}) {
  const label = postingPlatformLabel(platform, otherLabel);
  if (isOneOf(VERIFIABLE_POSTING_PLATFORMS, platform)) {
    return <span>{label}</span>;
  }
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
      <LinkIcon aria-hidden size={16} className="shrink-0" />
      <span className="min-w-0 wrap-anywhere">{label}</span>
    </span>
  );
}
