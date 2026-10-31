import { describe, expect, it } from "vitest";
import {
  type CallsOutIndex,
  callsOutIndex,
  violationsIn,
} from "../../scripts/lint-invariants";

// The invariant lint's rules (AGENTS.md §5) on small sources: each one's catch, and what it leaves alone.

/** The rules `text` breaks as file `file`, in order. */
const rules = (file: string, text: string, index?: CallsOutIndex) =>
  violationsIn(file, text, index).map((line) => line.split(": ")[1]);

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

  it("flags a function elsewhere that reaches Stripe, by import or namespace", () => {
    const index: CallsOutIndex = new Map([
      ["src/server/licensing/state-machine", new Set(["reconcileFromStripe"])],
      ["src/server/creators/profile", new Set(["refreshPayoutsStatus"])],
    ]);
    const text = `
      import { reconcileFromStripe, applyTransition } from "./state-machine";
      import * as profile from "@/server/creators/profile";
      export async function f(db) {
        await db.transaction(async (tx) => {
          await reconcileFromStripe("r");
          await profile.refreshPayoutsStatus("c");
          await applyTransition(tx, "r");
        });
        await reconcileFromStripe("r");
      }`;
    expect(rules(SERVER, text, index)).toEqual([
      "payments-in-tx",
      "payments-in-tx",
    ]);
  });

  it("flags a same-file helper that reaches Stripe, directly or through another defined below it", () => {
    const text = `
      import { cancel } from "@/server/payments";
      async function release(id) {
        await cancel("cad", id, "pi", "decline", 1);
      }
      export async function f(db) {
        await db.transaction(async (tx) => {
          await release("r");
          await settle("r");
        });
      }
      const settle = async (id) => release(id);`;
    expect(rules(SERVER, text)).toEqual(["payments-in-tx", "payments-in-tx"]);
  });

  it("leaves a same-file helper that reaches Stripe alone outside the transaction, and one that doesn't inside it", () => {
    const text = `
      import { cancel } from "@/server/payments";
      async function release(id) {
        await cancel("cad", id, "pi", "decline", 1);
      }
      export async function f(db) {
        const claimed = await db.transaction(async (tx) => claim(tx, "r"));
        if (claimed) await release("r");
      }
      const claim = async (tx, id) => tx.select(id);`;
    expect(rules(SERVER, text)).toEqual([]);
  });

  it("indexes the functions that reach Stripe across files, through local and imported calls, and no others", () => {
    const index = callsOutIndex([
      [
        "src/server/licensing/a.ts",
        `import { capture } from "@/server/payments";
        async function inner() { await capture("cad", "r", "pi", 1); }
        export async function outer() { await inner(); }
        export const quiet = async () => 1;`,
      ],
      [
        "src/server/licensing/b.ts",
        `import { outer } from "./a";
        import type { PaymentsDriver } from "@/server/payments/driver";
        export async function viaImport() { await outer(); }
        export function viaDriver(driver: PaymentsDriver) { return driver.cancel("pi", "abandoned", "k"); }`,
      ],
      [
        "src/server/licensing/b.test.ts",
        `import { outer } from "./a";
        export async function inTest() { await outer(); }`,
      ],
    ]);
    expect(Object.fromEntries([...index].map(([m, n]) => [m, [...n]]))).toEqual(
      {
        "src/server/licensing/a": ["outer"],
        "src/server/licensing/b": ["viaImport", "viaDriver"],
      },
    );
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
