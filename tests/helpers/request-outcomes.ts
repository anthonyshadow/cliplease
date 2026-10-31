// What a waiting request's ending left, for [int] tests (P19; P19b, P19c and P19g reuse them): its licenses, the
// transitions that ended it, its outcome emails and its Stripe events.
import { and, asc, eq } from "drizzle-orm";
import { expect } from "vitest";
import { db } from "../../src/db/client";
import { emailLog, license, stripeEvent } from "../../src/db/schema";
import type { License } from "../../src/db/schema/types";
import { auditsOf } from "./connect-flow";

/** The licenses issued for the request. */
export const licensesOf = (requestId: string): Promise<License[]> =>
  db.select().from(license).where(eq(license.licenseRequestId, requestId));

/** The request's one license: the test fails unless exactly one was issued. */
export async function onlyLicense(requestId: string): Promise<License> {
  const rows = await licensesOf(requestId);
  expect(rows).toHaveLength(1);
  const [row] = rows;
  if (!row) throw new Error("no license");
  return row;
}

/** The transitions that ended the waiting request: everything after its authorization. */
export async function endingsOf(requestId: string) {
  const transitions = await auditsOf(requestId, "license_request.transition");
  return transitions.filter(({ data }) => data.from === "awaiting_approval");
}

/** The request's email_log without the two its authorization queued (07 D34): each outcome email, as sent. */
export async function outcomeEmails(requestId: string) {
  const rows = await db
    .select({
      template: emailLog.template,
      status: emailLog.status,
      attempts: emailLog.attempts,
    })
    .from(emailLog)
    .where(
      and(
        eq(emailLog.entityType, "license_request"),
        eq(emailLog.entityId, requestId),
      ),
    )
    .orderBy(asc(emailLog.template));
  return rows.filter(
    ({ template }) =>
      template !== "request-new" && template !== "request-received",
  );
}

/** The request's Stripe events as stored, oldest first. */
export const stripeEventsOf = (requestId: string) =>
  db
    .select({
      type: stripeEvent.type,
      processedAt: stripeEvent.processedAt,
      lastError: stripeEvent.lastError,
    })
    .from(stripeEvent)
    .where(eq(stripeEvent.licenseRequestId, requestId))
    .orderBy(asc(stripeEvent.receivedAt));
