import type { ReactNode } from "react";
import { PlatformBadge } from "@/components/platform/platform-badge";
import { Button } from "@/components/ui/button";
import { INLINE_LINK } from "@/components/ui/inline-link";
import { PLATFORM_LABELS } from "@/lib/brand";
import type { SocialProviderId } from "@/lib/domain/values";
import { connectStartHref } from "./connect-messages";

/** What each platform reads (04 §11.7, 01 J2.1); the Demo row has no note. */
const NOTES: Partial<Record<SocialProviderId, ReactNode>> = {
  instagram: "Works with Creator and Business accounts.",
  tiktok: "Shows your public videos.",
  youtube: (
    <>
      By connecting YouTube, you agree to the{" "}
      <a
        href="https://www.youtube.com/t/terms"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="YouTube Terms of Service (opens in a new tab)"
        className={INLINE_LINK}
      >
        YouTube Terms of Service
      </a>
      .
    </>
  ),
};

/**
 * 04 §9.17: one platform not linked yet. Connect is a plain link styled as a button: a full navigation to the start
 * route, never prefetched (a prefetch would start a connect). The Instagram view-counts checkbox arrives with Instagram
 * (P28), PlatformMark with P08.
 */
export function ConnectRow({
  platform,
  returnTo,
}: {
  platform: SocialProviderId;
  returnTo: string;
}) {
  const note = NOTES[platform];
  return (
    <div className="flex items-center gap-4 rounded-lg bg-surface p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-body font-semibold text-ink">
          <PlatformBadge platform={platform} />
        </p>
        {note ? <p className="text-footnote text-ink-2">{note}</p> : null}
      </div>
      <Button asChild variant="secondary" size="sm">
        <a
          href={connectStartHref(platform, returnTo)}
          aria-label={`Connect ${PLATFORM_LABELS[platform]}`}
        >
          Connect
        </a>
      </Button>
    </div>
  );
}
