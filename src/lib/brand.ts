// Platform names as the UI writes them (04 §9.16, 05 §1.5). Client-safe. The platform marks (PLATFORM_MARKS, P08) and
// P11b's posting labels build on this map.
import type { SocialProviderId } from "./domain/values";

export const PLATFORM_LABELS = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  mock: "Demo",
} as const satisfies Record<SocialProviderId, string>;
