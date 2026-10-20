import type { NextRequest } from "next/server";
import { posterResponse } from "@/server/videos/poster";

// The poster read (02 §4.2, §6.2): the owner or an admin gets the stored JPEG; everyone else, a bad id and a video with
// no poster get the same 404. `?v=` is accepted and ignored. P14a adds the public branch.

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/media/posters/[videoId]">,
) {
  const { videoId } = await ctx.params;
  return posterResponse(videoId);
}
