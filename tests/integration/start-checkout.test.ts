import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/db/client";
import {
  auditEvent,
  creatorProfile,
  licenseRequest,
  rateCard,
  rateOption,
  video,
} from "../../src/db/schema";
import type { LicenseRequest } from "../../src/db/schema/types";
import { REGION_KEYS } from "../../src/lib/domain/values";
import { DAY_MS } from "../../src/lib/time";
import {
  type StartCheckoutInput,
  StartCheckoutSchema,
} from "../../src/lib/validation/checkout";
import { DEMO_REQUEST } from "../../src/lib/validation/checkout-fixtures";
import { MUSIC_DISABLED_USES } from "../../src/lib/videos/rights";
import { env } from "../../src/server/env";
import { getBuyerRequest } from "../../src/server/licensing/request-status";
import { createLicenseRequest } from "../../src/server/licensing/requests";
import { getAuthorization, retrieveCheckout } from "../../src/server/payments";
import { openFakeCheckout } from "../../src/server/payments/fake-checkout";
import { paymentsDriver } from "../../src/server/payments/registry";
import {
  clientUserAgent,
  type RequestContext,
} from "../../src/server/request-context";
import {
  findRequestForBuyer,
  hashBuyerToken,
} from "../../src/server/tokens/buyer-token";
import {
  insertCreator,
  insertLicenseRequest,
  insertRateCard,
  publishVideo,
} from "../helpers/factories";
import { captureLogEvents } from "../helpers/logs";
import {
  pricedCreator,
  readyLibraryVideo,
  readyUpload,
} from "../helpers/ready-videos";

// startCheckout's domain half (P16a; 02 §5.7; 03 T1; 07 D24, D31, D74, D79, D81, D82, D84, D94, D95; owner answers
// Q-119 a, Q-120 a) on the fake driver and the test database: the server prices every request itself, one row per
// submission, the creator's settings and currency snapshotted, Checkout called only after the commit; and what the
// fake checkout and /r read (owner answer Q-118 a).

const CTX: RequestContext = {
  ip: "203.0.113.7",
  userAgent: "Mozilla/5.0 (test)",
};
const DEMO_TOTAL = DEMO_REQUEST.expectedTotalCents;
const HOLD_MS = 7 * DAY_MS;

afterEach(() => {
  vi.restoreAllMocks();
});

/** The demo request (Paid social ads · 1 year · Worldwide) for `videoId`, through the schema as the action parses it. */
const input = (
  videoId: string,
  change: Record<string, unknown> = {},
): StartCheckoutInput =>
  StartCheckoutSchema.parse({
    ...DEMO_REQUEST,
    videoId,
    submissionId: randomUUID(),
    ...change,
  });

/** Every video this file sells, for the closing currency check (other files share the database). */
const videos: string[] = [];

/** A published upload (no postings) on a creator with onboarding's rate card, `off` options switched off. */
async function liveVideo(off: Parameters<typeof pricedCreator>[0] = []) {
  const { creator } = await pricedCreator(off);
  const live = await publishVideo(await readyUpload(creator.id));
  videos.push(live.id);
  return { creator, live };
}

const requestsOf = (videoId: string) =>
  db.select().from(licenseRequest).where(eq(licenseRequest.videoId, videoId));

async function onlyRequest(videoId: string): Promise<LicenseRequest> {
  const rows = await requestsOf(videoId);
  expect(rows).toHaveLength(1);
  const [row] = rows;
  if (!row) throw new Error("no request");
  return row;
}

const checkoutSpy = () => vi.spyOn(paymentsDriver("cad"), "createCheckout");

const okUrl = (result: Awaited<ReturnType<typeof createLicenseRequest>>) => {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.checkoutUrl;
};

