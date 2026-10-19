import { PLATFORM_LABELS } from "@/lib/brand";
import type { SocialProviderId } from "@/lib/domain/values";

/** 04 §9.16: the platform's name, in the surrounding size and color. PlatformMark (the official glyphs) comes in P08. */
export function PlatformBadge({ platform }: { platform: SocialProviderId }) {
  return <span>{PLATFORM_LABELS[platform]}</span>;
}
