import type { NextRequest } from "next/server";
import { imageRouteResponse } from "@/server/social/image-route";

// The Library thumbnail proxy (02 §6.2, §7.6, 07 D42): no session → 401 JSON; an id that isn't a uuid, another
// creator's post, a stale one or no image → 404; otherwise the image. It never calls a platform.

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/library/thumbnails/[postId]">,
) {
  const { postId } = await ctx.params;
  return imageRouteResponse("thumbnail", postId);
}