describe("createLicenseRequest: prices (07 D79, D82, D97)", () => {
  it("refuses a tampered total with the server's, and saves nothing", async () => {
    const { live } = await liveVideo();
    const spy = checkoutSpy();
    expect(
      await createLicenseRequest(
        input(live.id, { expectedTotalCents: 100 }),
        CTX,
      ),
    ).toEqual({ ok: false, reason: "price_changed", totalCents: DEMO_TOTAL });
    expect(await requestsOf(live.id)).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("saves the demo request as the server priced it, sealed, snapshotted, then opens Checkout after the commit", async () => {
    const { creator, live } = await liveVideo();
    const spy = checkoutSpy();
    // Checkout must see a committed row: the spy reads it through another connection than the insert's.
    spy.mockImplementation(async function (this: unknown, i) {
      const [row] = await db
        .select({ id: licenseRequest.id })
        .from(licenseRequest)
        .where(eq(licenseRequest.id, i.requestId));
      expect(row?.id).toBe(i.requestId);
      return {
        sessionId: `cs_fake_${i.requestId}`,
        url: `${env.APP_URL}/dev/fake-checkout/${i.requestId}`,
      };
    });
    const url = okUrl(
      await createLicenseRequest(
        input(live.id, { buyerEmail: "  Ana.Buyer@Studio.COM " }),
        CTX,
      ),
    );
    const row = await onlyRequest(live.id);
    expect(url).toBe(`${env.APP_URL}/dev/fake-checkout/${row.id}`);
    expect(row).toMatchObject({
      status: "checkout_pending",
      creatorId: creator.id,
      currency: "cad",
      basePriceCents: 15000,
      useMultiplierBps: 30000,
      termMultiplierBps: 20000,
      territoryMultiplierBps: 17500,
      platformFeeBps: 1000,
      platformFeeMinCents: 200,
      licensePriceCents: 157500,
      platformFeeCents: 15750,
      amountTotalCents: DEMO_TOTAL,
      useKey: "paid_social",
      termKey: "y1",
      territoryKey: "worldwide",
      territoryCode: null,
      licenseeName: "Daily Laughs Media LLC",
      contactName: "Sam Lee",
      buyerEmail: "ana.buyer@studio.com",
      intendedUse: "@dailylaughs on Instagram",
      buyerTimeZone: "America/Toronto",
      termsVersion: "v1",
      termsAcceptedIp: "203.0.113.7",
      termsAcceptedUserAgent: "Mozilla/5.0 (test)",
      approvalWindowHours: 72,
      autoApprove: false,
      stripeCheckoutSessionId: `cs_fake_${row.id}`,
      stripePaymentIntentId: null,
      authorizedAt: null,
    });
    expect(row.buyerTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.buyerTokenEnc.startsWith("v1.")).toBe(true);
    expect(
      (row.checkoutExpiresAt.getTime() - row.createdAt.getTime()) / 60_000,
    ).toBeCloseTo(60, 0);
    // Checkout got the server's amounts in the request's currency, and the key the hash was made from.
    expect(spy).toHaveBeenCalledOnce();
    const sent = spy.mock.calls[0]?.[0];
    expect(sent).toMatchObject({
      currency: "cad",
      requestId: row.id,
      buyerEmail: "ana.buyer@studio.com",
      licensePriceCents: 157500,
      platformFeeCents: 15750,
      licenseLabel: `${live.title} · Paid social ads · 1 year · Worldwide`,
      checkoutExpiresAt: row.checkoutExpiresAt,
    });
    expect(hashBuyerToken(sent?.buyerToken ?? "")).toBe(row.buyerTokenHash);
    // One audit row, ids only.
    const audits = await db
      .select()
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.entityId, row.id),
          eq(auditEvent.action, "license_request.created"),
        ),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorType: "buyer",
      data: { videoId: live.id, creatorId: creator.id },
    });
  });

  it("charges the CA$2.00 fee floor: base CA$10 · Organic · 30 days · One country", async () => {
    const { creator, live } = await liveVideo();
    await db
      .update(rateCard)
      .set({ basePriceCents: 1000 })
      .where(eq(rateCard.creatorId, creator.id));
    okUrl(
      await createLicenseRequest(
        input(live.id, {
          useKey: "organic_social",
          termKey: "d30",
          territoryKey: "country",
          territoryCode: "CA",
          expectedTotalCents: 1200,
        }),
        CTX,
      ),
    );
    expect(await onlyRequest(live.id)).toMatchObject({
      basePriceCents: 1000,
      licensePriceCents: 1000,
      platformFeeCents: 200,
      amountTotalCents: 1200,
    });
  });

  it("prices from a video's own base price and stores it (07 D82)", async () => {
    const { live } = await liveVideo();
    await db
      .update(video)
      .set({ basePriceOverrideCents: 20000 })
      .where(eq(video.id, live.id));
    okUrl(
      await createLicenseRequest(
        input(live.id, { expectedTotalCents: 231000 }),
        CTX,
      ),
    );
    expect(await onlyRequest(live.id)).toMatchObject({
      basePriceCents: 20000,
      licensePriceCents: 210000,
      platformFeeCents: 21000,
      amountTotalCents: 231000,
    });
  });

  it("refuses an option the creator turned off, or the music rule took (07 D82)", async () => {
    const { live } = await liveVideo(["paid_social"]);
    expect(await createLicenseRequest(input(live.id), CTX)).toEqual({
      ok: false,
      reason: "option_disabled",
    });
    const { creator } = await pricedCreator();
    const music = await publishVideo(await readyUpload(creator.id), {
      containsMusic: true,
      disabledUses: [...MUSIC_DISABLED_USES],
    });
    expect(await createLicenseRequest(input(music.id), CTX)).toEqual({
      ok: false,
      reason: "option_disabled",
    });
    expect(await requestsOf(live.id)).toEqual([]);
    expect(await requestsOf(music.id)).toEqual([]);
  });

  it("refuses a total over the cap before the price check, and saves nothing (07 D22)", async () => {
    const { creator, live } = await liveVideo();
    const [card] = await db
      .update(rateCard)
      .set({ basePriceCents: 1_000_000 })
      .where(eq(rateCard.creatorId, creator.id))
      .returning({ id: rateCard.id });
    await db
      .update(rateOption)
      .set({ multiplierBps: 100000 })
      .where(
        and(
          eq(rateOption.rateCardId, card?.id ?? ""),
          inArray(rateOption.optionKey, ["paid_social", "y1", "worldwide"]),
        ),
      );
    expect(await createLicenseRequest(input(live.id), CTX)).toEqual({
      ok: false,
      reason: "over_max",
    });
    expect(await requestsOf(live.id)).toEqual([]);
  });
});

