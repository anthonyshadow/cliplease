import { z } from "zod";
import { POSTER_ORIGINS } from "@/lib/domain/values";
import {
  ORIGINAL_MAX_BYTES,
  ORIGINAL_MIME,
  POSTER_MAX_BYTES,
  POSTER_MIME,
} from "@/lib/upload/limits";
import { toActor } from "@/server/auth/session";
import {
  uploadError,
  uploadOk,
  uploadRoute,
} from "@/server/storage/upload-http";
import { presignUpload } from "@/server/storage/uploads";

// POST /api/uploads/start (02 §6.2, 07 D80): opens an original's multipart upload (or `resume`s the open one), or signs a
// poster's PUT and returns its upload token (owner answer Q-34 a). The key is always made on the server.

const fileName = z
  .string()
  .min(1)
  .max(255)
  .refine((name) => !name.includes("\0"));

const startInput = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("original"),
    videoId: z.uuid(),
    fileName,
    size: z.int().min(1).max(ORIGINAL_MAX_BYTES),
    contentType: z.enum(ORIGINAL_MIME),
    resume: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal("poster"),
    videoId: z.uuid(),
    size: z.int().min(1).max(POSTER_MAX_BYTES),
    contentType: z.literal(POSTER_MIME),
    posterOrigin: z.enum(POSTER_ORIGINS),
  }),
]);

export async function POST(request: Request) {
  return uploadRoute(
    request,
    startInput,
    async (ctx, input) => {
      const result = await presignUpload(toActor(ctx), input);
      return result.ok ? uploadOk(result.upload) : uploadError(result.code);
    },
    (issue) => {
      if (issue.path[0] === "contentType") return "bad_type";
      if (issue.path[0] === "size" && issue.code === "too_big") {
        return "too_large";
      }
      return null;
    },
  );
}
