// The database client (03 §3.0, stack.md fact 30). Plain-Node CLIs (the Better Auth CLI, tsx scripts) load it as well as
// Next, so it uses relative imports only and no server guard import (ADR-34, 07 D06). Never import it from client code.
import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../server/env";
import * as schema from "./schema";

/** The pooled connection (Neon's PgBouncer). drizzle-kit migrates through DATABASE_URL_UNPOOLED instead. */
export const pool = new Pool({ connectionString: env.DATABASE_URL });
// On Vercel it closes idle connections before a function suspends; elsewhere it only adds a `release` listener.
attachDatabasePool(pool);

export const db = drizzle({ client: pool, schema });