describe("createLicenseRequest: territories (07 D04)", () => {
  it("takes each region, one country and the world", async () => {
    const { live } = await liveVideo();
    const cases = [
      ...REGION_KEYS.map((code) => ({
        territoryKey: "region",
        territoryCode: code,
        expectedTotalCents: 128700,
      })),
      {
        territoryKey: "country",
        territoryCode: "US",
        expectedTotalCents: 99000,
      },
      {
        territoryKey: "worldwide",
        territoryCode: null,
        expectedTotalCents: DEMO_TOTAL,
      },
    ];
    for (const change of cases) {
      okUrl(await createLicenseRequest(input(live.id, change), CTX));
    }
    const rows = await requestsOf(live.id);
    expect(rows.map((r) => r.territoryCode).sort()).toEqual(
      cases.map((c) => c.territoryCode).sort(),
    );
  });
});

describe("createLicenseRequest: one request per submission (07 D31; owner answer Q-120 a)", () => {
  it("returns the same Checkout for the same submission, a double tap included, and saves one row", async () => {
    const { live } = await liveVideo();
    const once = input(live.id);
    const first = okUrl(await createLicenseRequest(once, CTX));
    expect(okUrl(await createLicenseRequest(once, CTX))).toBe(first);
    // The same address padded and in capitals is the same buyer.
    expect(
      okUrl(
        await createLicenseRequest(
          { ...once, buyerEmail: " SAM@DailyLaughs.com " },
          CTX,
        ),
      ),
    ).toBe(first);
    await onlyRequest(live.id);

    const spy = checkoutSpy();
    const twice = input(live.id);
    const results = await Promise.all([
      createLicenseRequest(twice, CTX),
      createLicenseRequest(twice, CTX),
    ]);
    const rows = (await requestsOf(live.id)).filter(
      (r) => r.checkoutSubmissionId === twice.submissionId,
    );
    expect(rows).toHaveLength(1);
    expect(spy).toHaveBeenCalledOnce();
    const urls = results.flatMap((r) => (r.ok ? [r.checkoutUrl] : []));
    expect(urls.length).toBeGreaterThanOrEqual(1);
    expect(new Set(urls).size).toBe(1);
    for (const r of results) {
      if (!r.ok) expect(r.reason).toBe("already_submitted");
    }
  });

  it("says already sent when anything the buyer entered changed, or the request moved on", async () => {
    const { live } = await liveVideo();
    const once = input(live.id);
    okUrl(await createLicenseRequest(once, CTX));
    const changes: Partial<StartCheckoutInput>[] = [
      { buyerEmail: "someone@else.com" },
      { licenseeName: "Another Studio" },
      { contactName: "Pat Lee" },
      { intendedUse: undefined },
      { useKey: "broadcast", expectedTotalCents: DEMO_TOTAL },
    ];
    for (const change of changes) {
      const result = await createLicenseRequest({ ...once, ...change }, CTX);
      // A changed use changes the price first; every other change reaches the submission.
      expect(result).toEqual(
        "useKey" in change
          ? { ok: false, reason: "price_changed", totalCents: 288750 }
          : { ok: false, reason: "already_submitted" },
      );
    }
    await db
      .update(licenseRequest)
      .set({ status: "abandoned", statusReason: "checkout_expired" })
      .where(eq(licenseRequest.checkoutSubmissionId, once.submissionId));
    expect(await createLicenseRequest(once, CTX)).toEqual({
      ok: false,
      reason: "already_submitted",
    });
    await onlyRequest(live.id);
  });

  it("keeps the submission when its Checkout can't be read, so a retry finds the same one (07 D31)", async () => {
    const { live } = await liveVideo();
    const once = input(live.id);
    const first = okUrl(await createLicenseRequest(once, CTX));
    vi.spyOn(paymentsDriver("cad"), "retrieveCheckout").mockRejectedValueOnce(
      new Error("stripe down"),
    );
    await expect(createLicenseRequest(once, CTX)).rejects.toThrow(
      "stripe down",
    );
    expect(okUrl(await createLicenseRequest(once, CTX))).toBe(first);
    await onlyRequest(live.id);
  });
});

