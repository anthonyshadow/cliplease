import { describe, expect, it } from "vitest";
import { pool } from "../../../src/db/client";
import { captureLogEvents } from "../../helpers/logs";

describe("the database pool (src/db/client.ts)", () => {
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
