"use server";

import { refresh } from "next/cache";
import { type ActionResult, fieldError, formError } from "@/lib/result";
import {
  type AdminDisableVideoInput,
  AdminDisableVideoSchema,
  AdminEnableVideoSchema,
} from "@/lib/validation/admin";
import { adminActor } from "@/server/auth/actor";
import { requireAdmin } from "@/server/auth/session";
import { redactErrors } from "@/server/rethrow-redacted";
import {
  type AdminDisableResult,
  adminSetVideoDisabled,
} from "@/server/videos/admin";
import { VideoNotFoundError } from "@/server/videos/errors";

// The admin's Disable and Enable (02 §6.1; 05 §7; owner answer Q-198 a). Disable's sweep calls the payments driver:
// /admin's page exports maxDuration = 60 (07 D26), since a "use server" file may export only async functions. Each
// parses its input, gates on requireAdmin (the role read fresh), runs one domain call as the admin, then refresh().

/**
 * The Disable sheet's fields as the form holds them (any reason, "" until one is chosen; `sweepOnly` is its Try again:
 * the sweep alone, never a second disable); the schema decides what is valid.
 */
export type AdminDisableVideoFields = Omit<AdminDisableVideoInput, "reason"> & {
  reason: string;
};

/**
 * Disable video (01 A.4): `{ stillOpen, capturing, disabled }`, the waiting requests the sweep couldn't decline yet,
 * the ones whose payment was already going through (owner answer Q-202), and whether the video is still disabled (the
 * sheet's Try again runs this again with `sweepOnly`). No reason is `reason`'s field error "Choose a reason."; an unknown
 * video is `not_found`.
 */
export async function adminDisableVideo(
  input: AdminDisableVideoFields,
): Promise<ActionResult<AdminDisableResult>> {
  return redactErrors("admin.disable_video_failed", async () => {
    const parsed = AdminDisableVideoSchema.safeParse(input);
    if (!parsed.success) {
      const noReason = parsed.error.issues.find(
        (issue) => issue.path[0] === "reason",
      );
      return noReason
        ? fieldError("invalid_input", "reason", noReason.message)
        : formError("invalid_input");
    }
    const user = await requireAdmin("/admin");
    try {
      const result = await adminSetVideoDisabled(adminActor(user), {
        disabled: true,
        ...parsed.data,
      });
      refresh();
      return { ok: true, data: result };
    } catch (error) {
      if (error instanceof VideoNotFoundError) return formError("not_found");
      throw error;
    }
  });
}

/** Enable video: back to Off (unpublished); a video that isn't disabled is left as it is. */
export async function adminEnableVideo(input: {
  videoId: string;
}): Promise<ActionResult> {
  return redactErrors("admin.enable_video_failed", async () => {
    const parsed = AdminEnableVideoSchema.safeParse(input);
    if (!parsed.success) return formError("invalid_input");
    const user = await requireAdmin("/admin");
    try {
      await adminSetVideoDisabled(adminActor(user), {
        disabled: false,
        ...parsed.data,
      });
      refresh();
      return { ok: true, data: undefined };
    } catch (error) {
      if (error instanceof VideoNotFoundError) return formError("not_found");
      throw error;
    }
  });
}
