import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { runSeed } from "../../../scripts/seed";
import { db } from "../../../src/db/client";
import { auditEvent, creatorProfile, user } from "../../../src/db/schema";
import { resetDb } from "../../helpers/db";
import { insertUser } from "../../helpers/factories";

// `bun run db:seed` (03 §8.1, 07 D53, D88) with .env.test's ADMIN_EMAILS: e2e-admin@example.com, e2e-admin-2@example.com.
beforeEach(resetDb);

const seed = () => runSeed({ appEnv: "test", demo: false });

async function counts() {
  const [users] = await db.select({ value: count() }).from(user);
  const [audits] = await db.select({ value: count() }).from(auditEvent);
  return { users: users.value, audits: audits.value };
}

describe("db:seed", () => {
  it("creates seed_user_admin with the first listed address when no listed user exists", async () => {
    expect(await seed()).toEqual({ promoted: 0, created: true });
    const [admin] = await db.select().from(user);
    expect(admin).toMatchObject({
      id: "seed_user_admin",
      email: "e2e-admin@example.com",
      emailVerified: true,
      role: "admin",
      name: "",
    });
    expect(await db.select().from(creatorProfile)).toHaveLength(0);
  });

  it("promotes a listed user who signed in before being listed, and creates no one", async () => {
    const helper = await insertUser({
      email: "e2e-admin-2@example.com",
      role: "creator",
    });
    const other = await insertUser();
    expect(await seed()).toEqual({ promoted: 1, created: false });
    const rows = await db.select().from(user);
    expect(rows.map((r) => [r.id, r.role]).sort()).toEqual(
      [
        [helper.id, "admin"],
        [other.id, "creator"],
      ].sort(),
    );
  });

  it("writes one system seed.applied row with counts only", async () => {
    await insertUser({ email: "e2e-admin@example.com", role: "creator" });
    await seed();
    const audits = await db.select().from(auditEvent);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorType: "system",
      actorUserId: null,
      action: "seed.applied",
      entityType: "user",
      data: { promoted: 1, created: false, source: "seed" },
    });
    expect(JSON.stringify(audits[0].data)).not.toContain("@");
  });

  it("changes nothing on a second run", async () => {
    await insertUser({ email: "e2e-admin@example.com", role: "creator" });
    await seed();
    const before = await db.select().from(user);
    const auditsBefore = await counts();
    expect(await seed()).toEqual({ promoted: 0, created: false });
    expect(await db.select().from(user)).toEqual(before);
    expect(await counts()).toEqual(auditsBefore);
  });

  it("refuses when seed_user_admin holds an address that is no longer listed", async () => {
    await insertUser({ id: "seed_user_admin", email: "old-owner@example.com" });
    await expect(seed()).rejects.toThrow(/seed_user_admin exists/);
    const [row] = await db
      .select()
      .from(user)
      .where(eq(user.id, "seed_user_admin"));
    expect(row.email).toBe("old-owner@example.com");
  });

  it("refuses APP_ENV=production and --demo without writing", async () => {
    const before = await counts();
    await expect(
      runSeed({ appEnv: "production", demo: false }),
    ).rejects.toThrow(/APP_ENV=production/);
    await expect(runSeed({ appEnv: "test", demo: true })).rejects.toThrow(
      "--demo is not built yet",
    );
    expect(await counts()).toEqual(before);
  });
});
