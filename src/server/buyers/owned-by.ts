import "server-only";
import { and, eq, type SQL } from "drizzle-orm";
import { licenseRequest } from "@/db/schema";
import { normalizeEmail } from "@/lib/validation/email";
import type { SessionUser } from "../auth/session";

/**
 * The requests that are this buyer's licenses (07 D126): approved, with the session's email in its stored form
 * (normalizeEmail, which license_request_buyer_email_lower holds every row to). A leaf module, so session.ts's landing
 * rule shares it without loading the My licenses queries.
 */
export const ownedBy = (user: Pick<SessionUser, "email">): SQL | undefined =>
  and(
    eq(licenseRequest.buyerEmail, normalizeEmail(user.email)),
    eq(licenseRequest.status, "approved"),
  );
