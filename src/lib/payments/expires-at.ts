import {
  APPROVAL_WINDOW_HOURS,
  type ApprovalWindowHours,
} from "@/lib/domain/values";
import { DAY_MS, HOUR_MS } from "@/lib/time";

// When an authorized request stops waiting (07 D81, §7.2): the creator's approval window, cut short so a capture never
// races the end of the card hold. Pure; the Stripe driver (P25) re-exports the margin.

/** The approval deadline ends at least this long before the hold does (07 §2.3). */
export const HOLD_SAFETY_MARGIN_HOURS = 6;

/** A hold leaving less than this to approve is abandoned at once (03 T2, 07 D27). */
export const HOLD_TOO_SHORT_MS = 3_600_000;

/** The approval window a new creator starts with (07 §7.2), one of APPROVAL_WINDOW_HOURS. */
export const DEFAULT_APPROVAL_WINDOW_HOURS = 72 satisfies ApprovalWindowHours;

/** Stripe's usual hold when a charge doesn't say: 4 days 18 hours. */
const DEFAULT_HOLD_MS = 4 * DAY_MS + 18 * HOUR_MS;

/** min(authorizedAt + the window, (captureBefore ?? authorizedAt + 4 d 18 h) − 6 h). */
export function computeExpiresAt({
  authorizedAt,
  captureBefore,
  approvalWindowHours,
}: {
  authorizedAt: Date;
  captureBefore: Date | null;
  approvalWindowHours: ApprovalWindowHours;
}): Date {
  const auth = authorizedAt.getTime();
  const holdEnds = captureBefore?.getTime() ?? auth + DEFAULT_HOLD_MS;
  return new Date(
    Math.min(
      auth + approvalWindowHours * HOUR_MS,
      holdEnds - HOLD_SAFETY_MARGIN_HOURS * HOUR_MS,
    ),
  );
}

/** A stored window (a smallint) as one of the four; the CHECK license_request_approval_window rules out anything else. */
export function approvalWindowOf(hours: number): ApprovalWindowHours {
  const window = APPROVAL_WINDOW_HOURS.find((h) => h === hours);
  if (window === undefined) {
    throw new Error(`Unknown approval window: ${hours} h`);
  }
  return window;
}