describe("createLicenseRequest: who can buy (07 D51, D72, D74)", () => {
  it("takes a request whatever the creator's payouts (none set up, no Stripe account)", async () => {
    const { creator, live } = await liveVideo();
    const [owner] = await db
      .select({
        payoutsStatus: creatorProfile.payoutsStatus,
        stripeAccountId: creatorProfile.stripeAccountId,
      })
      .from(creatorProfile)
      .where(eq(creatorProfile.id, creator.id));
    expect(owner).toEqual({
      payoutsStatus: "not_started",
      stripeAccountId: null,
    });
    const url = okUrl(await createLicenseRequest(input(live.id), CTX));
    expect(url).toMatch(/\/dev\/fake-checkout\/[0-9a-f-]{36}$/);
  });

  it("refuses a video that isn't published, or has a Demo posting while Demo is off", async () => {
    const { live } = await liveVideo();
    for (const status of ["draft", "unpublished", "disabled"] as const) {
      await db.update(video).set({ status }).where(eq(video.id, live.id));
      expect(await createLicenseRequest(input(live.id), CTX)).toEqual({
        ok: false,
        reason: "not_available",
      });
    }
    const { creator } = await pricedCreator();
    const demo = await publishVideo(await readyLibraryVideo(creator.id));
    expect(await createLicenseRequest(input(demo.id), CTX, [])).toEqual({
      ok: false,
      reason: "not_available",
    });
    okUrl(await createLicenseRequest(input(demo.id), CTX, ["mock"]));
    expect(await requestsOf(live.id)).toEqual([]);
  });
});

