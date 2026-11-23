import { and, eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { license, licenseRequest, moneyMovement } from "../../src/db/schema";
import type { LicenseRequest } from "../../src/db/schema/types";
import type {
  Currency,
  LicenseRequestStatus,
  MoneyMovementStatus,
  RevokedReason,
} from "../../src/lib/domain/values";
import { isUuid } from "../../src/lib/validation/uuid";
import { env } from "../../src/server/env";
import type {
  Authorization,
  FoundTransfer,
  MoneyCallFailure,
  PaymentsDriver,
  PiStatus,
  StripeCallOutcome,
} from "../../src/server/payments/driver";
import { createFakeDriver } from "../../src/server/payments/fake-driver";
import {
  refundKey,
  transferKey,
  transferReversalKey,
} from "../../src/server/payments/keys";

// A payments double for [int] tests (P16b): the fake driver's answers (07 D35) unless a script says otherwise, and a log
// of every call to any of its methods, so "asks Stripe nothing" sees them all. Tests inject it by mocking
// src/server/payments/registry.ts, so paymentsDriver(currency) returns driverFor(it). Only tests import it: nothing in
// src may.
// P19 makes it the D25 matrix's Stripe (07 D24–D26). Each PaymentIntent has the double's own status, moved only by its
// capture and cancel, a scripted read (authorizations) or an out-of-band move (movePi), and never derived from the row
// once tracked, so a request stored "not charged" while its hold still waits is caught: the invariant is checked before
// every move, at every call on a tracked PaymentIntent, and by checkInvariant. Each capture and cancel takes its outcome
// from next() (Stripe's own behaviour by default), runs its onCall hooks, and records the request's claim as committed
// when it arrived (07 D24: claim, commit, then call). A hook's error is a problem, never the caller's: settled() would
// turn it into a plausible transient.
// P19b adds the creator transfer (07 D74–D76), additively. Stripe's side is a ledger of transfers per currency
// (`ledger`). Each createTransfer takes its outcome from next("createTransfer", ...): with none queued, ok as the fake
// answers (`tr_fake_<request id>`); a queued ok records `tr_scripted_<request id>_<n>`; ambiguous records it, then
// throws as a lost connection; transient and permanent record nothing. A key already in the ledger replays its
// transfer. The call runs its onCall hooks (hold included) and records, read on the pool as it arrives, the request's
// status and its creator_transfer row (`committed`); each money-safety rule that state breaks is a problem: the request
// not approved, its tracked PaymentIntent not succeeded, no committed claim or one of another attempt than the key's,
// an amount other than the license price, a charge other than the request's, a second transfer for the request.
// findTransfers lists the request's ledger transfers on the driver's currency, or throws the next transferLookups
// error; seedTransfer puts one in without a call. script({ fetchPayoutsStatus }) lays an answer over the fake's payouts
// read, or throws it.
// P21b adds a revoke's refund and take-back (07 D86), the same way. Stripe's side: a ledger of refunds per PaymentIntent
// (`refunds`), which getAuthorization reports (amountRefundedCents, the newest refundId) over the fake's row-derived
// answer, and the transfer ledger's reversed amount and reversalId, which reverseTransfer sets in full. Each refund and
// reverseTransfer takes its outcome from next(...): with none queued, ok as the fake answers (`re_fake_` / `trr_fake_` +
// the request id); a queued ok records `re_scripted_<id>_<n>` / `trr_scripted_<id>_<n>`; ambiguous records it, then
// throws; transient and permanent record nothing. A key already recorded replays its refund or reversal, so an answer
// lost after Stripe refunded reconciles as refunded and is never refunded twice. Each call runs its onCall hooks and
// records the request, its license and its buyer_refund / transfer_reversal row as committed when it arrived; each rule
// that state breaks is a problem: the license not revoked, no committed claim of the key's attempt, a row already
// ended, another currency's request, a refund after payment_reversed or of another PaymentIntent, a second refund or
// reversal, a reversal of a transfer the ledger doesn't hold. seedRefund and seedReversal give money back with no call
// (the Dashboard's refund, a reversal made elsewhere).

type Checkout = Awaited<ReturnType<PaymentsDriver["retrieveCheckout"]>>;

/** The driver's calls: everything but its name and currency. */
type PaymentsMethod = Exclude<keyof PaymentsDriver, "name" | "currency">;

/** The calls that move money: each gets an outcome, hooks and the claim it ran under. */
export type MoneyMethod = "capture" | "cancel";

/** The calls onCall and hold catch: the PaymentIntent's money calls, the creator transfer (P19b), the revoke's (P21b). */
export type HookedMethod =
  | MoneyMethod
  | "createTransfer"
  | "refund"
  | "reverseTransfer";

type PayoutsAnswer = Awaited<ReturnType<PaymentsDriver["fetchPayoutsStatus"]>>;

/** What the next calls answer, until changed: a partial is laid over the fake's answer; an Error is thrown. */
export type PaymentScripts = {
  retrieveCheckout?: Partial<Checkout> | Error;
  getAuthorization?: Partial<Authorization> | Error;
  cancel?: StripeCallOutcome | Error;
  fetchPayoutsStatus?: Partial<PayoutsAnswer> | Error;
};

export type ScriptedCall = {
  method: PaymentsMethod;
  currency: Currency;
  args: readonly unknown[];
  /** For a capture, a cancel, a createTransfer, a refund or a reverseTransfer: its idempotency key. */
  key?: string;
  /** For a capture or a cancel: the request's committed status when it was called (07 D24: the claim commits first). */
  status?: LicenseRequestStatus | null;
};

/**
 * One capture's or cancel's fate, queued by next() (07 D25). `stripe` (the default) does what Stripe does with the
 * PaymentIntent as the double has it; `ok` moves a held one; transient and permanent answer that failure and move
 * nothing; `ambiguous` does what Stripe does, then throws as a lost connection, which the wrapper reports as transient.
 */
export type Outcome =
  | "ok"
  | "transient"
  | "ambiguous"
  | "stripe"
  | { kind: "transient"; code?: string }
  | { kind: "permanent"; code: string };

/** The request's claim as committed when a money call arrived. */
export type CommittedClaim = Pick<
  LicenseRequest,
  "status" | "paymentAction" | "paymentActionAt" | "stripeAttempt"
>;

/** A capture or a cancel as the double saw it (also in `log`). */
export type MoneyCall = ScriptedCall & {
  method: MoneyMethod;
  key: string;
  paymentIntentId: string;
  requestId: string;
  /** A cancel's reason, as Stripe hears it (02 §5.8). */
  reason?: "requested_by_customer" | "abandoned";
  /** The request's row, read on the pool when the call arrived, before the double acted (07 D24). */
  committed: CommittedClaim | null;
  /** The PaymentIntent when Stripe acted (after any `before` hook), and when it answered. */
  piBefore: PiStatus;
  piAfter: PiStatus;
  /** What the caller got, once the call is over. */
  answered?: StripeCallOutcome | "threw";
};

/** A move of a tracked PaymentIntent, and what moved it. */
export type PiMove = {
  paymentIntentId: string;
  from: PiStatus;
  to: PiStatus;
  by: MoneyMethod | "authorization" | "move";
};

/** One queued getAuthorization answer: thrown; a status the PaymentIntent moves to first; or laid over the answer. */
export type AuthorizationAnswer = Error | PiStatus | Partial<Authorization>;

/**
 * One createTransfer's, refund's or reverseTransfer's fate, queued by next(method, ...) (07 D75, D76, D86). ok records
 * it in its ledger (a key already there replays its own) and answers it; ambiguous does the same, then throws as a lost
 * connection; transient and permanent answer that failure and record nothing. There is no "stripe": with none queued,
 * the call is ok as the fake makes it.
 */
export type TransferOutcome = Exclude<Outcome, "stripe">;

/** The outcomes that answer a failure and move nothing: transient and permanent. */
type FailureOutcome = Exclude<TransferOutcome, "ok" | "ambiguous">;

type TransferInput = Parameters<PaymentsDriver["createTransfer"]>[0];
type TransferAnswer = Awaited<ReturnType<PaymentsDriver["createTransfer"]>>;

/** A transfer on Stripe's side, as findTransfers lists it, with the key that made it (null: seeded). */
export type LedgerTransfer = FoundTransfer & {
  requestId: string;
  currency: Currency;
  key: string | null;
};

/** A refund on Stripe's side (07 D86), with the key that made it (null: seeded, the Dashboard's). */
export type LedgerRefund = {
  requestId: string;
  currency: Currency;
  key: string | null;
  paymentIntentId: string;
  refundId: string;
  amountCents: number;
};

/** A reversal on Stripe's side, with the key that made it (null: seeded). */
export type LedgerReversal = {
  requestId: string;
  currency: Currency;
  key: string | null;
  transferId: string;
  reversalId: string;
};

type RefundInput = Parameters<PaymentsDriver["refund"]>[0];
type RefundAnswer = Awaited<ReturnType<PaymentsDriver["refund"]>>;
type ReversalInput = Parameters<PaymentsDriver["reverseTransfer"]>[0];
type ReversalAnswer = Awaited<ReturnType<PaymentsDriver["reverseTransfer"]>>;

/** The calls that make an entry in one of Stripe's ledgers, and each one's answer. */
type LedgerMethod = "createTransfer" | "refund" | "reverseTransfer";
type LedgerAnswerOf = {
  createTransfer: TransferAnswer;
  refund: RefundAnswer;
  reverseTransfer: ReversalAnswer;
};

/** What a ledger call's claim rules read of its request and its movement row, as committed when it arrived. */
type ClaimRow = {
  requestStatus: LicenseRequestStatus;
  attempt: number | null;
  claimedAt: Date | null;
};

/**
 * The request, its license and its buyer_refund or transfer_reversal row as committed when a refund or a
 * reverseTransfer arrived (07 D24, D86); the row's fields are null when there is none, the license's when it isn't issued.
 */
export type CommittedReturn = {
  requestStatus: LicenseRequestStatus;
  requestCurrency: Currency;
  paymentIntentId: string | null;
  amountTotalCents: number;
  revokedAt: Date | null;
  revokedReason: RevokedReason | null;
  movementStatus: MoneyMovementStatus | null;
  attempt: number | null;
  claimedAt: Date | null;
};

/** A refund as the double saw it (also in `log`). */
export type RefundCall = ScriptedCall & {
  method: "refund";
  key: string;
  requestId: string;
  paymentIntentId: string;
  /** Read on the pool when the call arrived, before the double acted; null when the request doesn't exist. */
  committed: CommittedReturn | null;
  answered?: RefundAnswer | "threw";
};

/** A reverseTransfer as the double saw it (also in `log`). */
export type ReversalCall = ScriptedCall & {
  method: "reverseTransfer";
  key: string;
  requestId: string;
  transferId: string;
  committed: CommittedReturn | null;
  answered?: ReversalAnswer | "threw";
};

/** The request and its creator_transfer row as committed when a createTransfer arrived (07 D24, D75); null: no row. */
export type CommittedTransfer = {
  requestStatus: LicenseRequestStatus;
  movementStatus: MoneyMovementStatus | null;
  attempt: number | null;
  claimedAt: Date | null;
};

/** A createTransfer as the double saw it (also in `log`). */
export type TransferCall = ScriptedCall & {
  method: "createTransfer";
  key: string;
  requestId: string;
  amountCents: number;
  chargeId: string;
  destinationAccountId: string;
  /** Read on the pool when the call arrived, before the double acted; null when the request doesn't exist. */
  committed: CommittedTransfer | null;
  /** What the caller got, once the call is over. */
  answered?: TransferAnswer | "threw";
};

/** When an onCall hook runs: as the call arrives, before Stripe acts; or after Stripe acted, before the answer. */
export type HookPhase = "before" | "during";

/**
 * Each hooked method's call and what next() queues for it. The double keeps one store per method, indexed by a generic
 * method, so a hook, an outcome and a call always agree on their method's types (microsoft/TypeScript#47109).
 */
type CallOf = {
  capture: MoneyCall;
  cancel: MoneyCall;
  createTransfer: TransferCall;
  refund: RefundCall;
  reverseTransfer: ReversalCall;
};
type OutcomeOf = {
  capture: Outcome;
  cancel: Outcome;
  createTransfer: TransferOutcome;
  refund: TransferOutcome;
  reverseTransfer: TransferOutcome;
};

type HookOptions = { phase?: HookPhase; times?: number };

/** An onCall hook on `M`'s calls: `left` counts the calls it still runs on. */
type Hook<M extends HookedMethod> = {
  phase: HookPhase;
  times?: number;
  left: number;
  run: (call: CallOf[M]) => unknown;
};

/** A held call: `reached` gives it as it arrives, release() lets it go. */
type Held<C> = {
  reached: Promise<C>;
  release: () => void;
};

/** The hooked methods, in the order leftovers lists them. */
const HOOKED: readonly HookedMethod[] = [
  "capture",
  "cancel",
  "createTransfer",
  "refund",
  "reverseTransfer",
];

/** How long a held call waits before it lets go by itself, as a problem (hold). */
const HOLD_LIMIT_MS = 5_000;

/** What a lost connection is called, thrown or answered: the wrapper keeps the name (07 D25). */
const CONNECTION_ERROR = "StripeConnectionError";

/** The endings that say "not charged" (07 D25): their PaymentIntent must be canceled. */
const UNCHARGED: ReadonlySet<LicenseRequestStatus> = new Set([
  "declined",
  "expired",
  "capture_failed",
]);

/** The request behind `pi_fake_<id>`; null for any other id. */
function requestOf(paymentIntentId: string): string | null {
  const id = /^pi_fake_(.+)$/.exec(paymentIntentId)?.[1];
  return id && isUuid(id) ? id : null;
}

/** The request's claim as committed now: read on the pool, outside any transaction the code under test holds. */
async function committedClaim(
  requestId: string,
): Promise<CommittedClaim | null> {
  const [row] = await db
    .select({
      status: licenseRequest.status,
      paymentAction: licenseRequest.paymentAction,
      paymentActionAt: licenseRequest.paymentActionAt,
      stripeAttempt: licenseRequest.stripeAttempt,
    })
    .from(licenseRequest)
    .where(eq(licenseRequest.id, requestId));
  return row ?? null;
}

/** What a createTransfer checks its money-safety rules against: the request and its creator_transfer row, committed. */
async function committedTransfer(requestId: string) {
  const [row] = await db
    .select({
      requestStatus: licenseRequest.status,
      licensePriceCents: licenseRequest.licensePriceCents,
      chargeId: licenseRequest.stripeChargeId,
      paymentIntentId: licenseRequest.stripePaymentIntentId,
      movementStatus: moneyMovement.status,
      attempt: moneyMovement.attempt,
      claimedAt: moneyMovement.claimedAt,
    })
    .from(licenseRequest)
    .leftJoin(
      moneyMovement,
      and(
        eq(moneyMovement.licenseRequestId, licenseRequest.id),
        eq(moneyMovement.kind, "creator_transfer"),
      ),
    )
    .where(eq(licenseRequest.id, requestId));
  return row ?? null;
}

type TransferRow = NonNullable<Awaited<ReturnType<typeof committedTransfer>>>;

/** What a refund or a reverseTransfer checks its rules against: the request, its license and its `kind` row, committed. */
async function committedReturn(
  requestId: string,
  kind: "buyer_refund" | "transfer_reversal",
): Promise<CommittedReturn | null> {
  const [row] = await db
    .select({
      requestStatus: licenseRequest.status,
      requestCurrency: licenseRequest.currency,
      paymentIntentId: licenseRequest.stripePaymentIntentId,
      amountTotalCents: licenseRequest.amountTotalCents,
      revokedAt: license.revokedAt,
      revokedReason: license.revokedReason,
      movementStatus: moneyMovement.status,
      attempt: moneyMovement.attempt,
      claimedAt: moneyMovement.claimedAt,
    })
    .from(licenseRequest)
    .leftJoin(license, eq(license.licenseRequestId, licenseRequest.id))
    .leftJoin(
      moneyMovement,
      and(
        eq(moneyMovement.licenseRequestId, licenseRequest.id),
        eq(moneyMovement.kind, kind),
      ),
    )
    .where(eq(licenseRequest.id, requestId));
  return row ?? null;
}

/** A transient or permanent outcome's answer, for a money call and a transfer alike. */
function failureOf(outcome: FailureOutcome): MoneyCallFailure {
  if (outcome === "transient") {
    return { ok: false, kind: "transient", code: CONNECTION_ERROR };
  }
  return outcome.kind === "permanent"
    ? { ok: false, kind: "permanent", code: outcome.code }
    : { ok: false, kind: "transient", code: outcome.code ?? CONNECTION_ERROR };
}

/**
 * A PaymentIntent's first status, from its request the first time a capture, cancel or move meets it: held while in
 * checkout or waiting, released once abandoned (P16b cancels after the commit). Never from an ending: that would make
 * the invariant hold by construction (07 D25).
 */
function seededFrom(status: LicenseRequestStatus | null): PiStatus | null {
  switch (status) {
    case "checkout_pending":
    case "awaiting_approval":
      return "requires_capture";
    case "abandoned":
      return "canceled";
    default:
      return null;
  }
}

const OK: StripeCallOutcome = { ok: true };

/**
 * What Stripe does with `method` on a PaymentIntent in `pi` (02 §5.8): where it moves (null: nowhere) and its answer.
 * A capture's key that captured before answers ok again (idempotency); a canceled hold cancels again as ok.
 */
function stripeDoes(
  method: MoneyMethod,
  pi: PiStatus,
  replayed: boolean,
): { to: PiStatus | null; answer: StripeCallOutcome } {
  const refused: StripeCallOutcome = {
    ok: false,
    kind: "permanent",
    code: "payment_intent_unexpected_state",
  };
  if (method === "capture") {
    if (pi === "requires_capture") return { to: "succeeded", answer: OK };
    return { to: null, answer: pi === "succeeded" && replayed ? OK : refused };
  }
  if (pi === "succeeded") return { to: null, answer: refused };
  return { to: pi === "canceled" ? null : "canceled", answer: OK };
}

/** What `outcome` does to a PaymentIntent in `pi`: its move, its answer (or a throw), and a scripted ok it contradicts. */
function outcomeOf(
  method: MoneyMethod,
  outcome: Outcome,
  pi: PiStatus,
  replayed: boolean,
): {
  to: PiStatus | null;
  answer: StripeCallOutcome | "throw";
  problem?: string;
} {
  switch (outcome) {
    case "stripe":
      return stripeDoes(method, pi, replayed);
    case "ambiguous":
      return { to: stripeDoes(method, pi, replayed).to, answer: "throw" };
    case "ok": {
      const done = method === "capture" ? "succeeded" : "canceled";
      if (pi === "requires_capture") return { to: done, answer: OK };
      // Cancelling a canceled hold is ok (02 §5.8); any other scripted ok contradicts the PaymentIntent.
      return method === "cancel" && pi === "canceled"
        ? { to: null, answer: OK }
        : {
            to: null,
            answer: OK,
            problem: `a scripted ok ${method} on a ${pi} PaymentIntent`,
          };
    }
    default:
      return { to: null, answer: failureOf(outcome) };
  }
}

/** What a call whose answer was lost throws: Stripe acted, and the caller can't know it (07 D25). */
function lostAnswer(key: string): Error {
  const error = new Error(`scripted: the answer to ${key} was lost`);
  error.name = CONNECTION_ERROR;
  return error;
}

export function createScriptedPayments() {
  const scripts: PaymentScripts = {};
  const log: ScriptedCall[] = [];
  /** Each hooked method's calls (also in `log`), queued outcomes and onCall hooks, in order. */
  const calls: { [M in HookedMethod]: CallOf[M][] } = {
    capture: [],
    cancel: [],
    createTransfer: [],
    refund: [],
    reverseTransfer: [],
  };
  const queues: { [M in HookedMethod]: OutcomeOf[M][] } = {
    capture: [],
    cancel: [],
    createTransfer: [],
    refund: [],
    reverseTransfer: [],
  };
  const hooks: { [M in HookedMethod]: Hook<M>[] } = {
    capture: [],
    cancel: [],
    createTransfer: [],
    refund: [],
    reverseTransfer: [],
  };
  const drivers = new Map<Currency, PaymentsDriver>();
  const pis = new Map<string, PiStatus>();
  const piHistory: PiMove[] = [];
  const lookupErrors: Error[] = [];
  /** Stripe's transfers, every currency's, in the order they were made. */
  const ledger: LedgerTransfer[] = [];
  const authorizationAnswers: AuthorizationAnswer[] = [];
  /** Stripe's refunds and reversals, every currency's, in the order they were made (P21b). */
  const refunds: LedgerRefund[] = [];
  const reversals: LedgerReversal[] = [];
  const holds = new Set<() => void>();
  /** Capture keys Stripe captured under: the same key answers ok again. */
  const captured = new Set<string>();
  const violations: string[] = [];
  const problems: string[] = [];

  /** `paymentIntentId`'s status, seeded from its request's `status` the first time; a problem when it can't be. */
  function tracked(
    paymentIntentId: string,
    status: LicenseRequestStatus | null,
  ): PiStatus {
    const known = pis.get(paymentIntentId);
    if (known) return known;
    const seeded = seededFrom(status);
    if (!seeded) {
      problems.push(
        `${paymentIntentId} first met on a ${status ?? "missing"} request: seedPi it first (07 D25)`,
      );
    }
    const first = seeded ?? (status === "approved" ? "succeeded" : "canceled");
    pis.set(paymentIntentId, first);
    return first;
  }

  /** 07 D25: a request stored approved needs its PaymentIntent succeeded; one stored "not charged", canceled. */
  function judge(
    paymentIntentId: string,
    status: LicenseRequestStatus | undefined,
    pi: PiStatus,
    when: string,
  ): void {
    if (!status) return;
    const broken =
      status === "approved"
        ? pi !== "succeeded"
        : UNCHARGED.has(status) && pi !== "canceled";
    if (broken) {
      violations.push(
        `${when}: the request is ${status} while ${paymentIntentId} is ${pi} (07 D25)`,
      );
    }
  }

  /** judge, for a tracked PaymentIntent, with its request as committed now. */
  async function judgeNow(
    paymentIntentId: string,
    requestId: string,
    when: string,
  ): Promise<void> {
    if (!pis.has(paymentIntentId)) return;
    const row = await committedClaim(requestId);
    const pi = pis.get(paymentIntentId);
    if (pi) judge(paymentIntentId, row?.status, pi, when);
  }

  /** Moves a tracked PaymentIntent and records the move; staying put is no move. */
  function record(
    paymentIntentId: string,
    from: PiStatus,
    to: PiStatus,
    by: PiMove["by"],
  ): void {
    if (from === to) return;
    pis.set(paymentIntentId, to);
    piHistory.push({ paymentIntentId, from, to, by });
  }

  /** An out-of-band move (Stripe's backstop cancel, a late capture) or a scripted read's, after the invariant. */
  async function move(
    paymentIntentId: string,
    to: PiStatus,
    by: "authorization" | "move",
  ): Promise<void> {
    const requestId = requestOf(paymentIntentId);
    const row = requestId ? await committedClaim(requestId) : null;
    const from = tracked(paymentIntentId, row?.status ?? null);
    judge(paymentIntentId, row?.status, from, `before ${by} to ${to}`);
    record(paymentIntentId, from, to, by);
  }

  /** Runs `method`'s `phase` hooks on `call` in order, awaited; a hook's error is a problem. True when one ran. */
  async function runHooks<M extends HookedMethod>(
    method: M,
    call: CallOf[M],
    phase: HookPhase,
  ): Promise<boolean> {
    const due = hooks[method].filter(
      (hook) => hook.phase === phase && hook.left > 0,
    );
    // Taken before any await, so calls at once never share a hook's last time.
    for (const hook of due) hook.left -= 1;
    for (const hook of due) {
      try {
        await hook.run(call);
      } catch (error) {
        problems.push(
          `onCall("${method}") ${phase} hook on ${call.key}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return due.length > 0;
  }

  /**
   * A capture or a cancel: the committed claim read and the invariant checked as it arrives, its `before` hooks, then
   * Stripe's move by the queued outcome (P16b's cancel script answers as it always did and moves nothing), its `during`
   * hooks, and the answer or the lost connection.
   */
  async function moneyCall(
    method: MoneyMethod,
    currency: Currency,
    args: readonly unknown[],
    {
      paymentIntentId,
      key,
      reason,
    }: { paymentIntentId: string; key: string; reason?: MoneyCall["reason"] },
  ): Promise<StripeCallOutcome> {
    const requestId = requestOf(paymentIntentId);
    if (!requestId) {
      problems.push(`${key}: ${paymentIntentId} isn't a pi_fake_<request id>`);
      throw new Error("fake driver: unknown pi_fake id");
    }
    const committed = await committedClaim(requestId);
    const arrived = tracked(paymentIntentId, committed?.status ?? null);
    judge(paymentIntentId, committed?.status, arrived, `${key} arrived`);
    const call: MoneyCall = {
      method,
      currency,
      args,
      key,
      ...(reason ? { reason } : {}),
      status: committed?.status ?? null,
      paymentIntentId,
      requestId,
      committed,
      piBefore: arrived,
      piAfter: arrived,
    };
    log.push(call);
    calls[method].push(call);
    if (await runHooks(method, call, "before")) {
      // A hook moved the PaymentIntent or held the call: the invariant again, before Stripe acts.
      await judgeNow(paymentIntentId, requestId, `${key} acting`);
    }
    call.piBefore = pis.get(paymentIntentId) ?? arrived;
    const queued = queues[method].shift();
    const legacy = method === "cancel" && !queued ? scripts.cancel : undefined;
    if (legacy) {
      await runHooks(method, call, "during");
      call.answered = legacy instanceof Error ? "threw" : legacy;
      if (legacy instanceof Error) throw legacy;
      return legacy;
    }
    const { to, answer, problem } = outcomeOf(
      method,
      queued ?? "stripe",
      call.piBefore,
      captured.has(key),
    );
    if (problem) problems.push(`${problem} (${key})`);
    if (to) {
      record(paymentIntentId, call.piBefore, to, method);
      if (to === "succeeded") captured.add(key);
    }
    call.piAfter = pis.get(paymentIntentId) ?? call.piBefore;
    await runHooks(method, call, "during");
    call.answered = answer === "throw" ? "threw" : answer;
    if (answer === "throw") throw lostAnswer(key);
    return answer;
  }

  /** A problem under `call`'s key: a rule the committed rows break. */
  const brokenBy =
    (call: { key: string }) =>
    (rule: string): void => {
      problems.push(`${call.key}: ${rule}`);
    };

  /**
   * The rules every ledger call checks as it arrives (07 D24, D75): its request exists and is approved (`decision`
   * names where the rule is), and its key is the committed claim's on its `kind` row. False when there is no request.
   */
  function claimChecked<R extends ClaimRow>(
    call: { key: string; requestId: string },
    row: R | null,
    kind: "creator_transfer" | "buyer_refund" | "transfer_reversal",
    keyOf: (requestId: string, attempt: number) => string,
    decision: "07 D74" | "07 D86",
  ): row is R {
    const broken = brokenBy(call);
    if (!row) {
      broken(`no request ${call.requestId}`);
      return false;
    }
    if (row.requestStatus !== "approved") {
      broken(`the request is ${row.requestStatus}, not approved (${decision})`);
    }
    // attempt is null only with no `kind` row, so no claim either.
    if (row.claimedAt === null || row.attempt === null) {
      broken(`no committed claim on its ${kind} row (07 D24, D75)`);
    } else if (call.key !== keyOf(call.requestId, row.attempt)) {
      broken(
        `not the key of the committed claim, attempt ${row.attempt} (07 D75)`,
      );
    }
    return true;
  }

  /** 07 D24, D74, D75 as a createTransfer arrives: a problem for each rule the committed rows break. */
  function checkTransfer(call: TransferCall, row: TransferRow | null): void {
    if (!claimChecked(call, row, "creator_transfer", transferKey, "07 D74")) {
      return;
    }
    const broken = brokenBy(call);
    const pi = row.paymentIntentId ? pis.get(row.paymentIntentId) : undefined;
    if (pi && pi !== "succeeded") {
      broken(`${row.paymentIntentId} is ${pi}, not captured (07 D74)`);
    }
    if (call.amountCents !== row.licensePriceCents) {
      broken(
        `${call.amountCents} isn't the license price ${row.licensePriceCents} (07 D74)`,
      );
    }
    if (row.chargeId !== null && call.chargeId !== row.chargeId) {
      broken(
        `${call.chargeId} isn't the request's charge ${row.chargeId} (07 D74)`,
      );
    }
  }

  /** `<prefix><request id>_<n>`: the request's nth entry in `entries`, one of the ledgers. */
  function ledgerId(
    prefix: string,
    entries: readonly { requestId: string }[],
    requestId: string,
  ): string {
    const n = entries.filter((entry) => entry.requestId === requestId).length;
    return `${prefix}${requestId}_${n + 1}`;
  }

  /** `tr_scripted_<request id>_<n>`: the request's nth transfer in the ledger. */
  const scriptedTransferId = (requestId: string) =>
    ledgerId("tr_scripted_", ledger, requestId);

  /**
   * The ledger's transfer under `call`'s key on its currency (Stripe's idempotency: the same key, the same transfer),
   * made the first time: `tr_scripted_…` when an outcome was queued, the fake's `tr_fake_<request id>` otherwise.
   */
  function ledgerTransfer(call: TransferCall, queued: boolean): LedgerTransfer {
    const known = ledger.find(
      (entry) => entry.currency === call.currency && entry.key === call.key,
    );
    if (known) {
      if (
        known.requestId !== call.requestId ||
        known.amountCents !== call.amountCents ||
        known.destinationAccountId !== call.destinationAccountId
      ) {
        problems.push(
          `${call.key} reused with other parameters: Stripe refuses it`,
        );
      }
      return known;
    }
    if (ledger.some((entry) => entry.requestId === call.requestId)) {
      problems.push(`${call.key}: a second transfer for the request (07 D74)`);
    }
    const made: LedgerTransfer = {
      requestId: call.requestId,
      currency: call.currency,
      key: call.key,
      transferId: queued
        ? scriptedTransferId(call.requestId)
        : `tr_fake_${call.requestId}`,
      amountCents: call.amountCents,
      amountReversedCents: 0,
      reversalId: null,
      destinationAccountId: call.destinationAccountId,
    };
    ledger.push(made);
    return made;
  }

  /** A ledger call's request id; a problem and a throw when it isn't one. */
  function requestIdOf(input: {
    requestId: string;
    idempotencyKey: string;
  }): string {
    const { requestId, idempotencyKey: key } = input;
    if (!isUuid(requestId)) {
      problems.push(`${key}: ${requestId} isn't a request id`);
      throw new Error("fake driver: not a request id");
    }
    return requestId;
  }

  /**
   * The rest of a ledger call once its committed rows are read into `call`: logged, its rules checked (`check`), its
   * `before` hooks, then its ledger by the queued outcome (ok and ambiguous answer `made(queued)`), its `during` hooks,
   * and the answer or the lost connection.
   */
  async function ledgerCall<M extends LedgerMethod>(
    method: M,
    call: CallOf[M],
    check: () => void,
    made: (queued: boolean) => LedgerAnswerOf[M],
  ): Promise<LedgerAnswerOf[M]> {
    log.push(call);
    calls[method].push(call);
    check();
    await runHooks(method, call, "before");
    const outcome: TransferOutcome | undefined = queues[method].shift();
    const answer: LedgerAnswerOf[M] =
      outcome === undefined || outcome === "ok" || outcome === "ambiguous"
        ? made(outcome !== undefined)
        : failureOf(outcome);
    await runHooks(method, call, "during");
    // Any ledger call's answer slot: TypeScript can't pair `call`'s method with `answer`'s, which are the same M.
    const settled: CallOf[LedgerMethod] = call;
    settled.answered = outcome === "ambiguous" ? "threw" : answer;
    if (outcome === "ambiguous") throw lostAnswer(call.key);
    return answer;
  }

  /**
   * A createTransfer: the committed rows read and the money-safety rules checked as it arrives, its `before` hooks, then
   * Stripe's ledger by the queued outcome, its `during` hooks, and the answer or the lost connection.
   */
  async function transferCall(
    currency: Currency,
    input: TransferInput,
  ): Promise<TransferAnswer> {
    const requestId = requestIdOf(input);
    const row = await committedTransfer(requestId);
    const call: TransferCall = {
      method: "createTransfer",
      currency,
      args: [input],
      key: input.idempotencyKey,
      requestId,
      amountCents: input.amountCents,
      chargeId: input.chargeId,
      destinationAccountId: input.destinationAccountId,
      committed: row && {
        requestStatus: row.requestStatus,
        movementStatus: row.movementStatus,
        attempt: row.attempt,
        claimedAt: row.claimedAt,
      },
    };
    return ledgerCall(
      "createTransfer",
      call,
      () => checkTransfer(call, row),
      (queued) => ({
        ok: true,
        transferId: ledgerTransfer(call, queued).transferId,
      }),
    );
  }

  /**
   * 07 D24, D86, D95 as a refund or a reverseTransfer arrives: a problem for each rule the committed rows break. `keyOf`
   * is the method's key builder, `kind` its movement.
   */
  function checkReturn(
    call: RefundCall | ReversalCall,
    row: CommittedReturn | null,
    kind: "buyer_refund" | "transfer_reversal",
    keyOf: (requestId: string, attempt: number) => string,
  ): void {
    if (!claimChecked(call, row, kind, keyOf, "07 D86")) return;
    const broken = brokenBy(call);
    if (row.requestCurrency !== call.currency) {
      broken(
        `a ${row.requestCurrency} request on the ${call.currency} account (07 D95)`,
      );
    }
    if (row.revokedAt === null) broken("its license isn't revoked (07 D86)");
    if (
      row.movementStatus === "succeeded" ||
      row.movementStatus === "canceled"
    ) {
      broken(`its ${kind} row is already ${row.movementStatus}`);
    }
  }

  /** What the ledger has refunded of `paymentIntentId` on `currency`'s account, and its newest refund. */
  function refundedOf(currency: Currency, paymentIntentId: string) {
    const made = refunds.filter(
      (entry) =>
        entry.currency === currency &&
        entry.paymentIntentId === paymentIntentId,
    );
    return {
      amountRefundedCents: made.reduce((sum, r) => sum + r.amountCents, 0),
      refundId: made.at(-1)?.refundId ?? null,
    };
  }

  /**
   * The ledger's refund under `call`'s key on its currency (Stripe's idempotency), made the first time for what is left
   * of the charge: `re_scripted_…` when an outcome was queued, the fake's `re_fake_<request id>` otherwise.
   */
  function ledgerRefund(call: RefundCall, queued: boolean): LedgerRefund {
    const known = refunds.find(
      (entry) => entry.currency === call.currency && entry.key === call.key,
    );
    if (known) {
      if (known.paymentIntentId !== call.paymentIntentId) {
        problems.push(
          `${call.key} reused with other parameters: Stripe refuses it`,
        );
      }
      return known;
    }
    const total = call.committed?.amountTotalCents ?? 0;
    const { amountRefundedCents } = refundedOf(
      call.currency,
      call.paymentIntentId,
    );
    if (amountRefundedCents > 0) {
      problems.push(
        `${call.key}: a second refund of ${call.paymentIntentId} (07 D86)`,
      );
    }
    const made: LedgerRefund = {
      requestId: call.requestId,
      currency: call.currency,
      key: call.key,
      paymentIntentId: call.paymentIntentId,
      refundId: queued
        ? ledgerId("re_scripted_", refunds, call.requestId)
        : `re_fake_${call.requestId}`,
      amountCents: total - amountRefundedCents,
    };
    refunds.push(made);
    return made;
  }

  /**
   * The ledger's reversal under `call`'s key on its currency, made the first time: the transfer reversed in full,
   * `trr_scripted_…` when an outcome was queued, the fake's `trr_fake_<request id>` otherwise.
   */
  function ledgerReversal(call: ReversalCall, queued: boolean): LedgerReversal {
    const known = reversals.find(
      (entry) => entry.currency === call.currency && entry.key === call.key,
    );
    if (known) {
      if (known.transferId !== call.transferId) {
        problems.push(
          `${call.key} reused with other parameters: Stripe refuses it`,
        );
      }
      return known;
    }
    const sent = ledger.find(
      (entry) =>
        entry.currency === call.currency &&
        entry.transferId === call.transferId,
    );
    if (!sent || sent.requestId !== call.requestId) {
      problems.push(
        `${call.key}: no transfer ${call.transferId} for the request on the ${call.currency} account`,
      );
    } else if (sent.amountReversedCents >= sent.amountCents) {
      problems.push(`${call.key}: a second reversal of ${sent.transferId}`);
    }
    return recordReversal(
      {
        requestId: call.requestId,
        currency: call.currency,
        key: call.key,
        transferId: call.transferId,
        reversalId: queued
          ? ledgerId("trr_scripted_", reversals, call.requestId)
          : `trr_fake_${call.requestId}`,
      },
      sent,
    );
  }

  /** Records reversal `made` and, when the ledger holds it, reverses its transfer `sent` in full. */
  function recordReversal(
    made: LedgerReversal,
    sent: LedgerTransfer | undefined,
  ): LedgerReversal {
    reversals.push(made);
    if (sent) {
      sent.amountReversedCents = sent.amountCents;
      sent.reversalId = made.reversalId;
    }
    return made;
  }

  /**
   * A refund: the committed rows read and the rules checked as it arrives (a refund also needs the request's own
   * PaymentIntent, captured, and a reason other than payment_reversed), its `before` hooks, then the refund ledger by
   * the queued outcome, its `during` hooks, and the answer or the lost connection.
   */
  async function refundCall(
    currency: Currency,
    input: RefundInput,
  ): Promise<RefundAnswer> {
    const requestId = requestIdOf(input);
    const { paymentIntentId, idempotencyKey: key } = input;
    const row = await committedReturn(requestId, "buyer_refund");
    const call: RefundCall = {
      method: "refund",
      currency,
      args: [input],
      key,
      requestId,
      paymentIntentId,
      committed: row,
    };
    const check = () => {
      checkReturn(call, row, "buyer_refund", refundKey);
      if (row && paymentIntentId !== row.paymentIntentId) {
        problems.push(
          `${key}: ${paymentIntentId} isn't the request's (07 D86)`,
        );
      }
      if (row?.revokedReason === "payment_reversed") {
        problems.push(
          `${key}: a refund of a payment already reversed (07 D86)`,
        );
      }
      const pi = pis.get(paymentIntentId);
      if (pi && pi !== "succeeded") {
        problems.push(`${key}: ${paymentIntentId} is ${pi}, not captured`);
      }
    };
    return ledgerCall("refund", call, check, (queued) => ({
      ok: true,
      refundId: ledgerRefund(call, queued).refundId,
      status: "succeeded",
    }));
  }

  /**
   * A reverseTransfer: the committed rows read and the rules checked as it arrives, its `before` hooks, then the
   * transfer ledger's reversal by the queued outcome, its `during` hooks, and the answer or the lost connection.
   */
  async function reversalCall(
    currency: Currency,
    input: ReversalInput,
  ): Promise<ReversalAnswer> {
    const requestId = requestIdOf(input);
    const row = await committedReturn(requestId, "transfer_reversal");
    const call: ReversalCall = {
      method: "reverseTransfer",
      currency,
      args: [input],
      key: input.idempotencyKey,
      requestId,
      transferId: input.transferId,
      committed: row,
    };
    return ledgerCall(
      "reverseTransfer",
      call,
      () => checkReturn(call, row, "transfer_reversal", transferReversalKey),
      (queued) => ({
        ok: true,
        reversalId: ledgerReversal(call, queued).reversalId,
      }),
    );
  }

  /** The double on `currency`'s account; every currency shares the scripts, the PaymentIntents and the log. */
  function driverFor(currency: Currency): PaymentsDriver {
    const known = drivers.get(currency);
    if (known) return known;
    const fake = createFakeDriver({ currency, appUrl: env.APP_URL });
    /** The fake's own answer to `method`, its call logged first. */
    const logged =
      <A extends unknown[], R>(
        method: PaymentsMethod,
        call: (...args: A) => R,
      ) =>
      (...args: A): R => {
        log.push({ method, currency, args });
        return call(...args);
      };
    const driver: PaymentsDriver = {
      name: fake.name,
      currency: fake.currency,
      createConnectedAccount: logged(
        "createConnectedAccount",
        fake.createConnectedAccount,
      ),
      enableNegativeBalanceDebits: logged(
        "enableNegativeBalanceDebits",
        fake.enableNegativeBalanceDebits,
      ),
      createOnboardingLink: logged(
        "createOnboardingLink",
        fake.createOnboardingLink,
      ),
      fetchPayoutsStatus: logged(
        "fetchPayoutsStatus",
        async (accountId: string) => {
          const script = scripts.fetchPayoutsStatus;
          if (script instanceof Error) throw script;
          return { ...(await fake.fetchPayoutsStatus(accountId)), ...script };
        },
      ),
      createCheckout: logged("createCheckout", fake.createCheckout),
      capture: (paymentIntentId, idempotencyKey) =>
        moneyCall("capture", currency, [paymentIntentId, idempotencyKey], {
          paymentIntentId,
          key: idempotencyKey,
        }),
      createTransfer: (input) => transferCall(currency, input),
      // The request's ledger transfers on this account, or the next queued lookup error.
      findTransfers: logged("findTransfers", async (requestId: string) => {
        const error = lookupErrors.shift();
        if (error) throw error;
        return ledger
          .filter(
            (entry) =>
              entry.requestId === requestId && entry.currency === currency,
          )
          .map(
            ({
              transferId,
              amountCents,
              amountReversedCents,
              reversalId,
              destinationAccountId,
            }) => ({
              transferId,
              amountCents,
              amountReversedCents,
              reversalId,
              destinationAccountId,
            }),
          );
      }),
      refund: (input) => refundCall(currency, input),
      reverseTransfer: (input) => reversalCall(currency, input),
      parseWebhook: logged("parseWebhook", fake.parseWebhook),
      retrieveCheckout: logged(
        "retrieveCheckout",
        async (sessionId: string) => {
          const script = scripts.retrieveCheckout;
          if (script instanceof Error) throw script;
          return { ...(await fake.retrieveCheckout(sessionId)), ...script };
        },
      ),
      // The fake's answer with the tracked status and the refund ledger's, then P16b's script, then the next queued answer.
      getAuthorization: logged(
        "getAuthorization",
        async (paymentIntentId: string) => {
          const answer = authorizationAnswers.shift();
          const requestId = requestOf(paymentIntentId);
          if (requestId) {
            await judgeNow(
              paymentIntentId,
              requestId,
              `getAuthorization ${paymentIntentId}`,
            );
          }
          if (answer instanceof Error) throw answer;
          if (typeof answer === "string") {
            await move(paymentIntentId, answer, "authorization");
          }
          const script = scripts.getAuthorization;
          if (script instanceof Error) throw script;
          const status = pis.get(paymentIntentId);
          return {
            ...(await fake.getAuthorization(paymentIntentId)),
            ...(status ? { status } : {}),
            ...refundedOf(currency, paymentIntentId),
            ...script,
            ...(typeof answer === "object" ? answer : {}),
          };
        },
      ),
      cancel: (paymentIntentId, reason, key) =>
        moneyCall("cancel", currency, [paymentIntentId, reason, key], {
          paymentIntentId,
          key,
          reason,
        }),
    };
    drivers.set(currency, driver);
    return driver;
  }

  /** The calls of one method, in order. */
  function callsOf<M extends HookedMethod>(method: M): CallOf[M][];
  function callsOf(method: PaymentsMethod): ScriptedCall[];
  function callsOf(method: PaymentsMethod): ScriptedCall[] {
    switch (method) {
      case "capture":
      case "cancel":
      case "createTransfer":
      case "refund":
      case "reverseTransfer":
        return [...calls[method]];
      default:
        return log.filter((call) => call.method === method);
    }
  }

  /** Runs `run` on each `method` call (on the next `times` of them when given), in `phase`, awaited. */
  function onCall<M extends HookedMethod>(
    method: M,
    run: (call: CallOf[M]) => unknown,
    { phase = "during", times }: HookOptions = {},
  ): void {
    const left = times ?? Number.POSITIVE_INFINITY;
    hooks[method].push({ phase, times, left, run });
  }

  /**
   * Holds the next `method` call as it arrives, before Stripe acts: `reached` gives the call, release() lets it go. A
   * held call that blocks the other actor means a driver call inside a transaction (07 D24): after 5 s it lets go by
   * itself, as a problem.
   */
  function hold<M extends HookedMethod>(method: M): Held<CallOf[M]> {
    const gate = Promise.withResolvers<void>();
    const arrival = Promise.withResolvers<CallOf[M]>();
    const release = () => {
      holds.delete(release);
      gate.resolve();
    };
    holds.add(release);
    const wait = async (call: CallOf[M]) => {
      arrival.resolve(call);
      const limit = setTimeout(() => {
        problems.push(
          `${call.key} was held ${HOLD_LIMIT_MS} ms: a driver call inside a transaction? (07 D24)`,
        );
        release();
      }, HOLD_LIMIT_MS);
      await gate.promise;
      clearTimeout(limit);
    };
    onCall(method, wait, { phase: "before", times: 1 });
    return { reached: arrival.promise, release };
  }

  /** 07 D25 for `requestId` now, at the end of a test's row: its tracked PaymentIntent against its committed status. */
  async function checkInvariant(requestId: string): Promise<void> {
    const paymentIntentId = `pi_fake_${requestId}`;
    if (!pis.has(paymentIntentId)) {
      problems.push(`checkInvariant: ${paymentIntentId} isn't tracked`);
      return;
    }
    await judgeNow(paymentIntentId, requestId, "checkInvariant");
  }

  /** What was scripted and never happened: queued outcomes and answers, and onCall hooks with `times` left. */
  function leftovers(): string[] {
    const unused = HOOKED.filter((method) => queues[method].length > 0).map(
      (method) => `next("${method}"): ${queues[method].length} unused`,
    );
    if (lookupErrors.length > 0) {
      unused.push(`transferLookups: ${lookupErrors.length} unused`);
    }
    if (authorizationAnswers.length > 0) {
      unused.push(`authorizations: ${authorizationAnswers.length} unused`);
    }
    for (const method of HOOKED) {
      for (const hook of hooks[method]) {
        if (hook.times !== undefined && hook.left > 0) {
          unused.push(
            `onCall("${method}", { phase: "${hook.phase}", times: ${hook.times} }): ${hook.left} never came`,
          );
        }
      }
    }
    return unused;
  }

  /**
   * Queues the outcomes of the next `method` calls, one per call; when none is left, Stripe's own behaviour (a transfer,
   * a refund or a reversal: ok, as the fake makes it).
   */
  function next<M extends HookedMethod>(
    method: M,
    ...outcomes: OutcomeOf[M][]
  ): void {
    queues[method].push(...outcomes);
  }

  return {
    driverFor,
    log,
    callsOf,
    /** A mark in the log: the returned function gives the methods called since, in order (P19b; P19c reuses it). */
    callsFromNow(): () => PaymentsMethod[] {
      const from = log.length;
      return () => log.slice(from).map(({ method }) => method);
    },
    /** The idempotency keys of one hooked method's calls, in order. */
    keys: (method: HookedMethod) => callsOf(method).map((call) => call.key),
    /** The cancels, in order, as [idempotency key, Stripe's reason]. */
    cancels: () => callsOf("cancel").map((call) => [call.key, call.reason]),
    /** Sets what the next calls answer (merged over the scripts so far; `undefined` drops one). */
    script(next: PaymentScripts) {
      Object.assign(scripts, next);
    },
    next,
    /** Queues the next getAuthorization answers, one per call. */
    authorizations(...answers: AuthorizationAnswer[]) {
      authorizationAnswers.push(...answers);
    },
    /** Queues errors the next findTransfers calls throw, one per call; when none is left, the ledger. */
    transferLookups(...answers: Error[]) {
      lookupErrors.push(...answers);
    },
    /** Stripe's transfers, in the order they were made: what findTransfers lists, per currency. */
    ledger,
    /** Stripe's refunds (P21b), in the order they were made: what getAuthorization reports, per PaymentIntent. */
    refunds,
    /**
     * Puts a transfer on Stripe's side with no call: a paid row to start from, or one that doesn't match its row
     * (another amount or account, partly reversed). Defaults: cad, `tr_scripted_<request id>_<n>`, nothing reversed.
     */
    seedTransfer({
      requestId,
      currency = "cad",
      amountCents,
      amountReversedCents = 0,
      destinationAccountId,
      transferId,
    }: {
      requestId: string;
      currency?: Currency;
      amountCents: number;
      amountReversedCents?: number;
      destinationAccountId: string;
      transferId?: string;
    }): LedgerTransfer {
      const seeded: LedgerTransfer = {
        requestId,
        currency,
        key: null,
        transferId: transferId ?? scriptedTransferId(requestId),
        amountCents,
        amountReversedCents,
        reversalId: null,
        destinationAccountId,
      };
      ledger.push(seeded);
      return seeded;
    },
    /**
     * Refunds `amountCents` of the request's PaymentIntent with no call, as a refund in the Dashboard would (P21b).
     * Defaults: cad, `pi_fake_<request id>`, `re_dashboard_<request id>_<n>`.
     */
    seedRefund({
      requestId,
      currency = "cad",
      amountCents,
      refundId,
    }: {
      requestId: string;
      currency?: Currency;
      amountCents: number;
      refundId?: string;
    }): LedgerRefund {
      const seeded: LedgerRefund = {
        requestId,
        currency,
        key: null,
        paymentIntentId: `pi_fake_${requestId}`,
        refundId: refundId ?? ledgerId("re_dashboard_", refunds, requestId),
        amountCents,
      };
      refunds.push(seeded);
      return seeded;
    },
    /**
     * Reverses the ledger's transfer `transferId` in full with no call, as a reversal made elsewhere would (P21b).
     * Default id: `trr_dashboard_<request id>_<n>`.
     */
    seedReversal(transferId: string, reversalId?: string): LedgerReversal {
      const sent = ledger.find((entry) => entry.transferId === transferId);
      if (!sent) throw new Error(`seedReversal: no transfer ${transferId}`);
      const { requestId } = sent;
      return recordReversal(
        {
          requestId,
          currency: sent.currency,
          key: null,
          transferId,
          reversalId:
            reversalId ?? ledgerId("trr_dashboard_", reversals, requestId),
        },
        sent,
      );
    },
    onCall,
    hold,
    /** Lets every held call go (afterEach). */
    releaseHolds() {
      for (const release of [...holds]) release();
    },
    /** Tracks `paymentIntentId` from `status` (a hold placed and waiting by default): every matrix row seeds its own. */
    seedPi(paymentIntentId: string, status: PiStatus = "requires_capture") {
      pis.set(paymentIntentId, status);
    },
    /** Moves `paymentIntentId` out of band: Stripe's backstop cancel, a capture that lands late. */
    movePi: (paymentIntentId: string, status: PiStatus) =>
      move(paymentIntentId, status, "move"),
    /** The tracked status, or undefined while untracked. */
    piStatus: (paymentIntentId: string): PiStatus | undefined =>
      pis.get(paymentIntentId),
    piHistory,
    checkInvariant,
    /** Each break of the invariant, as found (07 D25). */
    violations,
    /**
     * A hook's error, a contradicting script, an untracked PaymentIntent met on an ending, a call held too long, a
     * transfer, refund or reversal that breaks a money-safety rule.
     */
    problems,
    leftovers,
  };
}

export type ScriptedPayments = ReturnType<typeof createScriptedPayments>;
