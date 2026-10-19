// Platform names as the UI writes them (04 §9.16, 05 §1.5) and their official marks (04 §8.2). Client-safe. P11b's
// posting labels build on these maps.
import type { SocialProviderId } from "./domain/values";

export const PLATFORM_LABELS = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  mock: "Demo",
} as const satisfies Record<SocialProviderId, string>;

export type PlatformMarkSpec = {
  kind: "glyph" | "icon" | "none";
  /** Under public/: a file a human adds from the platform's official kit (04 §8.2); never drawn or downloaded by us. */
  src?: string;
  minPx: number;
};

/** 04 §8.2 verbatim. TikTok has no mark without written permission; Demo is never shown as a real platform. */
export const PLATFORM_MARKS: Readonly<
  Record<SocialProviderId, PlatformMarkSpec>
> = {
  instagram: { kind: "glyph", src: "/brand/instagram/glyph.svg", minPx: 29 },
  youtube: {
    kind: "icon",
    src: "/brand/youtube/icon-full-color.svg",
    minPx: 24,
  },
  tiktok: { kind: "none", minPx: 0 },
  mock: { kind: "none", minPx: 0 },
};
