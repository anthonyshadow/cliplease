import "server-only";
import { isUuid } from "../../lib/validation/uuid";
import { getCreatorForApi, toActor } from "../auth/session";
import { notFoundNoStore, unauthorizedJson } from "../http";
import { streamPlatformImage } from "./thumbnails";

/**
 * The image proxies' routes (02 §6.2, §7.6, 07 D42): no creator session → 401 JSON; an id that isn't a uuid → 404;
 * otherwise streamPlatformImage (the creator's own account avatar or post thumbnail, else 404).
 */
export async function imageRouteResponse(
  kind: "avatar" | "thumbnail",
  id: string,
): Promise<Response> {
  const creator = await getCreatorForApi();
  if (!creator) return unauthorizedJson();
  if (!isUuid(id)) return notFoundNoStore();
  return streamPlatformImage(
    kind === "avatar" ? { kind, accountId: id } : { kind, postId: id },
    toActor(creator),
  );
}
