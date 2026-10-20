import type { NextRequest } from "next/server";
import { env } from "@/server/env";
import { handleDevStorage } from "@/server/storage/dev-route";

// The local driver's signed object and part URLs (02 §6.2, 07 D80): development and test only. /api stays out of
// src/proxy.ts's matcher, which would buffer these bodies (and cut them at 10 MB).

async function handler(
  request: NextRequest,
  ctx: RouteContext<"/api/dev/storage/[...key]">,
) {
  return handleDevStorage(env, request, (await ctx.params).key);
}

export { handler as GET, handler as PUT };
