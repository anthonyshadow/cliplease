import "server-only";
import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { creatorProfile, rateCard, rateOption, user } from "@/db/schema";
import type { PayoutsStatus } from "@/lib/domain/values";
import {
  DEFAULT_BASE_PRICE_CENTS,
  defaultRateOptions,
} from "@/lib/pricing/presets";
import { MINUTE_MS } from "@/lib/time";
import { handleProblem } from "@/lib/validation/handle";
import { displayNameSchema } from "@/lib/validation/profile";
import { normalizeTimeZone } from "@/lib/validation/time-zone";
import { writeAudit } from "@/server/audit";
import { type Actor, LAZY, requireCreatorActor } from "@/server/auth/actor";
import type { CreatorContext, SessionUser } from "@/server/auth/session";
import { uniqueViolationConstraint } from "@/server/db-errors";
import { errorName, logEvent } from "@/server/log";
import { ensureNegativeBalanceDebits } from "@/server/payments/connect";
import type { PaymentsDriver } from "@/server/payments/driver";
import { paymentsDriver } from "@/server/payments/registry";

// Creator profile writes (02 §5.2, 07 §8.2). There is no payout setter: payout_currency keeps its default 'cad' (07 D94).

export type OnboardingErrorCode =
  | "invalid_input" // ageConfirmed not true, or a display name outside 1–60 characters
  | "handle_invalid"
  | "handle_reserved"
  | "handle_taken"
  | "already_onboarded";

export class OnboardingError extends Error {
  constructor(readonly code: OnboardingErrorCode) {
    super(`onboarding: ${code}`);
    this.name = "OnboardingError";
  }
}

/** The trimmed display name, or null when the shared schema refuses it (UTF-16 units: stricter than the CHECK's char_length). */
function cleanDisplayName(raw: string): string | null {
  const parsed = displayNameSchema.safeParse({ displayName: raw });
  return parsed.success ? parsed.data.displayName : null;
}

/**
 * Creates the creator: profile (age_confirmed_at now, the device's time zone, payout_currency left at 'cad'), the rate
 * card with the 10 default options, user.name (empty after an OTP sign-up, so the avatar gets initials) and the audit
 * row, in one transaction (07 D93). Everything is checked before the first write; the unique indexes decide a race.
 */
export async function completeOnboarding(
  sessionUser: SessionUser,
  i: {
    displayName: string;
    handle: string;
    ageConfirmed: true;
    timeZone: string;
  },
): Promise<{ creatorId: string }> {
  if (i.ageConfirmed !== true) throw new OnboardingError("invalid_input");
  const displayName = cleanDisplayName(i.displayName);
  if (displayName === null) throw new OnboardingError("invalid_input");
  const problem = handleProblem(i.handle);
  if (problem === "reserved") throw new OnboardingError("handle_reserved");
  if (problem !== null) throw new OnboardingError("handle_invalid");
  const timeZone = normalizeTimeZone(i.timeZone);

  const [existing] = await db
    .select({ id: creatorProfile.id })
    .from(creatorProfile)
    .where(eq(creatorProfile.userId, sessionUser.id))
    .limit(1);
  if (existing) throw new OnboardingError("already_onboarded");

  try {
    return await db.transaction(async (tx) => {
      const [profile] = await tx
        .insert(creatorProfile)
        .values({
          userId: sessionUser.id,
          handle: i.handle,
          displayName,
          ageConfirmedAt: sql`now()`,
          timeZone,
        })
        .returning({
          id: creatorProfile.id,
          payoutCurrency: creatorProfile.payoutCurrency,
        });
      const [card] = await tx
        .insert(rateCard)
        .values({
          creatorId: profile.id,
          basePriceCents: DEFAULT_BASE_PRICE_CENTS[profile.payoutCurrency],
        })
        .returning({ id: rateCard.id });
      await tx
        .insert(rateOption)
        .values(
          defaultRateOptions().map((o) => ({ ...o, rateCardId: card.id })),
        );
      await tx
        .update(user)
        .set({ name: displayName })
        .where(eq(user.id, sessionUser.id));
      await writeAudit(
        tx,
        { kind: "creator", userId: sessionUser.id, creatorId: profile.id },
        {
          action: "creator_profile.created",
          entityType: "creator_profile",
          entityId: profile.id,
          data: { handle: i.handle },
        },
      );
      return { creatorId: profile.id };
    });
  } catch (error) {
    const constraint = uniqueViolationConstraint(error);
    if (constraint === "creator_profile_handle_uidx") {
      throw new OnboardingError("handle_taken");
    }
    if (constraint === "creator_profile_user_id_uidx") {
      throw new OnboardingError("already_onboarded");
    }
    throw error;
  }
}

