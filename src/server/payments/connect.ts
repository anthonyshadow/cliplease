import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { creatorProfile, user } from "@/db/schema";
import { writeAudit } from "@/server/audit";
import type { Actor } from "@/server/auth/actor";
import type { MoneyCallFailure } from "./driver";
import { paymentsDriver } from "./registry";

/**
 * The creator's connected account id, created once on the payout currency's platform account (07 D95) and stored for
 * good (07 D29). Every driver call happens outside a transaction (07 D24): create the account, store it only if none is
 * stored yet (a concurrent call keeps the first id), then ask Stripe to allow negative-balance debits (07 D139), best
 * effort: a failure is an audit row, never an error for the creator.
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
      email: user.email,
    })
    .from(creatorProfile)
    .innerJoin(user, eq(user.id, creatorProfile.userId))
    .where(eq(creatorProfile.id, creatorId))
    .limit(1);
  if (!row) throw new Error(`creator ${creatorId} not found`);
  if (row.stripeAccountId) return row.stripeAccountId;

  const actor: Actor = { kind: "creator", userId: row.userId, creatorId };
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
  const [stored] = await db
    .select({ stripeAccountId: creatorProfile.stripeAccountId })
    .from(creatorProfile)
    .where(eq(creatorProfile.id, creatorId))
    .limit(1);
  const accountId = stored?.stripeAccountId ?? created;
  if (!won) return accountId;

  let result: { ok: true } | MoneyCallFailure;
  try {
    result = await driver.enableNegativeBalanceDebits(accountId);
  } catch (error) {
    result = {
      ok: false,
      kind: "transient",
      code: error instanceof Error ? error.name : "unknown",
    };
  }
  // P24's recorded 'unsupported' fallback is not a failure (02 §5.8).
  const unsupported =
    !result.ok && result.kind === "permanent" && result.code === "unsupported";
  if (!result.ok && !unsupported) {
    await writeAudit(db, actor, {
      action: "connect.negative_balance_debits_failed",
      entityType: "creator_profile",
      entityId: creatorId,
      data: { accountId, kind: result.kind, code: result.code },
    });
  }
  return accountId;
}
