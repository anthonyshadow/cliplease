import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { creatorProfile, rateCard, rateOption, user } from "@/db/schema";
import type { PayoutsStatus } from "@/lib/domain/values";
import {
  DEFAULT_BASE_PRICE_CENTS,
  defaultRateOptions,
} from "@/lib/pricing/presets";
import { handleProblem } from "@/lib/validation/handle";
import { normalizeTimeZone } from "@/lib/validation/time-zone";
import { writeAudit } from "@/server/audit";
import type { Actor } from "@/server/auth/actor";
import type { SessionUser } from "@/server/auth/session";
import { uniqueViolationConstraint } from "@/server/db-errors";
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

/** The trimmed display name, or null outside 1–60 characters (UTF-16 units: stricter than the CHECK's char_length). */
function cleanDisplayName(raw: string): string | null {
  const name = raw.trim();
  return name.length >= 1 && name.length <= 60 ? name : null;
}

function requireCreatorActor(a: Actor) {
  if (a.kind !== "creator") throw new Error("a creator actor is required");
  return a;
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

/**
 * The payouts status, re-read from the creator's payments driver when the stored one is older than `maxAgeMs` (0 always
 * re-reads). No account yet → 'not_started' without a call. The sync time uses the app's clock, which the freshness
 * check compares against.
 */
export async function refreshPayoutsStatus(
  creatorId: string,
  { maxAgeMs = 600_000 }: { maxAgeMs?: number } = {},
): Promise<PayoutsStatus> {
  const [row] = await db
    .select({
      stripeAccountId: creatorProfile.stripeAccountId,
      payoutsStatus: creatorProfile.payoutsStatus,
      syncedAt: creatorProfile.payoutsStatusSyncedAt,
      payoutCurrency: creatorProfile.payoutCurrency,
    })
    .from(creatorProfile)
    .where(eq(creatorProfile.id, creatorId))
    .limit(1);
  if (!row) throw new Error(`creator ${creatorId} not found`);
  if (!row.stripeAccountId) return "not_started";
  const fresh =
    maxAgeMs > 0 &&
    row.syncedAt !== null &&
    Date.now() - row.syncedAt.getTime() < maxAgeMs;
  if (fresh) return row.payoutsStatus;
  const { status } = await paymentsDriver(
    row.payoutCurrency,
  ).fetchPayoutsStatus(row.stripeAccountId);
  await db
    .update(creatorProfile)
    .set({ payoutsStatus: status, payoutsStatusSyncedAt: new Date() })
    .where(eq(creatorProfile.id, creatorId));
  return status;
}
