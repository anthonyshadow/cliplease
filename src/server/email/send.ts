import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { createElement, type ReactElement } from "react";
import { db, type Tx } from "@/db/client";
import { emailLog } from "@/db/schema";
import type { EmailLog } from "@/db/schema/types";
import { renderEmail } from "@/emails/render";
import { SignInCode } from "@/emails/sign-in-code";
import { normalizeEmail } from "@/lib/validation/email";
import { TokenCipherError } from "@/server/crypto/token-cipher";
import { env } from "@/server/env";
import { errorName, logEvent } from "@/server/log";
import { createConsoleDriver } from "./drivers/console";
import { composeRequestEmail } from "./request-emails";
import { signInCodeSubject } from "./subjects";
import type { EmailDriver, EmailProvider, EmailTemplateId } from "./types";

export type { EmailTemplateId } from "./types";

// The transactional outbox (02 §5.10; 07 D34): a transition queues its email_log rows in its own transaction, the caller
// sends them after the commit (runEffects), and webhook deliveries and the crons retry what is left. A row is sent at
// most once per key (03 I21): each send first claims the row for 2 minutes, and only the claim's own sender records its
// outcome. Senders never throw, and the error column holds a code, never a message (it could carry an address or a buyer
// link).

/** Sends per row: the first one and two retries (07 D34). */
export const MAX_EMAIL_ATTEMPTS = 3;
/**
 * A claim's lease: a claimed row is "queued" again, and no other sender takes it until this long after the claim (its
 * sender then died mid-send). A row never tried waits as long for the request that queued it.
 */
const LEASE = sql`interval '2 minutes'`;
const leaseOver = lt(emailLog.updatedAt, sql`now() - ${LEASE}`);

/** A failed row with attempts left. */
const retryable = and(
  eq(emailLog.status, "failed"),
  lt(emailLog.attempts, MAX_EMAIL_ATTEMPTS),
);

/** The console driver while RESEND_API_KEY is unset (Phase A). The Resend driver arrives in P26. */
export function emailDriver(): EmailDriver {
  if (activeEmailProvider() === "resend") {
    throw new Error("Resend driver arrives in P26");
  }
  return createConsoleDriver();
}

/** The driver emails go through now, named without building it: a queue insert must never fail on a driver. */
export function activeEmailProvider(): EmailProvider {
  return env.RESEND_API_KEY ? "resend" : "console";
}

/** email_log.recipient_hash: sha256 hex of the lowercased address (03 §3.8). */
export function recipientHash(address: string): string {
  return createHash("sha256").update(normalizeEmail(address)).digest("hex");
}

/**
 * Inserts one queued email_log row inside `tx`, the transaction of the change that causes it. Returns its id, or null
 * when the key is already queued (ON CONFLICT DO NOTHING).
 */
export async function queueEmail(
  tx: Tx,
  email: {
    template: Exclude<EmailTemplateId, "sign-in-code">;
    entityType: "user" | "license_request" | "license" | "social_account";
    entityId: string;
    idempotencyKey: string;
    to: string;
    subject: string;
  },
): Promise<string | null> {
  const [row] = await tx
    .insert(emailLog)
    .values({
      template: email.template,
      recipientHash: recipientHash(email.to),
      subject: email.subject,
      entityType: email.entityType,
      entityId: email.entityId,
      idempotencyKey: email.idempotencyKey,
      provider: activeEmailProvider(),
    })
    .onConflictDoNothing({ target: emailLog.idempotencyKey })
    .returning({ id: emailLog.id });
  return row?.id ?? null;
}

/**
 * Sends a 6-digit sign-in code (02 §5.10). The subject never contains the code. No email_log row and no log line: sign-in
 * codes are never logged (07 D47). Called only from the Better Auth sendVerificationOTP hook.
 */
export async function sendSignInCode(to: string, code: string): Promise<void> {
  await emailDriver().send({
    template: "sign-in-code",
    from: env.EMAIL_FROM,
    to,
    subject: signInCodeSubject(),
    ...(await renderEmail(createElement(SignInCode, { code }))),
  });
}

/** Sends the queued rows `emailLogIds` (just committed by a transition), one after another. Never throws. */
export async function sendQueuedEmails(
  emailLogIds: readonly string[],
): Promise<void> {
  if (emailLogIds.length === 0) return;
  try {
    const rows = await db
      .select()
      .from(emailLog)
      .where(
        and(
          inArray(emailLog.id, [...emailLogIds]),
          eq(emailLog.status, "queued"),
        ),
      )
      .orderBy(asc(emailLog.createdAt));
    for (const row of rows) await sendRow(row);
  } catch (error) {
    logEvent("error", "email.outbox_failed", { error: errorName(error) });
  }
}

