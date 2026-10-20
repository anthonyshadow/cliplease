import "server-only";
import { z } from "zod";
import { getCreatorForApi, toActor } from "../auth/session";
import { imageNotFound, streamPlatformImage } from "./thumbnails";

const imageIdSchema = z.uuid();

/**
 * The image proxies' routes (02 §6.2, §7.6, 07 D42): no creator session → 401 JSON; an id that isn't a uuid → 404;
 * otherwise streamPlatformImage (the creator's own account avatar or post thumbnail, else 404).
 */
export async function imageRouteResponse(
  kind: "avatar" | "thumbnail",
  id: string,
): Promise<Response> {
  const creator = await getCreatorForApi();
  if (!creator) {
    return Response.json(
      { error: { code: "unauthorized" } },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!imageIdSchema.safeParse(id).success) return imageNotFound();
  return streamPlatformImage(
    kind === "avatar" ? { kind, accountId: id } : { kind, postId: id },
    toActor(creator),
  );
}
