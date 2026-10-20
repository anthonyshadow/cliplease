import { z } from "zod";
import { toActor } from "@/server/auth/session";
import {
  uploadError,
  uploadNoContent,
  uploadRoute,
} from "@/server/storage/upload-http";
import { abortUpload } from "@/server/storage/uploads";

// POST /api/uploads/abort (02 §6.2): Cancel on the File step (P10c). 204; again is a no-op.

const abortInput = z.strictObject({ videoId: z.uuid() });

export async function POST(request: Request) {
  return uploadRoute(request, abortInput, async (ctx, input) => {
    const result = await abortUpload(toActor(ctx), input);
    return result.ok ? uploadNoContent() : uploadError(result.code);
  });
}
