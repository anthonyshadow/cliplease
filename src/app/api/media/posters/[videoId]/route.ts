import { posterResponse } from "@/server/videos/poster";

// The poster read (02 §4.2, §6.2): public once the video may be seen by anyone, else the owner or an admin; everyone
// else, a bad id and a video with no poster get the same 404 (posterResponse). `?v=` is accepted and ignored.

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/media/posters/[videoId]">,
) {
  const { videoId } = await ctx.params;
  return posterResponse(videoId);
}
