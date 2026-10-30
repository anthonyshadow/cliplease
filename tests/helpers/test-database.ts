import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { type ClientBase, escapeIdentifier } from "pg";
import ConnectionParameters from "pg/lib/connection-parameters";

export type DatabaseEnv = {
  APP_ENV?: string;
  DATABASE_URL?: string;
  DATABASE_URL_UNPOOLED?: string;
};

/**
 * The database pg connects to for `url`, read by pg's own parser (query parameters such as `host` included), without
 * credentials: host (a pooled and a direct URL share one Neon endpoint), port and name. The message never includes the
 * URL, which carries the password.
 */
function databaseOf(url: string, key: string): string {
  let params: ConnectionParameters;
  try {
    params = new ConnectionParameters(url);
  } catch {
    throw new Error(`${key} is not a valid URL`);
  }
  const host = (params.host ?? "")
    .toLowerCase()
    .replace(/\.$/, "")
    .replace("-pooler.", ".");
  return `${host}:${params.port}/${params.database}`;
}

/**
 * The env files at `paths` parsed with node:util, later files winning; a missing file adds nothing. Blank values stay: a
 * blank key still stops `next start` from filling it from .env.local.
 */
export function readEnvFiles(paths: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const path of paths) {
    if (!existsSync(path)) continue;
    for (const [key, value] of Object.entries(
      parseEnv(readFileSync(path, "utf8")),
    )) {
      if (value !== undefined) values[key] = value;
    }
  }
  return values;
}

/**
 * Throws unless `env` is the test environment, its database is the one `.env.test` names (`fileEnv`: .env.test and
 * .env.test.local as read from the files, so a DATABASE_URL exported in the shell can't redirect the run) and it is
 * neither of `.env.local`'s (`localEnvText` is that file's text, or undefined when it doesn't exist). Pure: no
 * connection, no file access.
 */
export function checkTestDatabase(
  env: DatabaseEnv,
  localEnvText: string | undefined,
  fileEnv: DatabaseEnv,
): void {
  function refuse(why: string): never {
    throw new Error(`Refusing to touch the database: ${why}`);
  }
  if (env.APP_ENV !== "test") refuse("APP_ENV is not test");
  if (!env.DATABASE_URL) refuse("DATABASE_URL is not set");
  const mine = databaseOf(env.DATABASE_URL, "DATABASE_URL");
  if (
    env.DATABASE_URL_UNPOOLED &&
    databaseOf(env.DATABASE_URL_UNPOOLED, "DATABASE_URL_UNPOOLED") !== mine
  ) {
    refuse(
      "DATABASE_URL and DATABASE_URL_UNPOOLED point at different databases",
    );
  }
  if (!fileEnv.DATABASE_URL) refuse(".env.test has no DATABASE_URL");
  if (databaseOf(fileEnv.DATABASE_URL, ".env.test DATABASE_URL") !== mine) {
    refuse(
      "DATABASE_URL is not the .env.test database (a DATABASE_URL exported in your shell wins over the files: unset it)",
    );
  }
  if (localEnvText === undefined) return;
  const local = parseEnv(localEnvText);
  for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"] as const) {
    const url = local[key];
    if (url && databaseOf(url, `.env.local ${key}`) === mine) {
      refuse(`DATABASE_URL is the .env.local database (${key})`);
    }
  }
}

/**
 * checkTestDatabase on `env` against the files in `root`: .env.test then .env.test.local, and .env.local. Without `env`
 * it checks the files' own values, as a run that uses them does. Returns the .env.test values.
 */
export function checkTestDatabaseFiles(
  root: string,
  env?: DatabaseEnv,
): Record<string, string> {
  const fileEnv = readEnvFiles([
    join(root, ".env.test"),
    join(root, ".env.test.local"),
  ]);
  const localEnv = join(root, ".env.local");
  checkTestDatabase(
    env ?? fileEnv,
    existsSync(localEnv) ? readFileSync(localEnv, "utf8") : undefined,
    fileEnv,
  );
  return fileEnv;
}

/**
 * Empties every table in schema public of the database `client` reaches (Drizzle's journal lives in schema drizzle and
 * stays); a new database has none yet. The callers run the guard first: startTestRun on its lock's connection, before
 * it migrates, and resetDb on the integration pool after that.
 */
export async function emptyPublicTables(
  client: Pick<ClientBase, "query">,
): Promise<void> {
  const { rows } = await client.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'",
  );
  if (rows.length === 0) return;
  const tables = rows.map((row) => escapeIdentifier(row.tablename));
  await client.query(
    `truncate table ${tables.join(", ")} restart identity cascade`,
  );
}