describe("createLicenseRequest: snapshots (07 D81, D84)", () => {
  it("keeps the buyer's zone when it is one, else UTC", async () => {
    const { live } = await liveVideo();
    for (const timeZone of ["Bogus/Zone", undefined]) {
      okUrl(await createLicenseRequest(input(live.id, { timeZone }), CTX));
    }
    const zones = (await requestsOf(live.id)).map((r) => r.buyerTimeZone);
    expect(zones).toEqual(["UTC", "UTC"]);
  });

  it("snapshots the creator's approval window and auto-approve; a later change leaves the request as it was", async () => {
    const { creator, live } = await liveVideo();
    await db
      .update(creatorProfile)
      .set({ approvalWindowHours: 48, autoApprove: true })
      .where(eq(creatorProfile.id, creator.id));
    okUrl(await createLicenseRequest(input(live.id), CTX));
    await db
      .update(creatorProfile)
      .set({ approvalWindowHours: 120, autoApprove: false })
      .where(eq(creatorProfile.id, creator.id));
    expect(await onlyRequest(live.id)).toMatchObject({
      approvalWindowHours: 48,
      autoApprove: true,
    });
  });

  it("stores no IP when there is none, and a long agent as requestContext cuts it, 512 characters", async () => {
    const { live } = await liveVideo();
    okUrl(
      await createLicenseRequest(input(live.id), {
        ip: null,
        userAgent: clientUserAgent("x".repeat(600)),
      }),
    );
    const row = await onlyRequest(live.id);
    expect(row.termsAcceptedIp).toBeNull();
    expect(row.termsAcceptedUserAgent).toHaveLength(512);
  });
});

describe("createLicenseRequest: a failed Checkout (07 D57)", () => {
  it("leaves the request in checkout with no session, says so, and logs neither the key nor the email", async () => {
    const { live } = await liveVideo();
    checkoutSpy().mockRejectedValueOnce(new Error("stripe down"));
    const logs = captureLogEvents("license_request.checkout_failed");
    const result = await createLicenseRequest(input(live.id), CTX);
    const { written, events } = logs();
    expect(result).toEqual({ ok: false, reason: "checkout_failed" });
    const row = await onlyRequest(live.id);
    expect(row).toMatchObject({
      status: "checkout_pending",
      stripeCheckoutSessionId: null,
    });
    expect(events).toHaveLength(1);
    expect(written).not.toContain("dailylaughs");
    expect(written).not.toContain(row.buyerTokenEnc);
  });
});

