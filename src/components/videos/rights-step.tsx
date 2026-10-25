import type { CreatorVideoDTO } from "@/server/videos/queries";
import { RightsForm } from "./rights-form";
import { VideoStepFrame } from "./video-step-frame";

/**
 * Step 3 · Rights, `/dashboard/videos/<id>?step=rights` (05 §6.5): RightsForm in the shared step layout, back to Where
 * posted; for a video past its draft (the video page's Rights _Edit_, P14b), back to its page.
 */
export function RightsStep({ video }: { video: CreatorVideoDTO }) {
  return (
    <VideoStepFrame video={video} step="rights">
      <RightsForm
        videoId={video.id}
        containsMusic={video.containsMusic}
        identifiablePeople={video.identifiablePeople}
        lock={video.rightsLock}
      />
    </VideoStepFrame>
  );
}
