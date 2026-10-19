import type { ReactNode } from "react";
import { PlatformMark } from "@/components/platform/platform-mark";
import { INLINE_LINK } from "@/components/ui/inline-link";
import { PLATFORM_LABELS } from "@/lib/brand";
import type { SocialProviderId } from "@/lib/domain/values";
import { ConnectLink } from "./connect-link";
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
 * 04 §9.17: one platform not linked yet: its mark or word, what it reads, and Connect (a full navigation to the start
 * route, ConnectLink). `primary` makes this Connect the page's one primary (05 §6.2). The Instagram view-counts checkbox
 * arrives with Instagram (P28).
 */
export function ConnectRow({
  platform,
  returnTo,
  primary = false,
  hasMark,
}: {
  platform: SocialProviderId;
  returnTo: string;
  primary?: boolean;
  /** The platform's official mark file is present (platformMarkFiles). */
  hasMark: boolean;
}) {
  const note = NOTES[platform];
  const label = PLATFORM_LABELS[platform];
  return (
    <div className="flex items-center gap-4 rounded-lg bg-surface p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex items-center gap-4 text-body font-semibold text-ink">
          <PlatformMark platform={platform} hasFile={hasMark} />
          {hasMark ? <span>{label}</span> : null}
        </p>
        {note ? <p className="text-footnote text-ink-2">{note}</p> : null}
      </div>
      <ConnectLink
        href={connectStartHref(platform, returnTo)}
        label="Connect"
        ariaLabel={`Connect ${label}`}
        variant={primary ? "primary" : "secondary"}
      />
    </div>
  );
}
