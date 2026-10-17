import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside Next. @next/env loads .env.local, or .env.test when NODE_ENV=test: that is how the test
// branch is migrated. Migrations always use the direct (unpooled) URL (03 §8.2). Only the host is printed, never the URL.
const { loadedEnvFiles } = loadEnvConfig(process.cwd());
const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_URL_UNPOOLED is not set");
if (!URL.canParse(url))
  throw new Error("DATABASE_URL_UNPOOLED is not a valid URL");
const host = new URL(url).hostname;
if (host.includes("-pooler")) {
  throw new Error("DATABASE_URL_UNPOOLED is a pooled URL: use the direct one");
}
if (process.env.NODE_ENV === "test" && process.env.APP_ENV !== "test") {
  throw new Error("NODE_ENV=test needs APP_ENV=test (from .env.test)");
}
console.log(
  `drizzle-kit target host: ${host} (env: ${loadedEnvFiles.map((f) => f.path).join(", ")})`,
);

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
