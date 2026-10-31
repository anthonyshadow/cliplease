import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { licenseRequest } from "../../src/db/schema";
import type { LicenseRequest } from "../../src/db/schema/types";
import type {
  Currency,
  LicenseRequestStatus,
} from "../../src/lib/domain/values";
import { isUuid } from "../../src/lib/validation/uuid";
import { env } from "../../src/server/env";
import type {
  Authorization,
  PaymentsDriver,
  PiStatus,
  StripeCallOutcome,
} from "../../src/server/payments/driver";
import { createFakeDriver } from "../../src/server/payments/fake-driver";

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

type Checkout = Awaited<ReturnType<PaymentsDriver["retrieveCheckout"]>>;

/** The driver's calls: everything but its name and currency. */
type PaymentsMethod = Exclude<keyof PaymentsDriver, "name" | "currency">;

/** The calls that move money: each gets an outcome, hooks and the claim it ran under. */
export type MoneyMethod = "capture" | "cancel";

/** What the next calls answer, until changed: a partial is laid over the fake's answer; an Error is thrown. */
export type PaymentScripts = {
  retrieveCheckout?: Partial<Checkout> | Error;
  getAuthorization?: Partial<Authorization> | Error;
  cancel?: StripeCallOutcome | Error;
};

export type ScriptedCall = {
  method: PaymentsMethod;
  currency: Currency;
  args: readonly unknown[];
  /** For a capture or a cancel: its idempotency key. */
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

/** When an onCall hook runs: as the call arrives, before Stripe acts; or after Stripe acted, before the answer. */
export type HookPhase = "before" | "during";

type Hook = {
  method: MoneyMethod;
  phase: HookPhase;
  run: (call: MoneyCall) => unknown;
  times?: number;
  left: number;
};

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
    case "transient":
      return {
        to: null,
        answer: { ok: false, kind: "transient", code: CONNECTION_ERROR },
      };
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
      return {
        to: null,
        answer:
          outcome.kind === "permanent"
            ? { ok: false, kind: "permanent", code: outcome.code }
            : {
                ok: false,
                kind: "transient",
                code: outcome.code ?? CONNECTION_ERROR,
              },
      };
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
  const money: MoneyCall[] = [];
  const drivers = new Map<Currency, PaymentsDriver>();
  const pis = new Map<string, PiStatus>();
  const piHistory: PiMove[] = [];
  const queues: Record<MoneyMethod, Outcome[]> = { capture: [], cancel: [] };
  const authorizationAnswers: AuthorizationAnswer[] = [];
  const hooks: Hook[] = [];
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

  /** Runs `call`'s `phase` hooks in order, awaited; a hook's error is a problem. True when one ran. */
  async function runHooks(call: MoneyCall, phase: HookPhase): Promise<boolean> {
    const due = hooks.filter(
      (hook) =>
        hook.method === call.method && hook.phase === phase && hook.left > 0,
    );
    // Taken before any await, so calls at once never share a hook's last time.
    for (const hook of due) hook.left -= 1;
    for (const hook of due) {
      try {
        await hook.run(call);
      } catch (error) {
        problems.push(
          `onCall("${call.method}") ${phase} hook on ${call.key}: ${error instanceof Error ? error.message : String(error)}`,
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
    money.push(call);
    if (await runHooks(call, "before")) {
      // A hook moved the PaymentIntent or held the call: the invariant again, before Stripe acts.
      await judgeNow(paymentIntentId, requestId, `${key} acting`);
    }
    call.piBefore = pis.get(paymentIntentId) ?? arrived;
    const queued = queues[method].shift();
    const legacy = method === "cancel" && !queued ? scripts.cancel : undefined;
    if (legacy) {
      await runHooks(call, "during");
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
    await runHooks(call, "during");
    call.answered = answer === "throw" ? "threw" : answer;
    if (answer === "throw") throw lostAnswer(key);
    return answer;
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
      fetchPayoutsStatus: logged("fetchPayoutsStatus", fake.fetchPayoutsStatus),
      createCheckout: logged("createCheckout", fake.createCheckout),
      capture: (paymentIntentId, idempotencyKey) =>
        moneyCall("capture", currency, [paymentIntentId, idempotencyKey], {
          paymentIntentId,
          key: idempotencyKey,
        }),
      createTransfer: logged("createTransfer", fake.createTransfer),
      findTransfers: logged("findTransfers", fake.findTransfers),
      refund: logged("refund", fake.refund),
      reverseTransfer: logged("reverseTransfer", fake.reverseTransfer),
      parseWebhook: logged("parseWebhook", fake.parseWebhook),
      retrieveCheckout: logged(
        "retrieveCheckout",
        async (sessionId: string) => {
          const script = scripts.retrieveCheckout;
          if (script instanceof Error) throw script;
          return { ...(await fake.retrieveCheckout(sessionId)), ...script };
        },
      ),
      // The fake's answer with the tracked status, then P16b's script, then the next queued answer.
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
  function callsOf(method: MoneyMethod): MoneyCall[];
  function callsOf(method: PaymentsMethod): ScriptedCall[];
  function callsOf(method: PaymentsMethod): ScriptedCall[] {
    return method === "capture" || method === "cancel"
      ? money.filter((call) => call.method === method)
      : log.filter((call) => call.method === method);
  }

  /** Runs `run` on each `method` call (on the next `times` of them when given), in `phase`, awaited. */
  function onCall(
    method: MoneyMethod,
    run: (call: MoneyCall) => unknown,
    { phase = "during", times }: { phase?: HookPhase; times?: number } = {},
  ): void {
    hooks.push({
      method,
      phase,
      run,
      times,
      left: times ?? Number.POSITIVE_INFINITY,
    });
  }

  /**
   * Holds the next `method` call as it arrives, before Stripe acts: `reached` gives the call, release() lets it go. A
   * held call that blocks the other actor means a driver call inside a transaction (07 D24): after 5 s it lets go by
   * itself, as a problem.
   */
  function hold(method: MoneyMethod): {
    reached: Promise<MoneyCall>;
    release: () => void;
  } {
    const gate = Promise.withResolvers<void>();
    const arrival = Promise.withResolvers<MoneyCall>();
    const release = () => {
      holds.delete(release);
      gate.resolve();
    };
    holds.add(release);
    onCall(
      method,
      async (call) => {
        arrival.resolve(call);
        const limit = setTimeout(() => {
          problems.push(
            `${call.key} was held ${HOLD_LIMIT_MS} ms: a driver call inside a transaction? (07 D24)`,
          );
          release();
        }, HOLD_LIMIT_MS);
        await gate.promise;
        clearTimeout(limit);
      },
      { phase: "before", times: 1 },
    );
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
    const unused = (["capture", "cancel"] as const)
      .filter((method) => queues[method].length > 0)
      .map((method) => `next("${method}"): ${queues[method].length} unused`);
    if (authorizationAnswers.length > 0) {
      unused.push(`authorizations: ${authorizationAnswers.length} unused`);
    }
    for (const hook of hooks) {
      if (hook.times !== undefined && hook.left > 0) {
        unused.push(
          `onCall("${hook.method}", { phase: "${hook.phase}", times: ${hook.times} }): ${hook.left} never came`,
        );
      }
    }
    return unused;
  }

  return {
    driverFor,
    log,
    callsOf,
    /** The idempotency keys of one money method's calls, in order. */
    keys: (method: MoneyMethod) => callsOf(method).map((call) => call.key),
    /** The cancels, in order, as [idempotency key, Stripe's reason]. */
    cancels: () => callsOf("cancel").map((call) => [call.key, call.reason]),
    /** Sets what the next calls answer (merged over the scripts so far; `undefined` drops one). */
    script(next: PaymentScripts) {
      Object.assign(scripts, next);
    },
    /** Queues the outcomes of the next `method` calls, one per call; when none is left, Stripe's own behaviour. */
    next(method: MoneyMethod, ...outcomes: Outcome[]) {
      queues[method].push(...outcomes);
    },
    /** Queues the next getAuthorization answers, one per call. */
    authorizations(...answers: AuthorizationAnswer[]) {
      authorizationAnswers.push(...answers);
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
    /** A hook's error, a contradicting script, an untracked PaymentIntent met on an ending, a call held too long. */
    problems,
    leftovers,
  };
}

export type ScriptedPayments = ReturnType<typeof createScriptedPayments>;
