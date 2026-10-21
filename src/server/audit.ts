import "server-only";
import type { db } from "../db/client";
import { auditEvent } from "../db/schema";
import type { AuditActorType } from "../lib/domain/values";
import { SCOPED_NAME } from "../lib/log-line";
import { redact } from "../lib/redact";
import type { Actor } from "./auth/actor";

// The audit writer (02 §5, 07 D47). Relative imports: scripts/seed.ts loads it under tsx.

/** db, or a transaction: anything that can insert. */
export type AuditExecutor = Pick<typeof db, "insert">;

/**
 * Actor → audit_event.actor_type (07 D47): system/webhook → stripe, system/cron → cron, every other system source →
 * system with the source in data.source; a signed-in buyer is a buyer.
 */
export function auditActorType(actor: Actor): {
  actorType: AuditActorType;
  actorUserId: string | null;
  source?: string;
} {
  switch (actor.kind) {
    case "creator":
    case "admin":
      return { actorType: actor.kind, actorUserId: actor.userId };
    case "buyer":
      return { actorType: "buyer", actorUserId: null };
    case "buyer_user":
      return { actorType: "buyer", actorUserId: actor.userId };
    case "system":
      if (actor.source === "webhook")
        return { actorType: "stripe", actorUserId: null };
      if (actor.source === "cron")
        return { actorType: "cron", actorUserId: null };
      return { actorType: "system", actorUserId: null, source: actor.source };
  }
}

/** One audit entry: what happened to which entity, with optional data (redacted on the way in). */
export type AuditEntry = {
  action: string;
  entityType: string;
  entityId: string;
  data?: Record<string, unknown>;
};

/** The audit_event row for `entry`, after the scope.action check and the redaction. */
function auditRow(actor: Actor, entry: AuditEntry) {
  if (!SCOPED_NAME.test(entry.action)) {
    throw new Error(
      `audit action "${entry.action}" must look like scope.action`,
    );
  }
  const { actorType, actorUserId, source } = auditActorType(actor);
  // Audit rows keep `code` (license codes, provider error codes); every other log rule applies.
  const data = redact(
    { ...entry.data, ...(source ? { source } : {}) },
    { keepKeys: ["code"] },
  );
  return {
    actorType,
    actorUserId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    data: data as Record<string, unknown>,
  };
}

/**
 * Inserts one audit_event. `action` must look like scope.action (checked before the insert). `data` is redacted, so
 * tokens, secrets and emails never reach it.
 */
export async function writeAudit(
  exec: AuditExecutor,
  actor: Actor,
  entry: AuditEntry,
): Promise<void> {
  await exec.insert(auditEvent).values(auditRow(actor, entry));
}

/** writeAudit for many entries by one actor, in one INSERT (none for an empty list); every action is checked first. */
export async function writeAudits(
  exec: AuditExecutor,
  actor: Actor,
  entries: readonly AuditEntry[],
): Promise<void> {
  const rows = entries.map((entry) => auditRow(actor, entry));
  if (rows.length === 0) return;
  await exec.insert(auditEvent).values(rows);
}
