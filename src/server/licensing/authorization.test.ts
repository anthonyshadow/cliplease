import { describe, expect, it } from "vitest";
import type { Authorization } from "../payments/driver";
import { transferGroupFor } from "../payments/keys";
import { authorizationMismatches } from "./authorization";

const row = {
  id: "7f6b5a3e-2d1c-4b0a-9e8f-1a2b3c4d5e6f",
  amountTotalCents: 173250,
  currency: "cad",
} as const;

const held: Authorization = {
  paymentIntentId: `pi_fake_${row.id}`,
  status: "requires_capture",
  amountCents: 173250,
  currency: "cad",
  applicationFeeCents: null,
  destination: null,
  transferGroup: transferGroupFor(row.id),
  onBehalfOf: null,
  chargeId: `ch_fake_${row.id}`,
  riskLevel: "normal",
  amountRefundedCents: 0,
  captureMethod: "manual",
  metadataRequestId: row.id,
  authorizedAt: new Date("2026-10-27T10:00:00Z"),
  captureBefore: new Date("2026-11-03T10:00:00Z"),
  requestId: row.id,
};

describe("authorizationMismatches (07 D32, D74, D95)", () => {
  it("passes the request's own hold", () => {
    expect(authorizationMismatches(row, held, "cad")).toEqual([]);
  });

  it.each([
    ["amountCents", { amountCents: 173251 }],
    ["currency", { currency: "usd" }],
    ["captureMethod", { captureMethod: "automatic" as const }],
    ["metadataRequestId", { metadataRequestId: null }],
    ["applicationFeeCents", { applicationFeeCents: 0 }],
    ["destination", { destination: "acct_123" }],
    ["onBehalfOf", { onBehalfOf: "acct_123" }],
    ["transferGroup", { transferGroup: "license-request:other" }],
  ])("names %s alone when only it is wrong", (field, change) => {
    expect(authorizationMismatches(row, { ...held, ...change }, "cad")).toEqual(
      [field],
    );
  });

  it.each(["usd", null])("names a session in %s", (sessionCurrency) => {
    expect(authorizationMismatches(row, held, sessionCurrency)).toEqual([
      "sessionCurrency",
    ]);
  });

  it("names every wrong field", () => {
    expect(
      authorizationMismatches(
        row,
        { ...held, amountCents: 1, destination: "acct_123" },
        "usd",
      ),
    ).toEqual(["amountCents", "sessionCurrency", "destination"]);
  });
});
