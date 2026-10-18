import { describe, expect, it } from "vitest";
import { type AuditExecutor, auditActorType, writeAudit } from "./audit";
import type { Actor } from "./auth/actor";

/** An executor that records what would be inserted, without a database. */
function recorder() {
  const rows: unknown[] = [];
  const exec = {
    insert: () => ({
      values: async (row: unknown) => {
        rows.push(row);
      },
    }),
  } as unknown as AuditExecutor;
  return { exec, rows };
}

describe("auditActorType (07 D47)", () => {
  it.each<[Actor, ReturnType<typeof auditActorType>]>([
    [
      { kind: "creator", userId: "u1", creatorId: "c1" },
      { actorType: "creator", actorUserId: "u1" },
    ],
    [
      { kind: "admin", userId: "u2" },
      { actorType: "admin", actorUserId: "u2" },
    ],
    [
      { kind: "buyer", requestId: "r1" },
      { actorType: "buyer", actorUserId: null },
    ],
    [
      { kind: "buyer_user", userId: "u3", email: "sam@example.com" },
      { actorType: "buyer", actorUserId: "u3" },
    ],
    [
      { kind: "system", source: "webhook" },
      { actorType: "stripe", actorUserId: null },
    ],
    [
      { kind: "system", source: "cron" },
      { actorType: "cron", actorUserId: null },
    ],
    [
      { kind: "system", source: "seed" },
      { actorType: "system", actorUserId: null, source: "seed" },
    ],
    [
      { kind: "system", source: "auto_approve" },
      { actorType: "system", actorUserId: null, source: "auto_approve" },
    ],
    [
      { kind: "system", source: "renewals" },
      { actorType: "system", actorUserId: null, source: "renewals" },
    ],
    [
      { kind: "system", source: "lazy" },
      { actorType: "system", actorUserId: null, source: "lazy" },
    ],
    [
      { kind: "system", source: "return_url" },
      { actorType: "system", actorUserId: null, source: "return_url" },
    ],
  ])("%j → %j", (actor, want) => {
    expect(auditActorType(actor)).toEqual(want);
  });
});

describe("writeAudit", () => {
  it("refuses an action that isn't scope.action before inserting", async () => {
    const { exec, rows } = recorder();
    await expect(
      writeAudit(
        exec,
        { kind: "system", source: "seed" },
        {
          action: "Seed Applied",
          entityType: "user",
          entityId: "x",
        },
      ),
    ).rejects.toThrow(/scope\.action/);
    expect(rows).toEqual([]);
  });

  it("puts a system source in data.source and redacts emails and secrets from data", async () => {
    const { exec, rows } = recorder();
    await writeAudit(
      exec,
      { kind: "system", source: "seed" },
      {
        action: "seed.applied",
        entityType: "user",
        entityId: "seed_user_admin",
        data: { promoted: 1, email: "owner@example.com", token: "t" },
      },
    );
    expect(rows).toEqual([
      {
        actorType: "system",
        actorUserId: null,
        action: "seed.applied",
        entityType: "user",
        entityId: "seed_user_admin",
        data: {
          promoted: 1,
          email: "[redacted]",
          token: "[redacted]",
          source: "seed",
        },
      },
    ]);
  });

  it("keeps a `code` key (license codes, P18) while still redacting otp, tokens and emails", async () => {
    const { exec, rows } = recorder();
    await writeAudit(
      exec,
      { kind: "admin", userId: "u2" },
      {
        action: "license.issued",
        entityType: "license",
        entityId: "l1",
        data: {
          code: "CL-7K3M-9QXA",
          otp: "482913",
          refreshToken: "t",
          note: "sent to sam@example.com",
        },
      },
    );
    expect(rows[0]).toMatchObject({
      data: {
        code: "CL-7K3M-9QXA",
        otp: "[redacted]",
        refreshToken: "[redacted]",
        note: "sent to [email]",
      },
    });
  });
});
