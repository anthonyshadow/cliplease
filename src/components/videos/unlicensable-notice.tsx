import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { TURN_ON_AN_OPTION } from "@/lib/videos/review";
import { VIDEO_PAGE_COPY } from "@/lib/videos/video-page";

/**
 * In place of the share link of a live video no buyer can license (isUnlicensable): the line and the way to the prices,
 * on its page and its card (owner answer Q-137 a).
 */
export function UnlicensableNotice({ className }: { className?: string }) {
  return (
    <Notice
      className={className}
      action={
        <Button asChild variant="link" size="sm">
          <Link href={TURN_ON_AN_OPTION.href}>{TURN_ON_AN_OPTION.label}</Link>
        </Button>
      }
    >
      {VIDEO_PAGE_COPY.cantLicense}
    </Notice>
  );
}
