// The scripted payments double as an [int] file's Stripe (P19): installScriptedPayments in beforeEach puts a fresh one
// behind paymentsDriver(currency), and the checks every test on it ends with. uninstallScriptedPayments (P19b) gives
// the tests that follow the real registry's driver (the fake) again, for a file that runs some tests on each. Each
// file keeps its own registry mock:
//   vi.mock("@/server/payments/registry", async (importOriginal) =>
//     (await import("../helpers/scripted-suite")).scriptedRegistry(
//       await importOriginal<typeof import("@/server/payments/registry")>(),
//     ),
//   );
import { expect, vi } from "vitest";
import type { Currency } from "../../src/lib/domain/values";
import { flushAfter, resetAfter } from "./after";
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

/** Back to the real registry's driver (the fake) for the tests that follow: call it in their beforeEach. */
export function uninstallScriptedPayments(): void {
  installed = undefined;
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
 * The afterEach of a file whose tests all record stderr from beforeEach (logs.ts recordStderr): `double`'s held calls
 * let go, the after() work waited for, after() back to running at once (resetAfter: a test that queued tasks ran or
 * dropped them), the recording stopped and checked (endStderr: no after() task failed); whatever failed, the recording
 * forgotten, `double`'s held calls let go and the mocks restored. A test on the real driver passes no double.
 */
export async function finishRecordedTest(
  double?: ScriptedPayments,
): Promise<void> {
  try {
    double?.releaseHolds();
    await flushAfter();
    resetAfter();
    endStderr();
  } finally {
    dropStderr();
    double?.releaseHolds();
    vi.restoreAllMocks();
  }
}

/** The afterEach of a file on the double whose tests all record stderr: finishRecordedTest, then expectScriptPlayed. */
export async function finishScriptedTest(): Promise<void> {
  await finishRecordedTest(installedDouble());
  expectScriptPlayed();
}
