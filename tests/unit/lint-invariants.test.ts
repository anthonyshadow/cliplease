import { describe, expect, it } from "vitest";
import { violationsIn } from "../../scripts/lint-invariants";

// The invariant lint's rules (AGENTS.md §5) on small sources: each one's catch, and what it leaves alone.

/** The rules `text` breaks as file `file`, in order. */
const rules = (file: string, text: string) =>
  violationsIn(file, text).map((line) => line.split(": ")[1]);

const SERVER = "src/server/licensing/example.ts";

describe("payments-in-tx", () => {
  it("flags a driver held in a variable set from paymentsDriver, under any import name", () => {
    const text = `
      import { paymentsDriver as driverOf } from "@/server/payments/registry";
      export async function f(db) {
        const driver = driverOf("cad");
        await db.transaction(async (tx) => {
          await driver.capture("pi", 100, "key");
          await driver.cancel("pi", "reason", "key");
        });
      }`;
    expect(rules(SERVER, text)).toEqual(["payments-in-tx", "payments-in-tx"]);
  });

  it("flags a parameter typed PaymentsDriver, and a namespace import's call", () => {
    const text = `
      import type { PaymentsDriver } from "@/server/payments/driver";
      import * as payments from "@/server/payments";
      export async function f(db, driver: PaymentsDriver) {
        await db.transaction(async () => {
          await driver.refund({ paymentIntentId: "pi" });
          await payments.retrieveCheckout("cad", "cs");
        });
      }`;
    expect(rules(SERVER, text)).toEqual(["payments-in-tx", "payments-in-tx"]);
  });

  it("leaves a call outside the transaction alone, and a payments result's own methods inside it", () => {
    const text = `
      import { findTransfers, paymentsDriver } from "@/server/payments";
      export async function f(db) {
        const transfers = await findTransfers("cad", "r");
        const driver = paymentsDriver("cad");
        await driver.capture("pi", 100, "key");
        await db.transaction(async () => {
          transfers.map((t) => t.id);
        });
      }`;
    expect(rules(SERVER, text)).toEqual([]);
  });
});

describe("status-write", () => {
  it("flags the table under an import alias and through a namespace", () => {
    const text = `
      import * as schema from "@/db/schema";
      import { licenseRequest as requests } from "@/db/schema";
      export async function f(tx) {
        await tx.update(requests).set({ status: "approved" });
        await tx.update(schema.licenseRequest).set({ status: "declined" });
      }`;
    expect(rules(SERVER, text)).toEqual(["status-write", "status-write"]);
  });

  it("leaves other columns alone, and the state machine's own writes", () => {
    const text = `
      import { licenseRequest } from "@/db/schema";
      export async function f(tx) {
        await tx.update(licenseRequest).set({ statusReason: "x" });
      }`;
    expect(rules(SERVER, text)).toEqual([]);
    expect(
      rules(
        "src/server/licensing/state-machine.ts",
        text.replace("statusReason", "status"),
      ),
    ).toEqual([]);
  });
});

describe("redacted-action", () => {
  const ACTIONS = "src/app/example/actions.ts";

  it("flags an export of a use server file whose body isn't return redactErrors(…), types aside", () => {
    const text = `"use server";
      import { redactErrors } from "@/server/rethrow-redacted";
      export type State = string | null;
      export async function wrapped(input: string) {
        return redactErrors("example.wrapped_failed", async () => input);
      }
      export async function bare(input: string) {
        return input;
      }
      export const arrow = async () => redactErrors("example.arrow_failed", async () => 1);`;
    expect(violationsIn(ACTIONS, text)).toEqual([
      expect.stringMatching(
        /^src\/app\/example\/actions\.ts:7: redacted-action:/,
      ),
      expect.stringMatching(
        /^src\/app\/example\/actions\.ts:10: redacted-action:/,
      ),
    ]);
  });

  it("leaves files without the directive alone", () => {
    const text = `
      // use server
      export async function plain() {
        return 1;
      }`;
    expect(rules(ACTIONS, text)).toEqual([]);
  });
});

describe("postings-fetch and vitest-in-src", () => {
  it("flags fetch under the postings folders and vitest outside test files", () => {
    expect(
      rules("src/server/postings/example.ts", "await fetch(url);"),
    ).toEqual(["postings-fetch"]);
    expect(rules(SERVER, 'import { vi } from "vitest";')).toEqual([
      "vitest-in-src",
    ]);
    expect(
      rules("src/server/example.test.ts", 'import { vi } from "vitest";'),
    ).toEqual([]);
  });
});
