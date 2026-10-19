import { PLATFORM_LABELS, PLATFORM_MARKS } from "@/lib/brand";
import type { SocialProviderId } from "@/lib/domain/values";
import { PlatformBadge } from "./platform-badge";

/**
 * 04 §8.2, §9.16: the platform's official mark when a human has added its file (`hasFile`, checked on the server by
 * platformMarkFiles), else its word. The Instagram glyph is one solid `ink` color through a mask, so the file is never
 * edited; the YouTube icon keeps its own colors. TikTok and Demo always show the word.
 */
export function PlatformMark({
  platform,
  hasFile,
}: {
  platform: SocialProviderId;
  hasFile: boolean;
}) {
  const mark = PLATFORM_MARKS[platform];
  if (!hasFile || mark.src === undefined) {
    return <PlatformBadge platform={platform} />;
  }
  const label = PLATFORM_LABELS[platform];
  if (mark.kind === "glyph") {
    return (
      <span
        role="img"
        aria-label={label}
        className="inline-block size-8 shrink-0 bg-ink"
        style={{ mask: `url(${mark.src}) center / contain no-repeat` }}
      />
    );
  }
  // biome-ignore lint/performance/noImgElement: a fixed local brand file, shown as the platform ships it.
  return <img src={mark.src} alt={label} className="h-6 w-auto shrink-0" />;
}