/** The display name only (handles are immutable, 07 D20), kept in step with user.name. */
export async function updateProfile(
  a: Actor,
  i: { displayName: string },
): Promise<void> {
  const actor = requireCreatorActor(a);
  const displayName = cleanDisplayName(i.displayName);
  if (displayName === null) throw new OnboardingError("invalid_input");
  await db.transaction(async (tx) => {
    await tx
      .update(creatorProfile)
      .set({ displayName })
      .where(eq(creatorProfile.id, actor.creatorId));
    await tx
      .update(user)
      .set({ name: displayName })
      .where(eq(user.id, actor.userId));
    await writeAudit(tx, actor, {
      action: "creator_profile.updated",
      entityType: "creator_profile",
      entityId: actor.creatorId,
      data: { fields: ["displayName"] },
    });
  });
}

/** The email time zone, from the device (07 D84); an unknown zone becomes UTC. */
export async function updateTimeZone(
  a: Actor,
  i: { timeZone: string },
): Promise<void> {
  const actor = requireCreatorActor(a);
  const timeZone = normalizeTimeZone(i.timeZone);
  await db.transaction(async (tx) => {
    await tx
      .update(creatorProfile)
      .set({ timeZone })
      .where(eq(creatorProfile.id, actor.creatorId));
    await writeAudit(tx, actor, {
      action: "creator_profile.updated",
      entityType: "creator_profile",
      entityId: actor.creatorId,
      data: { fields: ["timeZone"] },
    });
  });
}

/** A stored payouts status younger than this is used as is. */
const PAYOUTS_STATUS_MAX_AGE_MS = 10 * MINUTE_MS;

/**
 * The creators refreshPayoutsStatus may find active now, as a SQL condition on creator_profile (the cron's transfer
 * sweep, 07 D75): an account, and a stored 'active' or a reading old enough to be redone. The freshness rule of
 * payoutsStatus below, on the app's clock like the sync time it compares.
 */
export function payoutsMayBeActive() {
  return and(
    isNotNull(creatorProfile.stripeAccountId),
    or(
      eq(creatorProfile.payoutsStatus, "active"),
      isNull(creatorProfile.payoutsStatusSyncedAt),
      lt(
        creatorProfile.payoutsStatusSyncedAt,
        new Date(Date.now() - PAYOUTS_STATUS_MAX_AGE_MS),
      ),
    ),
  );
}

/**
 * The payout setup route and the return to Settings force a re-read, but one made in the last 10 s is reused (owner
 * answer): repeated hits, and the re-renders a Settings action causes, make no new driver call.
 */
export const PAYOUTS_FORCED_READ_MAX_AGE_MS = 10_000;

/**
 * Reads the status from `driver` and stores it with the time the reading started (the app's clock, which the freshness
 * check compares against). The write is fenced on that time, so an older reading that finishes late never replaces a
 * newer one: it returns the stored status instead.
 */
async function storePayoutsReading(
  creatorId: string,
  accountId: string,
  driver: PaymentsDriver,
): Promise<PayoutsStatus> {
  const readAt = new Date();
  const { status } = await driver.fetchPayoutsStatus(accountId);
  const [written] = await db
    .update(creatorProfile)
    .set({ payoutsStatus: status, payoutsStatusSyncedAt: readAt })
    .where(
      and(
        eq(creatorProfile.id, creatorId),
        or(
          isNull(creatorProfile.payoutsStatusSyncedAt),
          lt(creatorProfile.payoutsStatusSyncedAt, readAt),
        ),
      ),
    )
    .returning({ status: creatorProfile.payoutsStatus });
  if (written) return written.status;
  const [newer] = await db
    .select({ status: creatorProfile.payoutsStatus })
    .from(creatorProfile)
    .where(eq(creatorProfile.id, creatorId))
    .limit(1);
  return newer?.status ?? status;
}

/**
 * What a payouts read needs; a caller passes the copy it already read (its creator context, a transfer's row) to skip
 * the select.
 */
