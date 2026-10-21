import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { ensureConnectedAccount } from "../../../src/server/payments/connect";
import { paymentsDriver } from "../../../src/server/payments/registry";
import { resetDb } from "../../helpers/db";
import { insertCreator } from "../../helpers/factories";
import { captureLogEvents } from "../../helpers/logs";

// 07 D139's failure row is best effort too: when writing it fails, the creator still gets the account. A file of its
// own, because the audit module is mocked for the whole file (every other audit row is still written for real).
vi.mock("../../../src/server/audit", async (importOriginal) => {
  const audit =
    await importOriginal<typeof import("../../../src/server/audit")>();
  return {
    ...audit,
    writeAudit: vi.fn<typeof audit.writeAudit>(async (exec, actor, entry) => {
      if (entry.action === "connect.negative_balance_debits_failed") {
        throw new Error("Failed query: insert into audit_event");
      }
      await audit.writeAudit(exec, actor, entry);
    }),
  };
});

afterAll(resetDb);
afterEach(() => vi.restoreAllMocks());

describe("ensureConnectedAccount when the debits failure row can't be written", () => {
  it("still returns the stored account and logs the failed write by its class only", async () => {
    vi.spyOn(
      paymentsDriver("cad"),
      "enableNegativeBalanceDebits",
    ).mockResolvedValue({ ok: false, kind: "transient", code: "rate_limited" });
    const creator = await insertCreator();
    const logged = captureLogEvents(
      "connect.negative_balance_debits_audit_failed",
    );

    const accountId = await ensureConnectedAccount(creator.id);
    const { written, events } = logged();
    expect(accountId).toBe(`acct_fake_${creator.id}`);
    expect(events).toEqual([
      {
        ts: expect.any(String),
        level: "warn",
        event: "connect.negative_balance_debits_audit_failed",
        creatorId: creator.id,
        error: "Error",
      },
    ]);
    expect(written).not.toContain("Failed query");
  });
});
