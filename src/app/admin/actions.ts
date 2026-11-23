"use server";

import { refresh } from "next/cache";
import type { ZodError } from "zod";
import {
  type ActionError,
  type ActionResult,
  fieldError,
  formError,
} from "@/lib/result";
import {
  type AdminDisableVideoInput,
  AdminDisableVideoSchema,
  AdminEnableVideoSchema,
  type AdminRetryMoneyMovementInput,
  AdminRetryMoneyMovementSchema,
  type AdminRevokeLicenseInput,
  AdminRevokeLicenseSchema,
} from "@/lib/validation/admin";
import { adminActor } from "@/server/auth/actor";
import { requireAdmin } from "@/server/auth/session";
import { LicenseNotFoundError, revokeLicense } from "@/server/licensing/issue";
import {
  MoneyMovementNotFoundError,
  type MoneyStepResult,
  retryMoneyMovement,
} from "@/server/licensing/money";
import { redactErrors } from "@/server/rethrow-redacted";
import {
  type AdminDisableResult,
  adminSetVideoDisabled,
} from "@/server/videos/admin";
import { VideoNotFoundError } from "@/server/videos/errors";

// The admin's Disable, Enable, Revoke and Retry (02 §6.1; 05 §7; owner answers Q-198 a, Q-207, Q-208). Disable's sweep
// and Retry call the payments driver: /admin's page exports maxDuration = 60 (07 D26), since a "use server" file may
// export only async functions; Revoke's refund runs after the response. Each parses its input, gates on requireAdmin
// (the role read fresh), runs one domain call as the admin, then refresh().

/** A sheet's refused input: the reason's own message under its field ("Choose a reason."), else the generic one. */
function reasonRefusal(error: ZodError): ActionError {
  const reason = error.issues.find((issue) => issue.path[0] === "reason");
  return reason
    ? fieldError("invalid_input", "reason", reason.message)
    : formError("invalid_input");
}

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
    if (!parsed.success) return reasonRefusal(parsed.error);
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

/** The Revoke sheet's fields as the form holds them (any reason, "" until one is chosen); the schema decides. */
export type AdminRevokeLicenseFields = Omit<
  AdminRevokeLicenseInput,
  "reason"
> & {
  reason: string;
};

/** How a Revoke ended, for the sheet to word (owner answer Q-207). */
export type AdminRevokeOutcome = {
  outcome: "revoked" | "already_revoked" | "transfer_in_progress";
};

/**
 * Revoke license (01 A.5; 07 D86): `revoked`; `already_revoked` when another admin revoked it first (nothing written,
 * their reason kept); `transfer_in_progress` when the creator transfer is in flight (nothing written, owner answer
 * Q-207), which the sheet words with the creator's handle. The refund and the take-back run after the response. No
 * reason is `reason`'s field error "Choose a reason."; an unknown license is `not_found`.
 */
export async function adminRevokeLicense(
  input: AdminRevokeLicenseFields,
): Promise<ActionResult<AdminRevokeOutcome>> {
  return redactErrors("admin.revoke_license_failed", async () => {
    const parsed = AdminRevokeLicenseSchema.safeParse(input);
    if (!parsed.success) return reasonRefusal(parsed.error);
    const user = await requireAdmin("/admin");
    const { licenseId, reason, note } = parsed.data;
    try {
      const result = await revokeLicense(
        adminActor(user),
        licenseId,
        reason,
        note,
      );
      if (!result.ok) return { ok: true, data: { outcome: result.reason } };
      refresh();
      return {
        ok: true,
        data: { outcome: result.changed ? "revoked" : "already_revoked" },
      };
    } catch (error) {
      if (error instanceof LicenseNotFoundError) return formError("not_found");
      throw error;
    }
  });
}

/**
 * Retry a money movement (01 A.8; 07 D75, D86; owner answer Q-208): how the new attempt ended, for the sheet to word:
 * succeeded or noop (done, or nothing left to do), failed with its code, transient, or in_progress. An unknown
 * movement is `not_found`.
 */
export async function adminRetryMoneyMovement(
  input: AdminRetryMoneyMovementInput,
): Promise<ActionResult<MoneyStepResult>> {
  return redactErrors("admin.retry_money_movement_failed", async () => {
    const parsed = AdminRetryMoneyMovementSchema.safeParse(input);
    if (!parsed.success) return formError("invalid_input");
    const user = await requireAdmin("/admin");
    try {
      const result = await retryMoneyMovement(
        adminActor(user),
        parsed.data.movementId,
      );
      refresh();
      return { ok: true, data: result };
    } catch (error) {
      if (error instanceof MoneyMovementNotFoundError) {
        return formError("not_found");
      }
      throw error;
    }
  });
}
