import { DrizzleQueryError } from "drizzle-orm";
import { DatabaseError } from "pg";
import { describe, expect, it } from "vitest";
import { isLockTimeout, uniqueViolationConstraint } from "./db-errors";

function pgError(code: string, constraint?: string): DatabaseError {
  const error = new DatabaseError("boom", 0, "error");
  error.code = code;
  error.constraint = constraint;
  return error;
}

const wrapped = (cause: Error) => new DrizzleQueryError("select 1", [], cause);

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