describe("the fake driver's view of a request (07 D35, D74, D76; owner answer Q-119 a)", () => {
  it("is an open session and a hold for a request in checkout, a platform charge in the request's currency", async () => {
    const { live } = await liveVideo();
    const spy = checkoutSpy();
    okUrl(await createLicenseRequest(input(live.id), CTX));
    const row = await onlyRequest(live.id);
    await expect(
      retrieveCheckout("cad", `cs_fake_${row.id}`),
    ).resolves.toMatchObject({
      status: "open",
      url: `${env.APP_URL}/dev/fake-checkout/${row.id}`,
      requestId: row.id,
      paymentIntentId: `pi_fake_${row.id}`,
      amountTotalCents: DEMO_TOTAL,
      currency: "cad",
    });
    const hold = await getAuthorization("cad", `pi_fake_${row.id}`);
    expect(hold).toMatchObject({
      status: "requires_capture",
      amountCents: DEMO_TOTAL,
      currency: "cad",
      applicationFeeCents: null,
      destination: null,
      transferGroup: `license-request:${row.id}`,
      onBehalfOf: null,
      chargeId: `ch_fake_${row.id}`,
      captureMethod: "manual",
      metadataRequestId: row.id,
      requestId: row.id,
      amountRefundedCents: 0,
    });
    expect(
      (hold.captureBefore?.getTime() ?? 0) -
        (hold.authorizedAt?.getTime() ?? 0),
    ).toBe(HOLD_MS);
    // The key Checkout got opens the request; any other doesn't.
    const token = spy.mock.calls[0]?.[0].buyerToken ?? "";
    expect((await findRequestForBuyer(row.id, token))?.id).toBe(row.id);
    expect(await findRequestForBuyer(row.id, "A".repeat(43))).toBeNull();
    expect(await findRequestForBuyer(row.id, "short")).toBeNull();
    expect(await findRequestForBuyer("not-a-uuid", token)).toBeNull();
  });

  it("follows the request's status after checkout", async () => {
    const { live } = await liveVideo();
    const authorizedAt = new Date("2026-10-20T12:00:00Z");
    const cases = [
      {
        status: "awaiting_approval",
        pi: "requires_capture",
        session: "complete",
      },
      { status: "approved", pi: "succeeded", session: "complete" },
      { status: "declined", pi: "canceled", session: "complete" },
      { status: "expired", pi: "canceled", session: "complete" },
      { status: "capture_failed", pi: "canceled", session: "complete" },
      { status: "abandoned", pi: "canceled", session: "complete" },
    ] as const;
    for (const c of cases) {
      const id = randomUUID();
      await insertLicenseRequest(live, {
        id,
        status: c.status,
        stripePaymentIntentId: `pi_fake_${id}`,
        authorizedAt,
      });
      await expect(
        retrieveCheckout("cad", `cs_fake_${id}`),
      ).resolves.toMatchObject({ status: c.session, url: null });
      await expect(
        getAuthorization("cad", `pi_fake_${id}`),
      ).resolves.toMatchObject({
        status: c.pi,
        authorizedAt,
        captureBefore: new Date(authorizedAt.getTime() + HOLD_MS),
      });
    }
    // A checkout that expired never had a payment.
    const expired = randomUUID();
    await insertLicenseRequest(live, {
      id: expired,
      status: "abandoned",
      statusReason: "checkout_expired",
    });
    await expect(
      retrieveCheckout("cad", `cs_fake_${expired}`),
    ).resolves.toMatchObject({ status: "expired", url: null });
    await expect(getAuthorization("cad", `pi_fake_${expired}`)).rejects.toThrow(
      "never had a payment",
    );
    await expect(
      getAuthorization("cad", `pi_fake_${randomUUID()}`),
    ).rejects.toThrow("unknown request");
  });
});

describe("the buyer's pages: the fake checkout and /r (05 §4.3, §10; owner answer Q-118 a)", () => {
  it("opens the fake checkout on the request's snapshot, returning to the buyer's own link, which /r opens", async () => {
    const { creator, live } = await liveVideo();
    okUrl(await createLicenseRequest(input(live.id), CTX));
    const row = await onlyRequest(live.id);
    const checkout = await openFakeCheckout(row.id);
    expect(checkout).toMatchObject({
      id: row.id,
      status: "checkout_pending",
      sessionId: `cs_fake_${row.id}`,
      title: live.title,
      scope: "Paid social ads · 1 year · Worldwide",
      currency: "cad",
      licensePriceCents: 157500,
      platformFeeCents: 15750,
      amountTotalCents: DEMO_TOTAL,
    });
    const back =
      /^\/r\/([0-9a-f-]{36})\?t=([A-Za-z0-9_-]{43})&checkout=canceled$/.exec(
        checkout?.returnPath({ checkout: "canceled" }) ?? "",
      );
    expect(back?.[1]).toBe(row.id);
    const token = back?.[2] ?? "";
    expect(hashBuyerToken(token)).toBe(row.buyerTokenHash);
    // Every field /r gets, and nothing else: no email, key, IP or Stripe id (07 D47; 02 §9.11).
    expect(await getBuyerRequest(row.id, token)).toEqual({
      id: row.id,
      status: "checkout_pending",
      displayStatus: "checkout_pending",
      statusReason: null,
      useKey: "paid_social",
      termKey: "y1",
      territoryKey: "worldwide",
      territoryCode: null,
      licensePriceCents: 157500,
      amountTotalCents: DEMO_TOTAL,
      currency: "cad",
      expiresAt: null,
      videoId: live.id,
      title: live.title,
      posterUrl: expect.stringMatching(
        new RegExp(`^/api/media/posters/${live.id}\\?v=[0-9a-f]{8}$`),
      ),
      handle: creator.handle,
      slug: live.slug,
      licenseCode: null,
    });
    expect(await getBuyerRequest(row.id, "A".repeat(43))).toBeNull();
    expect(await getBuyerRequest(randomUUID(), token)).toBeNull();
  });

  it("has no fake checkout for a request whose Checkout never opened, an unknown or malformed id, or outside development and test", async () => {
    const { live } = await liveVideo();
    checkoutSpy().mockRejectedValueOnce(new Error("stripe down"));
    await createLicenseRequest(input(live.id), CTX);
    expect(await openFakeCheckout((await onlyRequest(live.id)).id)).toBeNull();
    expect(await openFakeCheckout(randomUUID())).toBeNull();
    expect(await openFakeCheckout("not-a-uuid")).toBeNull();
    const { live: other } = await liveVideo();
    okUrl(await createLicenseRequest(input(other.id), CTX));
    const { id } = await onlyRequest(other.id);
    const before = env.APP_ENV;
    env.APP_ENV = "preview";
    try {
      expect(await openFakeCheckout(id)).toBeNull();
    } finally {
      env.APP_ENV = before;
    }
    expect(await openFakeCheckout(id)).not.toBeNull();
  });
});

