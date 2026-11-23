import { describe, expect, it } from "vitest";
import { createFakeDriver } from "./fake-driver";

// The fake's creator transfer (07 D35, D75): stateless, `tr_fake_` + the request id whatever the key, and nothing read or
// written (the caller records it on the money_movement row; findTransfers reads it back, in [int]). Its refund and
// reversal (07 D76, D86) check the request's account first (07 D95), so only what they refuse before any query is unit
// tested here; revoke-refund's [int] covers their answers and what getAuthorization and findTransfers derive from rows.

const REQUEST = "6f4c8d7e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const fake = createFakeDriver({
  currency: "cad",
  appUrl: "http://localhost:3000",
});

const transferTo = (requestId: string, idempotencyKey: string) =>
  fake.createTransfer({
    requestId,
    chargeId: `ch_fake_${requestId}`,
    destinationAccountId: "acct_fake_x",
    amountCents: 157500,
    idempotencyKey,
  });

describe("fake createTransfer (07 D35, D75)", () => {
  it("answers tr_fake_<requestId> under any key", async () => {
    for (const key of [`transfer:${REQUEST}:1`, `transfer:${REQUEST}:2`]) {
      await expect(transferTo(REQUEST, key)).resolves.toEqual({
        ok: true,
        transferId: `tr_fake_${REQUEST}`,
      });
    }
  });

  it("refuses an id that isn't a request's, before anything else", async () => {
    await expect(transferTo("r1", "transfer:r1:1")).rejects.toThrow(
      "not a request id",
    );
  });
});

describe("fake refund and reverseTransfer (07 D76, D86, D95)", () => {
  const OTHER = "0b8f4c1e-6a2d-4e8b-9f3a-5c7d1e2f3a4b";

  it("refuses a PaymentIntent that isn't the request's, before reading anything", async () => {
    for (const paymentIntentId of [
      `pi_fake_${OTHER}`,
      "pi_1",
      `cs_fake_${REQUEST}`,
    ]) {
      await expect(
        fake.refund({
          requestId: REQUEST,
          paymentIntentId,
          idempotencyKey: `refund:${REQUEST}:1`,
        }),
      ).rejects.toThrow(/not the request's PaymentIntent|unknown pi_fake id/);
    }
  });

  it("refuses a reversal for an id that isn't a request's, before reading anything", async () => {
    await expect(
      fake.reverseTransfer({
        requestId: "r1",
        transferId: "tr_fake_r1",
        idempotencyKey: "transfer-reversal:r1:1",
      }),
    ).rejects.toThrow("not a request id");
  });
});
