// The unpaid hold (owner answers Q-170, Q-175, Q-176): how long an unpaid request keeps a video, what the payment page's
// clock shows, and when the buyer may extend it. The session's cap is checkout_expires_at
// (CHECKOUT_SESSION_TTL_MINUTES), not a second constant. Pure: the clock comes in as an argument.

export const CHECKOUT_HOLD_MINUTES = 10;
export const CHECKOUT_HOLD_EXTEND_WINDOW_SECONDS = 60;

type CheckoutHoldPhase = "held" | "ending" | "lapsed" | "ended";

/**
 * Where a hold stands at `now`: `ended` once the session window closed, `lapsed` with the clock at zero and the session
 * open, `ending` in the last minute, else `held`. It can be extended while `ending` or `lapsed`, until the hold has
 * reached the session's end. `secondsLeft` rounds up, so the clock reads 0:00 only once the hold is over.
 */
export function checkoutHoldPhase(
  { holdUntil, sessionEndsAt }: { holdUntil: Date; sessionEndsAt: Date },
  now: Date,
): { phase: CheckoutHoldPhase; secondsLeft: number; canExtend: boolean } {
  const secondsLeft = Math.max(
    0,
    Math.ceil((holdUntil.getTime() - now.getTime()) / 1000),
  );
  const phase: CheckoutHoldPhase =
    now >= sessionEndsAt
      ? "ended"
      : secondsLeft === 0
        ? "lapsed"
        : secondsLeft <= CHECKOUT_HOLD_EXTEND_WINDOW_SECONDS
          ? "ending"
          : "held";
  return {
    phase,
    secondsLeft,
    canExtend:
      (phase === "ending" || phase === "lapsed") && holdUntil < sessionEndsAt,
  };
}

/** A hold's times as ISO strings, with the server's now so the page can tick from a wrong device clock. */
export type CheckoutHoldTimes = {
  holdUntil: string;
  sessionEndsAt: string;
  now: string;
};

export type ExtendHoldResult =
  | ({ ok: true } & CheckoutHoldTimes)
  | ({ ok: false; reason: "too_early" | "at_limit" } & CheckoutHoldTimes)
  | {
      ok: false;
      reason: "not_pending" | "session_ended" | "video_unavailable" | "taken";
    };

export type HoldReleaseVia = "canceled" | "page_closed";