// The last case that looks up a driver: the USD one stays memoized once looked up.
describe("createLicenseRequest: another currency's account (07 D94, D95)", () => {
  it("prices and saves in the creator's currency, on that currency's driver only", async () => {
    const before = env.ENABLED_CURRENCIES;
    env.ENABLED_CURRENCIES = ["cad", "usd"];
    try {
      await expect(
        paymentsDriver("cad").createCheckout({
          currency: "usd",
          requestId: randomUUID(),
          buyerToken: "t",
          buyerEmail: "sam@dailylaughs.com",
          licensePriceCents: 157500,
          platformFeeCents: 15750,
          licenseLabel: "x",
          checkoutExpiresAt: new Date(),
        }),
      ).rejects.toThrow("a usd checkout on the cad account");
      const creator = await insertCreator({ payoutCurrency: "usd" });
      await insertRateCard(creator);
      const live = await publishVideo(await readyUpload(creator.id));
      videos.push(live.id);
      okUrl(await createLicenseRequest(input(live.id), CTX));
      const row = await onlyRequest(live.id);
      expect(row).toMatchObject({
        currency: "usd",
        licensePriceCents: 157500,
        platformFeeCents: 15750,
        amountTotalCents: DEMO_TOTAL,
        platformFeeMinCents: 200,
      });
      await expect(
        getAuthorization("usd", `pi_fake_${row.id}`),
      ).resolves.toMatchObject({ currency: "usd" });
      // Each account knows only its own requests, as Stripe's do.
      await expect(
        getAuthorization("cad", `pi_fake_${row.id}`),
      ).rejects.toThrow("a usd request on the cad account");
      await expect(
        retrieveCheckout("cad", `cs_fake_${row.id}`),
      ).rejects.toThrow("a usd request on the cad account");
    } finally {
      env.ENABLED_CURRENCIES = before;
    }
  });
});

// After every case above: no request this file saved is priced in another currency than its creator's (03 I33).
describe("every request's currency (03 I33, 07 D94)", () => {
  it("is its creator's payout currency", async () => {
    const rows = await db
      .select({
        currency: licenseRequest.currency,
        payoutCurrency: creatorProfile.payoutCurrency,
      })
      .from(licenseRequest)
      .innerJoin(
        creatorProfile,
        eq(creatorProfile.id, licenseRequest.creatorId),
      )
      .where(inArray(licenseRequest.videoId, videos));
    expect(rows.length).toBeGreaterThan(30);
    for (const row of rows) expect(row.currency).toBe(row.payoutCurrency);
  });
});
