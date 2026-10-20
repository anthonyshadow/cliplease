import { z } from "zod";
import { toActor } from "@/server/auth/session";
import {
  uploadError,
  uploadOk,
  uploadRoute,
} from "@/server/storage/upload-http";
import { completeUpload } from "@/server/storage/uploads";

// POST /api/uploads/complete (02 §6.2, 07 D80): the server completes with its own part list, so the body carries no parts
// and no ETags (a strict schema refuses them). A poster comes back with its upload token (owner answer Q-34 a).

// Display-only hints (02 §9.10): a value that isn't a positive int4 is dropped, never a refusal.
const hint = z.int().min(1).max(2_147_483_647).nullable().catch(null);

const completeInput = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("original"),
    videoId: z.uuid(),
    meta: z
      .strictObject({ durationMs: hint, width: hint, height: hint })
      .optional(),
  }),
  z.strictObject({
    kind: z.literal("poster"),
    videoId: z.uuid(),
    uploadToken: z.string().min(1).max(4096),
  }),
]);

export async function POST(request: Request) {
  return uploadRoute(request, completeInput, async (ctx, input) => {
    const result = await completeUpload(toActor(ctx), input);
    return result.ok ? uploadOk({ ok: true }) : uploadError(result.code);
  });
}
