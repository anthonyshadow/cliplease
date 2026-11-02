import { musicSwitches } from "@/lib/videos/video-price";
import type { Actor } from "@/server/auth/actor";
import { getPublishBlockers } from "@/server/videos/publish";
import type { CreatorVideoDTO } from "@/server/videos/queries";
import { RightsForm } from "./rights-form";
import { VideoStepFrame } from "./video-step-frame";

/**
 * Step 3 · Rights, `/dashboard/videos/<id>?step=rights` (05 §6.5): RightsForm in the shared step layout, back to Where
 * posted; for a video past its draft (the video page's Rights _Edit_, P14b), back to its page. The music Switches are
 * read from the video's effective options (07 D82; owner answer Q-158).
 */
export async function RightsStep({
  actor,
  video,
}: {
  actor: Actor;
  video: CreatorVideoDTO;
}) {
  const { options } = await getPublishBlockers(actor, video.id);
  return (
    <VideoStepFrame video={video} step="rights">
      <RightsForm
        videoId={video.id}
        containsMusic={video.containsMusic}
        identifiablePeople={video.identifiablePeople}
        lock={video.rightsLock}
        musicUses={musicSwitches(options, video.containsMusic)}
      />
    </VideoStepFrame>
  );
}
