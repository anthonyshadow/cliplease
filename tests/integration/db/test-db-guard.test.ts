import { describe, expect, it } from "vitest";
import { assertTestDatabase } from "../../helpers/db";

// The guard's own cases are pure and run in the unit project (tests/unit/test-database.test.ts).
describe("the test-database guard on this run", () => {
  it("passes for the pool's real connection and .env.local", () => {
    expect(() => assertTestDatabase()).not.toThrow();
  });
});
