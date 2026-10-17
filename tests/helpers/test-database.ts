import { parseEnv } from "node:util";
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
 * Throws unless `env` is the test environment and its database is neither of `.env.local`'s (`localEnvText` is that
 * file's text, or undefined when it doesn't exist). Pure: no connection, no file access.
 */
export function checkTestDatabase(
  env: DatabaseEnv,
  localEnvText: string | undefined,
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
  if (localEnvText === undefined) return;
  const local = parseEnv(localEnvText);
  for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"] as const) {
    const url = local[key];
    if (url && databaseOf(url, `.env.local ${key}`) === mine) {
      refuse(`DATABASE_URL is the .env.local database (${key})`);
    }
  }
}
