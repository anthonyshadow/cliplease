import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "../../db/client";
import { createVideoSchema } from "../../lib/validation/video";
import { writeAudit } from "../audit";
import { type Actor, requireCreatorActor } from "../auth/actor";
import { insertVideoWithUniqueSlug } from "./slug";

export class VideoInputError extends Error {
  constructor() {
    super("invalid_input");
    this.name = "VideoInputError";
  }
}

/**
 * The plain upload's first step (07 D39): a self-attested draft with no original yet and a unique slug from its title.
 * The title is tidied and checked again here (07 D23; owner answer Q-43 a). Audited by id only.
 */
export async function createVideoFromUpload(
  a: Actor,
  i: { title: string },
): Promise<{ videoId: string }> {
  const actor = requireCreatorActor(a);
  const parsed = createVideoSchema.safeParse(i);
  if (!parsed.success) throw new VideoInputError();
  const { title } = parsed.data;
  // The app picks the id: object keys are built from it (03 §3.6).
  const videoId = randomUUID();
  await db.transaction(async (tx) => {
    await insertVideoWithUniqueSlug(tx, {
      id: videoId,
      creatorId: actor.creatorId,
      title,
      source: "upload",
      ownership: "self_attested",
      status: "draft",
      originalStatus: "none",
    });
    await writeAudit(tx, actor, {
      action: "video.created",
      entityType: "video",
      entityId: videoId,
    });
  });
  return { videoId };
}