export type PayoutsRow = Pick<
  CreatorContext["creator"],
  | "stripeAccountId"
  | "payoutsStatus"
  | "payoutsStatusSyncedAt"
  | "payoutCurrency"
  | "negativeBalanceDebitsEnabledAt"
>;

async function readPayoutsRow(creatorId: string): Promise<PayoutsRow> {
  const [row] = await db
    .select({
      stripeAccountId: creatorProfile.stripeAccountId,
      payoutsStatus: creatorProfile.payoutsStatus,
      payoutsStatusSyncedAt: creatorProfile.payoutsStatusSyncedAt,
      payoutCurrency: creatorProfile.payoutCurrency,
      negativeBalanceDebitsEnabledAt:
        creatorProfile.negativeBalanceDebitsEnabledAt,
    })
    .from(creatorProfile)
    .where(eq(creatorProfile.id, creatorId))
    .limit(1);
  if (!row) throw new Error(`creator ${creatorId} not found`);
  return row;
}

/** The two exported reads below: the stored status while fresh, else a new reading; they differ only when it fails. */
async function payoutsStatus(
  creatorId: string,
  {
    row: given,
    maxAgeMs,
    onReadFailure,
    debitsActor,
  }: {
    row: PayoutsRow | undefined;
    maxAgeMs: number;
    onReadFailure: "throw" | "keep_stored";
    debitsActor: Actor | null;
  },
): Promise<PayoutsStatus> {
  const row = given ?? (await readPayoutsRow(creatorId));
  if (!row.stripeAccountId) return "not_started";
  const fresh =
    maxAgeMs > 0 &&
    row.payoutsStatusSyncedAt !== null &&
    Date.now() - row.payoutsStatusSyncedAt.getTime() < maxAgeMs;
  if (fresh) return row.payoutsStatus;
  // Resolved outside the try: a configuration error (CurrencyNotEnabledError) always throws.
  const driver = paymentsDriver(row.payoutCurrency);
  let status: PayoutsStatus;
  try {
    status = await storePayoutsReading(creatorId, row.stripeAccountId, driver);
  } catch (error) {
    if (onReadFailure === "throw") throw error;
    // The sync time stays, so the next load tries again.
    logEvent("warn", "payouts.status_refresh_failed", {
      creatorId,
      error: errorName(error),
    });
    return row.payoutsStatus;
  }
  if (row.negativeBalanceDebitsEnabledAt === null && debitsActor) {
    // The re-read also retries the negative-balance setting (07 D139), for creators who never press Set up payouts
    // again.
    await ensureNegativeBalanceDebits({
      creatorId,
      accountId: row.stripeAccountId,
      driver,
      actor: debitsActor,
    });
  }
  return status;
}

/**
 * The payouts status, re-read from the creator's payments driver when the stored one is older than `maxAgeMs` (0 always
 * re-reads). No account yet → 'not_started' without a call. A failed read throws, so Approve (07 D29) never acts on a
 * stale 'active'. `row` is the caller's copy of the creator's payouts columns (its creator context, a transfer's row).
 */
export async function refreshPayoutsStatus(
  creatorId: string,
  {
    maxAgeMs = PAYOUTS_STATUS_MAX_AGE_MS,
    debitsActor = LAZY,
    row,
  }: {
    maxAgeMs?: number;
    /** Who retries the negative-balance setting; null when the caller has just tried it. */
    debitsActor?: Actor | null;
    row?: PayoutsRow;
  } = {},
): Promise<PayoutsStatus> {
  return payoutsStatus(creatorId, {
    row,
    maxAgeMs,
    onReadFailure: "throw",
    debitsActor,
  });
}

/**
 * refreshPayoutsStatus for a page (Settings, the onboarding payouts step, a draft's Review): a failed read is logged and
 * the stored status shown, so the rest of the page still works. `row` is the page's creator context, read with the
 * session. `returned`: back from payout setup (`?payouts=returned`), so a read older than the forced 10 s is redone.
 */
export async function payoutsStatusForPage(
  creatorId: string,
  {
    returned = false,
    maxAgeMs = returned
      ? PAYOUTS_FORCED_READ_MAX_AGE_MS
      : PAYOUTS_STATUS_MAX_AGE_MS,
    row,
  }: { returned?: boolean; maxAgeMs?: number; row?: PayoutsRow } = {},
): Promise<PayoutsStatus> {
  return payoutsStatus(creatorId, {
    row,
    maxAgeMs,
    onReadFailure: "keep_stored",
    debitsActor: LAZY,
  });
}
