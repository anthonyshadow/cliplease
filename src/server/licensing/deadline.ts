import "server-only";
import { sql } from "drizzle-orm";
import { licenseRequest } from "@/db/schema";

// A waiting request's deadline on the database's clock, the one the claims' guards read (02 §4.4 rule 3; 07 D24, D25):
// the pages' Expired (displayStatus), Approve's `expired`, Decline's expiry and the due query agree (owner answer Q-142 a).

/** At or past the deadline; null without one, so a WHERE never takes such a row (license_request_due_idx serves it). */
export const pastDeadline = sql`${licenseRequest.expiresAt} <= now()`;

/** pastDeadline as a selected flag: false without a deadline. */
export const overdueColumn = sql<boolean>`coalesce(${pastDeadline}, false)`;
