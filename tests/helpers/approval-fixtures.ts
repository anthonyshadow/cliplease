// Approvable requests for [int] tests (P18; P19, P19c and P19g reuse them): a creator whose payouts are active, and an
// awaiting_approval request the fake driver resolves (`pi_fake_<its id>`), with a real sealed buyer key so its emails
// compose. Built by the factories and one authorized transition, as markAuthorized commits it.
import { randomUUID } from "node:crypto";
import { db } from "../../src/db/client";
import type {
  CreatorProfile,
  LicenseRequest,
  NewCreatorProfile,
  NewLicenseRequest,
  Video,
} from "../../src/db/schema/types";
import { DAY_MS, HOUR_MS } from "../../src/lib/time";
import { type Actor, WEBHOOK } from "../../src/server/auth/actor";
import {
  applyTransition,
  type TransitionResult,
} from "../../src/server/licensing/state-machine";
import { generateBuyerToken } from "../../src/server/tokens/buyer-token";
import { creatorActor } from "./auth";
import {
  insertCreator,
  insertLicenseRequest,
  insertRateCard,
  publishVideo,
  randomHex,
} from "./factories";
import { readyUpload } from "./ready-videos";

/**
 * A creator who can approve: a fake connected account with payouts `active`, read just now (so Approve asks the driver
 * nothing), onboarding's rate card, and the actor the session gate would build.
 */
export async function approvingCreator(
  overrides: Partial<NewCreatorProfile> = {},
): Promise<{ creator: CreatorProfile; actor: Actor }> {
  const creator = await insertCreator({
    stripeAccountId: `acct_fake_${randomHex(6)}`,
    payoutsStatus: "active",
    payoutsStatusSyncedAt: new Date(),
    ...overrides,
  });
  await insertRateCard(creator);
  return {
    creator,
    actor: creatorActor({ creatorId: creator.id, userId: creator.userId }),
  };
}

/** A published upload of `creatorId` with every step done: a ready original, rights answered. */
export const approvableVideo = async (creatorId: string): Promise<Video> =>
  publishVideo(await readyUpload(creatorId));

/** The J4.7 quote (01 J4.7): Paid social ads · 1 year · Worldwide at CA$150, CA$1,575.00 + CA$157.50 = CA$1,732.50. */
export const PAID_SOCIAL_YEAR_WORLDWIDE = {
  useKey: "paid_social",
  termKey: "y1",
  territoryKey: "worldwide",
  territoryCode: null,
  basePriceCents: 15000,
  useMultiplierBps: 30000,
  termMultiplierBps: 20000,
  territoryMultiplierBps: 17500,
  licensePriceCents: 157500,
  platformFeeCents: 15750,
  amountTotalCents: 173250,
} as const satisfies Partial<NewLicenseRequest>;

/** A checkout_pending request on `target` with the buyer's key sealed for real and its fake session. */
export async function pendingCheckoutRequest(
  target: Pick<Video, "id" | "creatorId">,
  overrides: Partial<NewLicenseRequest> = {},
): Promise<{ row: LicenseRequest; token: string }> {
  const id = randomUUID();
  const key = generateBuyerToken(id);
  const row = await insertLicenseRequest(target, {
    id,
    stripeCheckoutSessionId: `cs_fake_${id}`,
    buyerTokenHash: key.hash,
    buyerTokenEnc: key.enc,
    buyerTimeZone: "America/Toronto",
    ...overrides,
  });
  return { row, token: key.token };
}

/** T2 in its own transaction, as markAuthorized commits it: `pi_fake_<id>`, `ch_fake_<id>`, a 7-day hold, 72 h to answer. */
export function authorizeRequest(id: string): Promise<TransitionResult> {
  const authorizedAt = new Date();
  return db.transaction((tx) =>
    applyTransition(
      tx,
      id,
      "authorized",
      {
        stripePaymentIntentId: `pi_fake_${id}`,
        stripeChargeId: `ch_fake_${id}`,
        authorizedAt,
        captureBefore: new Date(authorizedAt.getTime() + 7 * DAY_MS),
        expiresAt: new Date(authorizedAt.getTime() + 72 * HOUR_MS),
      },
      WEBHOOK,
    ),
  );
}

/** An awaiting_approval request on `target`: pendingCheckoutRequest, then authorizeRequest. `overrides` go into the insert. */
export async function waitingRequest(
  target: Pick<Video, "id" | "creatorId">,
  overrides: Partial<NewLicenseRequest> = {},
): Promise<{ row: LicenseRequest; token: string; result: TransitionResult }> {
  const { row: pending, token } = await pendingCheckoutRequest(
    target,
    overrides,
  );
  const result = await authorizeRequest(pending.id);
  return { row: result.row, token, result };
}
