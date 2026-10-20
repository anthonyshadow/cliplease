import "server-only";
import type { z } from "zod";
import type { UploadRouteCode } from "../../lib/upload/codes";
import type { CreatorContext } from "../auth/session";
import { getCreatorForApi } from "../auth/session";
import { NO_STORE, unauthorizedJson } from "../http";
import { errorName, logEvent } from "../log";

// The upload routes' shared HTTP layer (02 §6.2): a creator session first (else 401), a JSON body only, Zod, then the
// domain call; errors answer `{ code }` with the prompt's status, and nothing is cached. No route takes a key or an ETag
// from the client.

/** Every code an upload route answers with, and its status; a domain code missing here fails the typecheck. */
const STATUS = {
  invalid: 400,
  too_large: 400,
  bad_type: 400,
  too_many: 400,
  bad_part: 400,
  not_found: 404,
  original_locked: 409,
  not_same_file: 409,
  upload_expired: 410,
  size_mismatch: 422,
  parts_incomplete: 422,
  bad_signature_bytes: 422,
  internal: 500,
} as const satisfies Record<UploadRouteCode, number>;
export type UploadCode = keyof typeof STATUS;

export const uploadError = (code: UploadCode) =>
  Response.json({ code }, { status: STATUS[code], headers: NO_STORE });

export const uploadOk = (body: unknown) =>
  Response.json(body, { headers: NO_STORE });

export const uploadNoContent = () =>
  new Response(null, { status: 204, headers: NO_STORE });

/** A Zod refusal as one of the routes' 400 codes; `codeOf` names the specific ones, anything else is `invalid`. */
type IssueCode = (issue: z.core.$ZodIssue) => UploadCode | null;

/**
 * Runs `handle` for a signed-in creator with the body parsed by `schema`. The media type must be application/json exactly
 * (so a cross-site form post can't reach it), and a body that isn't JSON is `invalid`.
 */
export async function uploadRoute<S extends z.ZodType>(
  request: Request,
  schema: S,
  handle: (ctx: CreatorContext, input: z.output<S>) => Promise<Response>,
  codeOf: IssueCode = () => null,
): Promise<Response> {
  const ctx = await getCreatorForApi();
  if (!ctx) return unauthorizedJson();
  const type = request.headers.get("content-type")?.split(";")[0]?.trim();
  if (type?.toLowerCase() !== "application/json") return uploadError("invalid");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return uploadError("invalid");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const codes = parsed.error.issues.map(codeOf);
    return uploadError(codes.find((c) => c !== null) ?? "invalid");
  }
  try {
    return await handle(ctx, parsed.data);
  } catch (error) {
    // Next's own handler would print the whole error, and a database error's message holds the bound key and upload id.
    logEvent("error", "uploads.route_failed", { error: errorName(error) });
    return uploadError("internal");
  }
}
