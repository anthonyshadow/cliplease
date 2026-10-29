import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { POOL_CONNECT_TIMEOUT_MS, pool } from "../../../src/db/client";
import { captureLogEvents } from "../../helpers/logs";

describe("the database pool (src/db/client.ts)", () => {
  it("fails a query that can't get a connection within the timeout, instead of waiting for one forever", async () => {
    const held: PoolClient[] = [];
    try {
      for (let i = 0; i < pool.options.max; i += 1) {
        held.push(await pool.connect());
      }
      // Only the pool's wait runs on fake time: every connection is already open.
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const waiting = pool.query("select 1");
      const failed = expect(waiting).rejects.toThrow(/timeout/i);
      vi.advanceTimersByTime(POOL_CONNECT_TIMEOUT_MS - 1);
      let settled = false;
      void waiting.catch(() => {}).finally(() => (settled = true));
      await Promise.resolve();
      expect(settled).toBe(false);
      vi.advanceTimersByTime(1);
      await failed;
    } finally {
      vi.useRealTimers();
      for (const client of held) client.release();
    }
    expect((await pool.query("select 1 as one")).rows[0]?.one).toBe(1);
  });

  it("logs an idle client's error as one warn line instead of crashing, and keeps answering", async () => {
    const stop = captureLogEvents("db.idle_client_error");
    // What pg-pool emits when Neon closes an idle connection (57P01 admin_shutdown).
    const error = Object.assign(
      new Error("terminating connection due to administrator command"),
      { code: "57P01" },
    );
    expect(() => pool.emit("error", error, undefined)).not.toThrow();
    const { events } = stop();
    expect(events).toEqual([
      expect.objectContaining({
        level: "warn",
        event: "db.idle_client_error",
        pgCode: "57P01",
        error: {
          name: "Error",
          message: "terminating connection due to administrator command",
        },
      }),
    ]);
    const result = await pool.query<{ one: number }>("select 1 as one");
    expect(result.rows[0]?.one).toBe(1);
  });
});
