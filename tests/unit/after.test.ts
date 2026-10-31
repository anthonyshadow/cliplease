import { afterEach, expect, it } from "vitest";
import {
  dropQueuedAfter,
  flushAfter,
  queueAfter,
  resetAfter,
  runAfter,
  runQueuedAfter,
} from "../helpers/after";

// tests/helpers/after.ts (P19b): the next/server after() mock either starts each task at once (the default) or, after
// queueAfter(), stores them until the test runs or drops them; resetAfter fails a test that left stored tasks.

afterEach(async () => {
  await flushAfter();
  resetAfter();
});

it("starts each task at once by default, and flushAfter waits for the tasks they start", async () => {
  const ran: string[] = [];
  runAfter(() => {
    ran.push("outer");
    runAfter(async () => {
      ran.push("inner");
    });
  });
  await flushAfter();
  expect(ran).toEqual(["outer", "inner"]);
});

it("stores tasks after queueAfter, then runs them and the tasks they store", async () => {
  queueAfter();
  const ran: string[] = [];
  runAfter(() => {
    ran.push("outer");
    runAfter(async () => {
      ran.push("inner");
    });
  });
  await flushAfter();
  expect(ran).toEqual([]);
  await runQueuedAfter();
  expect(ran).toEqual(["outer", "inner"]);
  expect(dropQueuedAfter()).toBe(0);
});

it("rejects with the first failure once every stored task has settled", async () => {
  queueAfter();
  const ran: string[] = [];
  runAfter(async () => {
    throw new Error("first");
  });
  runAfter(async () => {
    throw new Error("second");
  });
  runAfter(async () => {
    await Promise.resolve();
    ran.push("slow");
  });
  await expect(runQueuedAfter()).rejects.toThrow("first");
  expect(ran).toEqual(["slow"]);
});

it("drops the stored tasks, as a crash would, and says how many", async () => {
  queueAfter();
  const ran: string[] = [];
  runAfter(() => ran.push("a"));
  runAfter(() => ran.push("b"));
  expect(dropQueuedAfter()).toBe(2);
  await runQueuedAfter();
  expect(ran).toEqual([]);
});

it("resetAfter fails on stored tasks left, forgets them and starts tasks at once again", async () => {
  queueAfter();
  const ran: string[] = [];
  runAfter(() => ran.push("left"));
  expect(() => resetAfter()).toThrow(/1 queued after\(\) task/);
  runAfter(() => ran.push("now"));
  await flushAfter();
  expect(ran).toEqual(["now"]);
  expect(() => dropQueuedAfter()).toThrow(/queueAfter\(\) first/);
});

it("runQueuedAfter needs queueAfter first", async () => {
  await expect(runQueuedAfter()).rejects.toThrow(/queueAfter\(\) first/);
});
