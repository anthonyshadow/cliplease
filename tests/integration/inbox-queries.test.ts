import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "../../src/db/client";
import { video } from "../../src/db/schema";
import type {
  CreatorProfile,
  LicenseRequest,
  NewLicenseRequest,
  Video,
} from "../../src/db/schema/types";
import { DAY_MS, HOUR_MS } from "../../src/lib/time";
import { MUSIC_DISABLED_USES } from "../../src/lib/videos/rights";
import {
  getBuyerStatus,
  getRequestForCreator,
  listInbox,
  waitingSummary,
} from "../../src/server/licensing/queries";
import { generateBuyerToken } from "../../src/server/tokens/buyer-token";
import { latestLiveShareUrl } from "../../src/server/videos/public";
import { overdue } from "../helpers/approval-fixtures";
import {
  insertCreator,
  insertLicense,
  insertLicenseRequest,
  insertMoneyMovement,
  insertRateCard,
  publishVideo,
  requestRow,
} from "../helpers/factories";
import { readyUpload } from "../helpers/ready-videos";

// The request pages' reads (P17; 03 §7.1, §7.6; 01 §3.0; 07 D26, D47; 02 §9.11): each creator sees only their own
// requests, never one in checkout, an abandoned one or the buyer's email; /r reads one request through its key. P19:
// an unclaimed request past its deadline reads as Expired, by the database's clock, without the reads writing anything,
// and the payouts Banner's soonest deadline passes over it. P19b: the creator's reads carry the request's creator
// transfer (status, amount, currency) for the payout line, never its Stripe id or error; /r's never carry it.

/** The keys a creator's request carries, and nothing else. */
const CREATOR_KEYS = [
  "amountTotalCents",
  "contactName",
  "createdAt",
  "currency",
  "displayStatus",
  "expiresAt",
  "handle",
  "id",
  "intendedUse",
  "licenseCode",
  "licensePriceCents",
  "licenseeName",
  "posterUrl",
  "scope",
  "slug",
  "status",
  "statusReason",
  "title",
  "transferAmountCents",
  "transferCurrency",
  "transferStatus",
  "videoId",
];

/** What a request without a creator transfer reads (a waiting one, until T5 leaves the row). */
const NO_TRANSFER = {
  transferStatus: null,
  transferAmountCents: null,
  transferCurrency: null,
};

async function creatorWithVideo(): Promise<{
  creator: CreatorProfile;
  live: Video;
}> {
  const creator = await insertCreator();
  const live = await publishVideo(await readyUpload(creator.id));
  return { creator, live };
}

/** A request on `live` in `status`; a waiting one is held for 72 h from `authorizedAt`. */
function requestIn(
  live: Video,
  status: LicenseRequest["status"],
  overrides: Partial<NewLicenseRequest> = {},
) {
  const authorizedAt = new Date();
  const held =
    status === "checkout_pending"
      ? {}
      : {
          authorizedAt,
          captureBefore: new Date(authorizedAt.getTime() + 7 * DAY_MS),
          expiresAt: new Date(authorizedAt.getTime() + 72 * HOUR_MS),
          stripePaymentIntentId: `pi_fake_${randomUUID()}`,
        };
  return insertLicenseRequest(live, { status, ...held, ...overrides });
}

const inHours = (h: number) => new Date(Date.now() + h * HOUR_MS);

