import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCreatorForApi, toActor } from "@/server/auth/session";
import { streamPlatformImage } from "@/server/social/thumbnails";

// The account avatar proxy (02 §6.2, §7.6, 07 D42): no session → 401 JSON; an id that isn't a uuid, another creator's
// account, a disconnected one or no image → 404; otherwise the image.

const accountIdSchema = z.uuid();

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/connections/avatars/[accountId]">,
) {
  const creator = await getCreatorForApi();
  if (!creator) {
    return Response.json(
      { error: { code: "unauthorized" } },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  const { accountId } = await ctx.params;
  if (!accountIdSchema.safeParse(accountId).success) {
    return new Response(null, { status: 404 });
  }
  return streamPlatformImage({ kind: "avatar", accountId }, toActor(creator));
}
