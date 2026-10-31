// The scripted payments double as an [int] file's Stripe (P19): installScriptedPayments in beforeEach puts a fresh one
// behind paymentsDriver(currency), and the checks every test on it ends with. Each file keeps its own registry mock:
//   vi.mock("@/server/payments/registry", async (importOriginal) =>
//     (await import("../helpers/scripted-suite")).scriptedRegistry(
//       await importOriginal<typeof import("@/server/payments/registry")>(),
//     ),
//   );
import { expect, vi } from "vitest";
import type { Currency } from "../../src/lib/domain/values";
import { flushAfter } from "./after";
import { dropStderr, endStderr } from "./logs";
import {
  createScriptedPayments,
  type ScriptedPayments,
} from "./scripted-payments";

let installed: ScriptedPayments | undefined;

/** A fresh double, installed as the one paymentsDriver(currency) returns: call it in beforeEach. */
export function installScriptedPayments(): ScriptedPayments {
  installed = createScriptedPayments();
  return installed;
}

/** The registry `real`, its paymentsDriver answering from the installed double (the real driver until one is). */
export function scriptedRegistry(
  real: typeof import("../../src/server/payments/registry"),
) {
  return {
    ...real,
    paymentsDriver: (currency: Currency) =>
      installed?.driverFor(currency) ?? real.paymentsDriver(currency),
  };
}

/** The double this test runs on. */
function installedDouble(): ScriptedPayments {
  if (!installed) {
    throw new Error(
      "no scripted double: call installScriptedPayments() in beforeEach",
    );
  }
  return installed;
}

/** The double followed the test's script: every queued outcome used, nothing it couldn't follow, 07 D25 kept. */
export function expectScriptPlayed(): void {
  const scripted = installedDouble();
  expect(scripted.problems).toEqual([]);
  expect(scripted.leftovers()).toEqual([]);
  expect(scripted.violations).toEqual([]);
}

/** 07 D25 for the request now: its tracked PaymentIntent against its stored status. */
export async function expectInvariant(requestId: string): Promise<void> {
  const scripted = installedDouble();
  await scripted.checkInvariant(requestId);
  expect(scripted.violations).toEqual([]);
}

/**
 * The afterEach of a file whose tests all record stderr from beforeEach (logs.ts recordStderr): held calls let go, the
 * after() work waited for, the recording stopped and checked (endStderr); whatever failed, the recording forgotten and
 * the mocks restored; then expectScriptPlayed.
 */
export async function finishScriptedTest(): Promise<void> {
  const scripted = installedDouble();
  try {
    scripted.releaseHolds();
    await flushAfter();
    endStderr();
  } finally {
    dropStderr();
    scripted.releaseHolds();
    vi.restoreAllMocks();
  }
  expectScriptPlayed();
}
