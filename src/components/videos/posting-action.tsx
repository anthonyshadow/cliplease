"use client";

import { ConnectLink } from "@/components/connections/connect-link";
import { connectStartHref } from "@/components/connections/connect-messages";
import { Button } from "@/components/ui/button";
import { isOneOf, SOCIAL_PROVIDERS } from "@/lib/domain/values";
import {
  type PostingResultAction,
  postingActionLabel,
} from "@/lib/postings/copy";
import type { OwnerPostingDTO } from "@/lib/postings/types";
import { videoStepHref } from "@/lib/videos/steps";

/**
 * A saved row's one action (04 §9.33, 05 callout 27/33), a `link` Button (44 px through hit-44): **Sync and check
 * again** and **Check again** call back (`onCheck`, sync first for the former); **Link {Platform}** and **Reconnect
 * {Platform}** are P08's Connect link, a full navigation to the start route that comes back to this step (07 D37:
 * `/api/connect/<provider>/start?returnTo=%2Fdashboard%2Fvideos%2F<id>%3Fstep%3Dpostings`), never prefetched. Only a
 * provider has a connect route, so the link actions render nothing on any other platform.
 */
export function PostingAction({
  action,
  posting,
  videoId,
  onCheck,
}: {
  action: PostingResultAction;
  posting: Pick<OwnerPostingDTO, "platform" | "label">;
  videoId: string;
  onCheck: (sync: boolean) => void;
}) {
  const label = postingActionLabel(action, posting.label);
  if (action === "link_account" || action === "reconnect") {
    if (!isOneOf(SOCIAL_PROVIDERS, posting.platform)) return null;
    return (
      <span data-row-action className="contents">
        <ConnectLink
          href={connectStartHref(
            posting.platform,
            videoStepHref(videoId, "postings"),
          )}
          label={label}
          variant="link"
        />
      </span>
    );
  }
  return (
    <Button
      variant="link"
      size="sm"
      data-row-action
      onClick={() => onCheck(action === "sync_and_check")}
    >
      {label}
    </Button>
  );
}