/**
 * Sends the queued rows untouched for 2 min (never tried, or claimed by a sender that died) and retries the failed ones
 * with attempts left, oldest first, at most `limit`. Returns how many were sent. Never throws.
 */
export async function retryEmailOutbox(opts: {
  limit: number;
}): Promise<number> {
  let sent = 0;
  try {
    const rows = await db
      .select()
      .from(emailLog)
      .where(or(and(eq(emailLog.status, "queued"), leaseOver), retryable))
      .orderBy(asc(emailLog.createdAt))
      .limit(opts.limit);
    for (const row of rows) if (await sendRow(row)) sent += 1;
  } catch (error) {
    logEvent("error", "email.outbox_failed", { error: errorName(error) });
  }
  return sent;
}

type Outcome =
  | { ok: true; provider: EmailProvider; providerMessageId: string | null }
  /** `final`: retrying can't help, so the row takes its last attempt. */
  | { ok: false; error: string; final: boolean };

/** Claims, sends and records one row. True when it was sent. */
async function sendRow(row: EmailLog): Promise<boolean> {
  try {
    const claimed = await claim(row);
    if (!claimed) return false;
    const outcome = await deliver(claimed);
    // Only this claim's sender records it: a sender that took the row after the lease ran out has its own claim.
    await db
      .update(emailLog)
      .set(
        outcome.ok
          ? {
              status: "sent",
              sentAt: new Date(),
              provider: outcome.provider,
              providerMessageId: outcome.providerMessageId,
              error: null,
            }
          : {
              status: "failed",
              error: outcome.error,
              attempts: outcome.final ? MAX_EMAIL_ATTEMPTS : undefined,
            },
      )
      .where(
        and(eq(emailLog.id, row.id), eq(emailLog.attempts, claimed.attempts)),
      );
    if (!outcome.ok) {
      logEvent("warn", "email.send_failed", {
        emailLogId: row.id,
        template: row.template,
        error: outcome.error,
      });
    }
    return outcome.ok;
  } catch (error) {
    logEvent("error", "email.send_failed", {
      emailLogId: row.id,
      template: row.template,
      error: errorName(error),
    });
    return false;
  }
}

/**
 * Takes one attempt on `row` for the lease: only if no other sender has since (its attempts unchanged) and it is due:
 * queued and never tried, queued with its last claim's lease over, or failed with attempts left. The claimed row is
 * queued with a fresh updated_at, so nobody else takes it while it is being sent. Null when another sender has it.
 */
async function claim(row: EmailLog): Promise<EmailLog | null> {
  const [claimed] = await db
    .update(emailLog)
    .set({
      attempts: sql`${emailLog.attempts} + 1`,
      status: "queued",
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(emailLog.id, row.id),
        eq(emailLog.attempts, row.attempts),
        or(
          and(
            eq(emailLog.status, "queued"),
            or(eq(emailLog.attempts, 0), leaseOver),
          ),
          retryable,
        ),
      ),
    )
    .returning();
  return claimed ?? null;
}

/** The row's message, built from its entity now, sent through the driver; failures come back as codes. */
async function deliver(row: EmailLog): Promise<Outcome> {
  let message: Message | null;
  let parts: { html: string; text: string };
  try {
    message = await compose(row);
    if (!message) return { ok: false, error: "entity_missing", final: true };
    parts = await renderEmail(message.element);
  } catch (error) {
    const code =
      error instanceof TokenCipherError
        ? "token_unreadable"
        : `compose:${errorName(error)}`;
    return { ok: false, error: code, final: false };
  }
  if (recipientHash(message.to) !== row.recipientHash) {
    return { ok: false, error: "recipient_mismatch", final: true };
  }
  try {
    const driver = emailDriver();
    const sent = await driver.send(
      {
        template: message.template,
        from: env.EMAIL_FROM,
        to: message.to,
        subject: row.subject,
        ...parts,
      },
      { idempotencyKey: row.idempotencyKey },
    );
    return {
      ok: true,
      provider: driver.provider,
      providerMessageId: sent.providerMessageId,
    };
  } catch (error) {
    return { ok: false, error: `send:${errorName(error)}`, final: false };
  }
}

type Message = { template: EmailTemplateId; to: string; element: ReactElement };

/** The recipient and message of an outbox row, by template; null when its entity is gone. */
async function compose(row: EmailLog): Promise<Message | null> {
  const { template } = row;
  switch (template) {
    case "request-new":
    case "request-received": {
      const email = await composeRequestEmail(db, template, row.entityId);
      return email && { template, ...email };
    }
    default:
      throw new Error(`No outbox template ${template}`);
  }
}
