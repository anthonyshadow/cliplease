import { describe, expect, it } from "vitest";
import { createFakeDriver } from "./fake-driver";

// The fake's creator transfer (07 D35, D75): stateless, `tr_fake_` + the request id whatever the key, and nothing read or
// written (the caller records it on the money_movement row; findTransfers reads it back, in [int]).

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
