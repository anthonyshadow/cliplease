import { describe, expect, it } from "vitest";
import { pgError, wrapped } from "../../tests/helpers/pg-errors";
import { isLockTimeout, uniqueViolationConstraint } from "./db-errors";

describe("uniqueViolationConstraint", () => {
  it("names the violated index, bare or wrapped by Drizzle", () => {
    expect(uniqueViolationConstraint(pgError("23505", "a_uidx"))).toBe(
      "a_uidx",
    );
    expect(uniqueViolationConstraint(wrapped(pgError("23505", "a_uidx")))).toBe(
      "a_uidx",
    );
  });

  it("is null for any other error", () => {
    expect(uniqueViolationConstraint(pgError("23503", "a_fk"))).toBeNull();
    expect(uniqueViolationConstraint(pgError("23505"))).toBeNull();
    expect(uniqueViolationConstraint(new Error("23505"))).toBeNull();
    expect(uniqueViolationConstraint(null)).toBeNull();
  });
});

describe("isLockTimeout", () => {
  it("spots 55P03, bare or wrapped by Drizzle", () => {
    expect(isLockTimeout(pgError("55P03"))).toBe(true);
    expect(isLockTimeout(wrapped(pgError("55P03")))).toBe(true);
  });

  it("is false for any other error", () => {
    expect(isLockTimeout(pgError("57014"))).toBe(false);
    expect(isLockTimeout(new Error("55P03"))).toBe(false);
    expect(isLockTimeout(undefined)).toBe(false);
  });
});
