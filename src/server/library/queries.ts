import "server-only";
import { and, asc, eq, ne } from "drizzle-orm";
import { db } from "../../db/client";
import { socialAccount } from "../../db/schema";
import type {
  SocialAccountStatus,
  SocialProviderId,
} from "../../lib/domain/values";
import { type Actor, requireCreatorActor } from "../auth/actor";

// Library reads (02 §5.4). P06 starts with the account summaries the connect step and Connections show; P07 and P08
// extend the DTO, and P09 adds the posts.

/** 02 §5.4's AccountSummaryDTO, narrowed to what a connect can fill. */
export type AccountSummaryDTO = {
  id: string;
  platform: SocialProviderId;
  username: string | null;
  displayName: string | null;
  status: SocialAccountStatus;
};

/** The creator's linked accounts (not disconnected), in the UI's platform order, oldest connect first. */
export async function listAccountSummaries(
  a: Actor,
): Promise<AccountSummaryDTO[]> {
  const actor = requireCreatorActor(a);
  return db
    .select({
      id: socialAccount.id,
      platform: socialAccount.provider,
      username: socialAccount.username,
      displayName: socialAccount.displayName,
      status: socialAccount.status,
    })
    .from(socialAccount)
    .where(
      and(
        eq(socialAccount.creatorId, actor.creatorId),
        ne(socialAccount.status, "disconnected"),
      ),
    )
    .orderBy(asc(socialAccount.provider), asc(socialAccount.connectedAt));
}
