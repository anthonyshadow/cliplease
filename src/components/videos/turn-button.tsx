"use client";

import {
  publishVideo,
  unpublishVideo,
} from "@/app/(dashboard)/dashboard/videos/[id]/actions";
import { Button } from "@/components/ui/button";
import { PRIMARY_WIDTH } from "@/components/ui/primary-width";
import { toast } from "@/components/ui/toast";
import { usePendingAction } from "@/components/ui/use-pending-action";
import { VIDEO_PAGE_COPY } from "@/lib/videos/video-page";
import { useBlockersFocus } from "./use-blockers-focus";

/**
 * The video page's Turn off / Turn on (05 §6.7 callout 9; 01 J5.20): a secondary "Turn off" while live (no confirm: it
 * is reversible and waiting requests still work), a primary "Turn on" while off, off itself while a blocker stands
 * (`blocked`). One button element whose words change, so the focus stays on it when the refresh swaps them. The focus
 * moves to "Before you can publish" once the page lists it instead (useBlockersFocus): after a Turn on a blocker
 * refused, and after a Turn off that leaves Turn on blocked.
 */
export function TurnButton({
  videoId,
  live,
  blocked,
}: {
  videoId: string;
  live: boolean;
  blocked: boolean;
}) {
  const [turning, run] = usePendingAction();
  const awaitBlockers = useBlockersFocus(blocked, live);

  async function turn() {
    awaitBlockers(null);
    const result = await run(() =>
      live ? unpublishVideo({ videoId }) : publishVideo({ videoId }),
    );
    if (result === null) return;
    if (result.ok) awaitBlockers(live ? "turned_off" : null);
    else if (result.error.code === "publish_blocked") awaitBlockers("refused");
    else toast(result.error.message);
  }

  return (
    <Button
      variant={live ? "secondary" : "primary"}
      disabled={!live && blocked}
      loading={turning}
      loadingLabel={
        live ? VIDEO_PAGE_COPY.turningOff : VIDEO_PAGE_COPY.turningOn
      }
      className={live ? "self-start" : PRIMARY_WIDTH}
      onClick={turn}
    >
      {live ? VIDEO_PAGE_COPY.turnOff : VIDEO_PAGE_COPY.turnOn}
    </Button>
  );
}
