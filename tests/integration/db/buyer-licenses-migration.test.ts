import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pool } from "../../../src/db/client";
import { PG_ERROR } from "../../helpers/db";
import {
  insertCreator,
  insertLicenseRequest,
  insertUploadVideo,
} from "../../helpers/factories";

// 0004_buyer_licenses (P20b): the hand-added backfill, then the generated index and CHECK. The test database is empty
// when it migrates, so the backfill is proven here by replaying the file on a table that has a row (the P19f precedent).

const MIGRATION = readFileSync("drizzle/0004_buyer_licenses.sql", "utf8");
const STATEMENTS = MIGRATION.split("--> statement-breakpoint");
const CONSTRAINT = "license_request_buyer_email_lower";
const INDEX = "license_request_buyer_email_created_idx";

describe("0004_buyer_licenses", () => {
  it("lowercases and trims an existing email, then adds the CHECK and the index", async () => {
    const creator = await insertCreator();
    const row = await insertLicenseRequest(await insertUploadVideo(creator));
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `alter table license_request drop constraint ${CONSTRAINT}`,
      );
      await client.query(`drop index ${INDEX}`);
      await client.query(
        "update license_request set buyer_email = '  Ana.Buyer@Studio.COM ' where id = $1",
        [row.id],
      );
      for (const statement of STATEMENTS) {
        await client.query(statement);
      }
      const { rows } = await client.query<{ email: string }>(
        "select buyer_email as email from license_request where id = $1",
        [row.id],
      );
      expect(rows).toEqual([{ email: "ana.buyer@studio.com" }]);
      const { rows: objects } = await client.query<{ name: string }>(
        `select conname as name from pg_constraint where conname = $1
         union all select indexname from pg_indexes where indexname = $2`,
        [CONSTRAINT, INDEX],
      );
      expect(objects.map((o) => o.name).sort()).toEqual(
        [CONSTRAINT, INDEX].sort(),
      );
      await expect(
        client.query(
          "update license_request set buyer_email = 'Ana@Studio.com' where id = $1",
          [row.id],
        ),
      ).rejects.toMatchObject({ code: PG_ERROR.check, constraint: CONSTRAINT });
      await client.query("rollback");
    } finally {
      // Closed, not pooled: after a failure its transaction may still be open.
      client.release(true);
    }
  });

  it("starts with the backfill and adds only one CHECK and one index", () => {
    expect(STATEMENTS).toHaveLength(3);
    expect(STATEMENTS[0]).toMatch(
      /^UPDATE "license_request" SET "buyer_email"/,
    );
    expect(MIGRATION.match(/ADD CONSTRAINT/g)).toHaveLength(1);
    expect(MIGRATION.match(/CREATE INDEX/g)).toHaveLength(1);
    expect(MIGRATION).toContain('"created_at" DESC NULLS FIRST');
    expect(MIGRATION).not.toMatch(
      /ADD COLUMN|CREATE TYPE|ALTER TYPE|\bDROP\b|\$1/i,
    );
  });
});
