import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { creatorProfile, video } from "@/db/schema";
import type { LicenseRequestStatus } from "@/lib/domain/values";
import { findRequestForBuyer } from "../tokens/buyer-token";

/** What /r shows of a request (02 §4.1): its status and the license page's address. P16b and P17 add the rest. */
export type BuyerRequest = {
  status: LicenseRequestStatus;
  handle: string;
  slug: string;
};

/** The request a buyer link opens, or null for a dead link: a wrong key, an unknown id, anything malformed. */
export async function getBuyerRequest(
  requestId: string,
  token: string,
): Promise<BuyerRequest | null> {
  const request = await findRequestForBuyer(requestId, token);
  if (!request) return null;
  // The video always exists: license_request's FK to it restricts deletes.
  const [page] = await db
    .select({ handle: creatorProfile.handle, slug: video.slug })
    .from(video)
    .innerJoin(creatorProfile, eq(creatorProfile.id, video.creatorId))
    .where(eq(video.id, request.videoId));
  return page ? { status: request.status, ...page } : null;
}