describe("listInbox (03 §7.1)", () => {
  it("lists the caller's waiting requests, soonest deadline first, and none in checkout or abandoned", async () => {
    const { creator, live } = await creatorWithVideo();
    const other = await creatorWithVideo();
    const later = await requestIn(live, "awaiting_approval", {
      expiresAt: inHours(60),
    });
    const sooner = await requestIn(live, "awaiting_approval", {
      expiresAt: inHours(5),
    });
    await requestIn(live, "checkout_pending");
    await requestIn(live, "abandoned", {
      statusReason: "checkout_expired",
      abandonedAt: new Date(),
      authorizedAt: null,
      captureBefore: null,
      expiresAt: null,
    });
    await requestIn(other.live, "awaiting_approval");

    const rows = await listInbox(creator.id, "waiting");
    expect(rows.map((r) => r.id)).toEqual([sooner.id, later.id]);
    expect(rows[0]).toMatchObject({
      status: "awaiting_approval",
      displayStatus: "awaiting_approval",
      licenseeName: "Acme Studio",
      contactName: "Pat Buyer",
      title: live.title,
      handle: creator.handle,
      slug: live.slug,
      licensePriceCents: 15000,
      amountTotalCents: 16500,
      currency: "cad",
      expiresAt: sooner.expiresAt?.toISOString(),
      posterUrl: expect.stringMatching(/^\/api\/media\/posters\//),
      licenseCode: null,
    });
    expect(await listInbox(creator.id, "history")).toEqual([]);
  });

  it("History lists decided requests, newest first, with the license's code", async () => {
    const { creator, live } = await creatorWithVideo();
    const approved = await requestIn(live, "approved");
    const issued = await insertLicense(approved);
    const disabled = await requestIn(live, "declined", {
      statusReason: "video_disabled",
    });
    const expired = await requestIn(live, "expired");
    const failed = await requestIn(live, "capture_failed", {
      statusReason: "capture_error:card_declined",
    });
    await requestIn(live, "awaiting_approval");

    const rows = await listInbox(creator.id, "history");
    expect(rows.map((r) => [r.id, r.status, r.licenseCode])).toEqual([
      [failed.id, "capture_failed", null],
      [expired.id, "expired", null],
      [disabled.id, "declined", null],
      [approved.id, "approved", issued.code],
    ]);
    expect(rows[2]?.statusReason).toBe("video_disabled");
  });

  it("History keeps the 20 newest", async () => {
    const { creator, live } = await creatorWithVideo();
    const made: LicenseRequest[] = [];
    for (let i = 0; i < 21; i += 1) made.push(await requestIn(live, "expired"));
    const rows = await listInbox(creator.id, "history");
    expect(rows).toHaveLength(20);
    expect(rows.map((r) => r.id)).not.toContain(made[0]?.id);
    expect(rows[0]?.id).toBe(made[20]?.id);
  });

  it("reads a claimed waiting request as Processing…, and a decided one as stored (07 D26)", async () => {
    const { creator, live } = await creatorWithVideo();
    const claimed = await requestIn(live, "awaiting_approval", {
      paymentAction: "capture",
      paymentActionAt: new Date(),
    });
    const approved = await requestIn(live, "approved", {
      paymentAction: "capture",
      paymentActionAt: new Date(),
    });
    expect((await listInbox(creator.id, "waiting"))[0]).toMatchObject({
      id: claimed.id,
      status: "awaiting_approval",
      displayStatus: "processing",
    });
    expect((await listInbox(creator.id, "history"))[0]).toMatchObject({
      id: approved.id,
      displayStatus: "approved",
    });
  });
});

describe("getRequestForCreator (05 §6.4)", () => {
  it("gives the creator their request and no one else's", async () => {
    const { creator, live } = await creatorWithVideo();
    const other = await creatorWithVideo();
    const waiting = await requestIn(live, "awaiting_approval");
    expect(await getRequestForCreator(creator.id, waiting.id)).toMatchObject({
      id: waiting.id,
      licenseeName: "Acme Studio",
    });
    expect(await getRequestForCreator(other.creator.id, waiting.id)).toBeNull();
    expect(await getRequestForCreator(creator.id, randomUUID())).toBeNull();
    expect(await getRequestForCreator(creator.id, "not-a-uuid")).toBeNull();
  });

  it.each(["checkout_pending", "abandoned"] as const)(
    "never gives a %s request (01 §3.0)",
    async (status) => {
      const { creator, live } = await creatorWithVideo();
      const row = await requestIn(
        live,
        status,
        status === "abandoned"
          ? {
              statusReason: "checkout_expired",
              abandonedAt: new Date(),
              authorizedAt: null,
              captureBefore: null,
              expiresAt: null,
            }
          : {},
      );
      expect(await getRequestForCreator(creator.id, row.id)).toBeNull();
    },
  );
});

describe("the creator's request never carries the buyer's private fields (07 D47; 02 §9.11)", () => {
  it("has exactly the creator's keys, and no email, key, IP, user agent or Stripe id anywhere", async () => {
    const { creator, live } = await creatorWithVideo();
    const row = await requestIn(live, "awaiting_approval", {
      buyerEmail: "private.buyer@example.com",
      termsAcceptedIp: "203.0.113.9",
      termsAcceptedUserAgent: "PrivateAgent/1.0",
    });
    const listed = await listInbox(creator.id, "waiting");
    const one = await getRequestForCreator(creator.id, row.id);
    for (const dto of [...listed, one]) {
      expect(Object.keys(dto ?? {}).sort()).toEqual(CREATOR_KEYS);
      const json = JSON.stringify(dto);
      for (const secret of [
        "private.buyer@example.com",
        row.buyerTokenHash,
        row.buyerTokenEnc,
        "203.0.113.9",
        "PrivateAgent",
        "pi_fake_",
        "buyerEmail",
      ]) {
        expect(json).not.toContain(secret);
      }
    }
  });
});

describe("the creator transfer on the creator's request (P19b; 07 D75; 03 §7.1)", () => {
  it("reads null while the request waits, and on a decided one with no transfer row", async () => {
    const { creator, live } = await creatorWithVideo();
    const waiting = await requestIn(live, "awaiting_approval");
    const approved = await requestIn(live, "approved");
    await insertLicense(approved);
    expect(await listInbox(creator.id, "waiting")).toEqual([
      expect.objectContaining({ id: waiting.id, ...NO_TRANSFER }),
    ]);
    expect(await listInbox(creator.id, "history")).toEqual([
      expect.objectContaining({ id: approved.id, ...NO_TRANSFER }),
    ]);
    for (const { id } of [waiting, approved]) {
      expect(await getRequestForCreator(creator.id, id)).toMatchObject(
        NO_TRANSFER,
      );
    }
  });

  it("reads a paid and a failed transfer's status, amount and currency, and never its Stripe id or error", async () => {
    const { creator, live } = await creatorWithVideo();
    const paid = await requestIn(live, "approved");
    await insertLicense(paid);
    const paidMove = await insertMoneyMovement(paid, {
      status: "succeeded",
      stripeObjectId: "tr_fake_x",
      succeededAt: new Date(),
      attempt: 1,
    });
    const failed = await requestIn(live, "approved");
    await insertLicense(failed);
    const failedMove = await insertMoneyMovement(failed, {
      status: "failed",
      lastError: "test_permanent",
      attempt: 1,
    });

    const history = await listInbox(creator.id, "history");
    const details = [
      await getRequestForCreator(creator.id, failed.id),
      await getRequestForCreator(creator.id, paid.id),
    ];
    const want = [
      [failed.id, "failed", failedMove.amountCents, "cad"],
      [paid.id, "succeeded", paidMove.amountCents, "cad"],
    ];
    for (const dtos of [history, details]) {
      expect(
        dtos.map((r) => [
          r?.id,
          r?.transferStatus,
          r?.transferAmountCents,
          r?.transferCurrency,
        ]),
      ).toEqual(want);
    }
    for (const dto of [...history, ...details]) {
      expect(Object.keys(dto ?? {}).sort()).toEqual(CREATOR_KEYS);
      const json = JSON.stringify(dto);
      for (const secret of ["tr_fake_x", "test_permanent", "claimedAt"]) {
        expect(json).not.toContain(secret);
      }
    }
  });

  it("reads a request with another kind of movement too as one row, with its creator transfer's amount", async () => {
    const { creator, live } = await creatorWithVideo();
    const approved = await requestIn(live, "approved");
    await insertLicense(approved);
    await insertMoneyMovement(approved);
    await insertMoneyMovement(approved, {
      kind: "buyer_refund",
      amountCents: approved.amountTotalCents,
    });
    const history = await listInbox(creator.id, "history");
    expect(history).toEqual([
      expect.objectContaining({
        id: approved.id,
        transferStatus: "pending",
        transferAmountCents: approved.licensePriceCents,
        transferCurrency: "cad",
      }),
    ]);
    expect(await getRequestForCreator(creator.id, approved.id)).toMatchObject({
      transferStatus: "pending",
      transferAmountCents: approved.licensePriceCents,
    });
  });
});

describe("waitingSummary (05 §6.3)", () => {
  it("counts the creator's waiting requests and names the soonest deadline", async () => {
    const { creator, live } = await creatorWithVideo();
    expect(await waitingSummary(creator.id)).toEqual({
      count: 0,
      soonestExpiresAt: null,
    });
    const sooner = await requestIn(live, "awaiting_approval", {
      expiresAt: inHours(3),
    });
    await requestIn(live, "awaiting_approval", { expiresAt: inHours(50) });
    await requestIn(live, "approved");
    await requestIn(live, "checkout_pending");
    expect(await waitingSummary(creator.id)).toEqual({
      count: 2,
      soonestExpiresAt: sooner.expiresAt?.toISOString(),
    });
  });
});

describe("getBuyerStatus (03 §7.6)", () => {
  async function withKey(live: Video, status: LicenseRequest["status"]) {
    const id = randomUUID();
    const key = generateBuyerToken(id);
    const row = await requestIn(live, status, {
      id,
      buyerTokenHash: key.hash,
      buyerTokenEnc: key.enc,
    });
    return { row, token: key.token };
  }

  it("reads the request a key opens, and nothing for a wrong key", async () => {
    const { creator, live } = await creatorWithVideo();
    const { row, token } = await withKey(live, "awaiting_approval");
    expect(await getBuyerStatus(row.id, token)).toMatchObject({
      id: row.id,
      status: "awaiting_approval",
      displayStatus: "awaiting_approval",
      handle: creator.handle,
      title: live.title,
      amountTotalCents: 16500,
      currency: "cad",
      posterUrl: expect.stringMatching(/^\/api\/media\/posters\//),
    });
    expect(await getBuyerStatus(row.id, "A".repeat(43))).toBeNull();
    expect(await getBuyerStatus(randomUUID(), token)).toBeNull();
  });

  it("leaves the poster out while the video isn't public, so it never 404s", async () => {
    const { live } = await creatorWithVideo();
    const { row, token } = await withKey(live, "awaiting_approval");
    await db
      .update(video)
      .set({ status: "unpublished" })
      .where(eq(video.id, live.id));
    expect((await getBuyerStatus(row.id, token))?.posterUrl).toBeNull();
  });

  it("carries the license's code once issued, and reads a claimed request as processing", async () => {
    const { live } = await creatorWithVideo();
    const approved = await withKey(live, "approved");
    const issued = await insertLicense(approved.row);
    expect(
      (await getBuyerStatus(approved.row.id, approved.token))?.licenseCode,
    ).toBe(issued.code);
    const id = randomUUID();
    const key = generateBuyerToken(id);
    await requestIn(live, "awaiting_approval", {
      id,
      buyerTokenHash: key.hash,
      buyerTokenEnc: key.enc,
      paymentAction: "decline",
      paymentActionAt: new Date(),
    });
    expect((await getBuyerStatus(id, key.token))?.displayStatus).toBe(
      "processing",
    );
  });

  it("never carries the creator transfer: the payout line is the creator's alone (P19b)", async () => {
    const { live } = await creatorWithVideo();
    const { row, token } = await withKey(live, "approved");
    await insertLicense(row);
    await insertMoneyMovement(row, {
      status: "failed",
      lastError: "test_permanent",
      attempt: 1,
    });
    const status = await getBuyerStatus(row.id, token);
    expect(status).toMatchObject({ id: row.id, status: "approved" });
    expect(
      Object.keys(status ?? {}).filter((key) => key.startsWith("transfer")),
    ).toEqual([]);
    expect(JSON.stringify(status)).not.toContain("test_permanent");
  });
});

describe("an overdue request (owner answer Q-142 a; 07 D25, D26; 02 §4.4 rule 3)", () => {
  it("reads as Expired while it waits unclaimed past its deadline on the database's clock, stored waiting: the reads expire nothing", async () => {
    const { creator, live } = await creatorWithVideo();
    const id = randomUUID();
    const key = generateBuyerToken(id);
    await requestIn(live, "awaiting_approval", {
      id,
      buyerTokenHash: key.hash,
      buyerTokenEnc: key.enc,
    });
    await overdue(id);
    const readsExpired = {
      status: "awaiting_approval",
      displayStatus: "expired",
    };

    const waiting = await listInbox(creator.id, "waiting");
    expect(waiting).toEqual([expect.objectContaining({ id, ...readsExpired })]);
    expect(Object.keys(waiting[0] ?? {}).sort()).toEqual(CREATOR_KEYS);
    expect(await getRequestForCreator(creator.id, id)).toMatchObject(
      readsExpired,
    );
    expect(await getBuyerStatus(id, key.token)).toMatchObject(readsExpired);
    // Pure reads: only the lazy layers and the cron end it, once Stripe has released the hold.
    expect(await requestRow(id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
      stripeAttempt: 0,
    });
  });

  it("reads a claim on it as Processing…, even past the deadline (07 D26)", async () => {
    const { creator, live } = await creatorWithVideo();
    const claimed = await requestIn(live, "awaiting_approval", {
      paymentAction: "expire",
      paymentActionAt: new Date(),
    });
    await overdue(claimed.id);
    expect(await listInbox(creator.id, "waiting")).toEqual([
      expect.objectContaining({
        id: claimed.id,
        status: "awaiting_approval",
        displayStatus: "processing",
      }),
    ]);
  });

  it("still counts as waiting, but the soonest deadline is one still ahead: the payouts Banner never names a past one", async () => {
    const { creator, live } = await creatorWithVideo();
    const late = await requestIn(live, "awaiting_approval");
    await overdue(late.id);
    expect(await waitingSummary(creator.id)).toEqual({
      count: 1,
      soonestExpiresAt: null,
    });
    const open = await requestIn(live, "awaiting_approval", {
      expiresAt: inHours(50),
    });
    expect(await waitingSummary(creator.id)).toEqual({
      count: 2,
      soonestExpiresAt: open.expiresAt?.toISOString(),
    });
  });
});

const aDayAgo = () => new Date(Date.now() - DAY_MS);

describe("latestLiveShareUrl (05 §6.3 callout 13)", () => {
  it("links the creator's latest live video, and nothing without one", async () => {
    const creator = await insertCreator();
    await insertRateCard(creator);
    expect(await latestLiveShareUrl(creator)).toBeNull();
    await publishVideo(await readyUpload(creator.id), {
      publishedAt: aDayAgo(),
    });
    const latest = await publishVideo(await readyUpload(creator.id));
    expect(await latestLiveShareUrl(creator)).toMatch(
      new RegExp(`/@${creator.handle}/${latest.slug}$`),
    );
  });

  it("skips a live video no buyer can license, whose license page 404s (owner answer Q-137 a)", async () => {
    const creator = await insertCreator();
    await insertRateCard(creator, ["organic_social"]);
    const older = await publishVideo(await readyUpload(creator.id), {
      publishedAt: aDayAgo(),
    });
    // With Organic social off on the rate card, music's rule (01 J5.14) leaves no use.
    await publishVideo(
      await readyUpload(creator.id, {
        containsMusic: true,
        disabledUses: [...MUSIC_DISABLED_USES],
      }),
    );
    expect(await latestLiveShareUrl(creator)).toMatch(
      new RegExp(`/@${creator.handle}/${older.slug}$`),
    );
  });
});
