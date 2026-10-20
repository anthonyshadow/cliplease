import type { NextRequest } from "next/server";
import { imageRouteResponse } from "@/server/social/image-route";

// The account avatar proxy (02 §6.2, §7.6, 07 D42): no session → 401 JSON; an id that isn't a uuid, another creator's
// account, a disconnected one or no image → 404; otherwise the image.

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/connections/avatars/[accountId]">,
) {
  const { accountId } = await ctx.params;
  return imageRouteResponse("avatar", accountId);
}
