// Integration setup: runs before each test file, after tests/setup/load-env.ts (which loads .env.test). The imports
// are dynamic so nothing reads the environment before that file has run.
import { afterAll, beforeAll } from "vitest";

const { assertTestDatabase, resetDb } = await import("../helpers/db");
const { pool } = await import("../../src/db/client");

assertTestDatabase();
beforeAll(resetDb);
afterAll(() => pool.end());
