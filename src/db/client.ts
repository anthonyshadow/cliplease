// The database client (03 §3.0, stack.md fact 30). Plain-Node CLIs (the Better Auth CLI, tsx scripts) load it as well as
// Next, so it uses relative imports only and no server guard import (ADR-34, 07 D06). Never import it from client code.
import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { formatLogLine } from "../lib/log-line";
import { env } from "../server/env";
import * as schema from "./schema";

/**
 * How long a query waits for a connection (a free one, or a new one to Neon) before failing, instead of waiting until
 * the function is stopped with its leases held. Above a cold Neon start's few seconds.
 */
export const POOL_CONNECT_TIMEOUT_MS = 10_000;

/** The pooled connection (Neon's PgBouncer). drizzle-kit migrates through DATABASE_URL_UNPOOLED instead. */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  // pg-pool's default, written out: at most this many connections per instance.
  max: 10,
  connectionTimeoutMillis: POOL_CONNECT_TIMEOUT_MS,
});
// On Vercel it closes idle connections before a function suspends; elsewhere it only adds a `release` listener.
attachDatabasePool(pool);
// An idle client's connection dropped (a Neon restart or suspend, a network blip). pg-pool has already removed the
// client; without a listener the 'error' event would crash the process, so only log it.
pool.on("error", (error) => {
  process.stderr.write(
    formatLogLine("warn", "db.idle_client_error", {
      error,
      pgCode:
        "code" in error && typeof error.code === "string"
          ? error.code
          : undefined,
    }),
  );
});

export const db = drizzle({ client: pool, schema });

/** A transaction's handle, as db.transaction passes it: code that must run inside one (a FOR UPDATE lock) takes this. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
