import { z } from "zod";
import { PART_URL_BATCH } from "@/lib/upload/limits";
import { toActor } from "@/server/auth/session";
import {
  uploadError,
  uploadOk,
  uploadRoute,
} from "@/server/storage/upload-http";
import { presignParts } from "@/server/storage/uploads";

// POST /api/uploads/parts (02 §6.2, 07 D80): UploadPart URLs for the video's open upload, at most PART_URL_BATCH a call.

const partsInput = z.strictObject({
  videoId: z.uuid(),
  uploadId: z.string().min(1).max(1024),
  partNumbers: z.array(z.int().positive()).min(1).max(PART_URL_BATCH),
});

export async function POST(request: Request) {
  return uploadRoute(
    request,
    partsInput,
    async (ctx, input) => {
      const result = await presignParts(toActor(ctx), input);
      return result.ok
        ? uploadOk({ urls: result.urls })
        : uploadError(result.code);
    },
    (issue) => {
      if (issue.path[0] !== "partNumbers") return null;
      return issue.path.length === 1 && issue.code === "too_big"
        ? "too_many"
        : "bad_part";
    },
  );
}
