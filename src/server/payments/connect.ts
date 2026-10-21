import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { creatorProfile, user } from "@/db/schema";
import { writeAudit } from "@/server/audit";
import type { Actor } from "@/server/auth/actor";
import { errorName, logEvent } from "@/server/log";
import type { MoneyCallFailure, PaymentsDriver } from "./driver";
import { paymentsDriver } from "./registry";

/**
 * The creator's connected account id, created once on the payout currency's platform account (07 D95) and stored for
 * good (07 D29). Every driver call happens outside a transaction (07 D24): create the account, store it only if none is
 * stored yet (a concurrent call keeps the first id), then ask Stripe to allow negative-balance debits (07 D139). A
 * stored account whose debits aren't on yet gets another try.
 */
export async function ensureConnectedAccount(
  creatorId: string,
): Promise<string> {
  const [row] = await db
    .select({
      userId: creatorProfile.userId,
      displayName: creatorProfile.displayName,
      payoutCurrency: creatorProfile.payoutCurrency,
      stripeAccountId: creatorProfile.stripeAccountId,
      debitsEnabledAt: creatorProfile.negativeBalanceDebitsEnabledAt,
      email: user.email,
    })
    .from(creatorProfile)
    .innerJoin(user, eq(user.id, creatorProfile.userId))
    .where(eq(creatorProfile.id, creatorId))
    .limit(1);
  if (!row) throw new Error(`creator ${creatorId} not found`);
  const actor: Actor = { kind: "creator", userId: row.userId, creatorId };
  if (row.stripeAccountId) {
    if (row.debitsEnabledAt === null) {
      await ensureNegativeBalanceDebits({
        creatorId,
        accountId: row.stripeAccountId,
        driver: paymentsDriver(row.payoutCurrency),
        actor,
      });
    }
    return row.stripeAccountId;
  }

  const driver = paymentsDriver(row.payoutCurrency);
  const created = await driver.createConnectedAccount({
    id: creatorId,
    email: row.email,
    displayName: row.displayName,
  });
  const won = await db.transaction(async (tx) => {
    const updated = await tx
      .update(creatorProfile)
      .set({ stripeAccountId: created })
      .where(
        and(
          eq(creatorProfile.id, creatorId),
          isNull(creatorProfile.stripeAccountId),
        ),
      )
      .returning({ id: creatorProfile.id });
    if (updated.length === 0) return false;
    await writeAudit(tx, actor, {
      action: "creator_profile.payouts_account_created",
      entityType: "creator_profile",
      entityId: creatorId,
      data: { accountId: created },
    });
    return true;
  });
  if (!won) {
    // The concurrent call's id is the one kept, and that call allows the debits.
    const [stored] = await db
      .select({ stripeAccountId: creatorProfile.stripeAccountId })
      .from(creatorProfile)
      .where(eq(creatorProfile.id, creatorId))
      .limit(1);
    return stored?.stripeAccountId ?? created;
  }
  await ensureNegativeBalanceDebits({
    creatorId,
    accountId: created,
    driver,
    actor,
  });
  return created;
}

/**
 * Asks Stripe to allow negative-balance debits on `accountId` (07 D139), best effort: a failure is an audit row (a log
 * line when that write fails too), never an error for the creator. Success stamps negative_balance_debits_enabled_at;
 * until then the callers try again (owner answer). P24's recorded 'unsupported' fallback is not a failure (02 §5.8):
 * nothing is stamped or written.
 */
export async function ensureNegativeBalanceDebits({
  creatorId,
  accountId,
  driver,
  actor,
}: {
  creatorId: string;
  accountId: string;
  driver: PaymentsDriver;
  actor: Actor;
}): Promise<void> {
  let result: { ok: true } | MoneyCallFailure;
  try {
    result = await driver.enableNegativeBalanceDebits(accountId);
  } catch (error) {
    result = { ok: false, kind: "transient", code: errorName(error) };
  }
  if (result.ok) {
    await db
      .update(creatorProfile)
      .set({ negativeBalanceDebitsEnabledAt: new Date() })
      .where(
        and(
          eq(creatorProfile.id, creatorId),
          eq(creatorProfile.stripeAccountId, accountId),
          isNull(creatorProfile.negativeBalanceDebitsEnabledAt),
        ),
      );
    return;
  }
  if (result.kind === "permanent" && result.code === "unsupported") return;
  try {
    await writeAudit(db, actor, {
      action: "connect.negative_balance_debits_failed",
      entityType: "creator_profile",
      entityId: creatorId,
      data: { accountId, kind: result.kind, code: result.code },
    });
  } catch (error) {
    logEvent("warn", "connect.negative_balance_debits_audit_failed", {
      creatorId,
      error: errorName(error),
    });
  }
}
