"use client";

import { useEffect, useState } from "react";
import { publishVideo } from "@/app/(dashboard)/dashboard/videos/[id]/actions";
import { Button } from "@/components/ui/button";
import { PRIMARY_WIDTH } from "@/components/ui/primary-width";
import { toast } from "@/components/ui/toast";
import { usePendingAction } from "@/components/ui/use-pending-action";
import { BLOCKERS_HEADING_ID, REVIEW_COPY } from "@/lib/videos/review";

/**
 * Review's Publish (05 §6.5 callout 52): the primary, off while anything blocks (`blocked`, from the server's read).
 * "Publishing…" while it runs; the action's refresh() then renders the success view. Refused by a blocker that appeared
 * meanwhile, the refreshed Review lists it and the focus moves to its heading once it is there.
 */
export function PublishButton({
  videoId,
  blocked,
}: {
  videoId: string;
  blocked: boolean;
}) {
  const [publishing, run] = usePendingAction();
  const [refused, setRefused] = useState(false);
  useEffect(() => {
    if (refused && blocked) {
      document.getElementById(BLOCKERS_HEADING_ID)?.focus();
      setRefused(false);
    }
  }, [refused, blocked]);

  async function publish() {
    setRefused(false);
    const result = await run(() => publishVideo({ videoId }));
    if (result === null || result.ok) return;
    if (result.error.code === "publish_blocked") setRefused(true);
    else toast(result.error.message);
  }

  return (
    <Button
      disabled={blocked}
      loading={publishing}
      loadingLabel={REVIEW_COPY.publishing}
      className={PRIMARY_WIDTH}
      onClick={publish}
    >
      {REVIEW_COPY.publish}
    </Button>
  );
}
