import { videoStepHref } from "@/lib/videos/steps";
import type { CreatorVideoDTO } from "@/server/videos/queries";
import { RightsForm } from "./rights-form";
import { VideoStepFrame } from "./video-step-frame";

/**
 * Step 3 · Rights, `/dashboard/videos/<id>?step=rights` (05 §6.5): RightsForm in the shared step layout, back to Where
 * posted.
 */
export function RightsStep({ video }: { video: CreatorVideoDTO }) {
  return (
    <VideoStepFrame
      video={video}
      step="rights"
      backHref={videoStepHref(video.id, "postings")}
    >
      <RightsForm
        videoId={video.id}
        containsMusic={video.containsMusic}
        identifiablePeople={video.identifiablePeople}
        lock={video.rightsLock}
      />
    </VideoStepFrame>
  );
}
