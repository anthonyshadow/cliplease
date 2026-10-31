import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CRON } from "@/server/auth/actor";
import { GET } from "./route";

// The expire-requests cron's loop (02 §8.4 layer 2): the bearer, the passes, the budget and the failure answer, with the
// steps mocked (the [int] test runs them against the database).
const mocks = vi.hoisted(() => ({
  env: { CRON_SECRET: "unit-test-cron-secret-0123456789abcdef" },
  expireDueRequests: vi.fn(),
  reconcileStuckClaims: vi.fn(),
  retryEmailOutbox: vi.fn(),
  logEvent: vi.fn(),
}));
vi.mock("@/server/env", () => ({ env: mocks.env }));
vi.mock("@/server/licensing/requests", () => ({
  expireDueRequests: mocks.expireDueRequests,
}));
vi.mock("@/server/licensing/state-machine", () => ({
  reconcileStuckClaims: mocks.reconcileStuckClaims,
}));
vi.mock("@/server/email/send", () => ({
  retryEmailOutbox: mocks.retryEmailOutbox,
}));
vi.mock("@/server/log", () => ({
  errorName: (error: unknown) =>
    error instanceof Error ? error.name : "unknown",
  logEvent: mocks.logEvent,
}));

const URL = "http://localhost:3000/api/cron/expire-requests";
const BEARER = `Bearer ${mocks.env.CRON_SECRET}`;
const START = new Date("2026-10-30T07:00:00.000Z");

const get = (authorization?: string) =>
  GET(
    new Request(URL, {
      headers: authorization ? { authorization } : {},
    }),
  );

/** Each step's results, one per call; a call past the list returns 0. */
function script(results: {
  expired?: number[];
  reconciled?: number[];
  emailsSent?: number[];
}) {
  const queue = (list: number[] = []) => {
    const left = [...list];
    return async () => left.shift() ?? 0;
  };
  mocks.expireDueRequests.mockImplementation(queue(results.expired));
  mocks.reconcileStuckClaims.mockImplementation(queue(results.reconciled));
  mocks.retryEmailOutbox.mockImplementation(queue(results.emailsSent));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("GET /api/cron/expire-requests", () => {
  it.each([
    ["no header", undefined],
    ["a wrong bearer", "Bearer nope"],
  ])("answers 401 to %s, running nothing", async (_case, authorization) => {
    script({});
    const response = await get(authorization);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: { code: "unauthorized" },
    });
    expect(mocks.expireDueRequests).not.toHaveBeenCalled();
    expect(mocks.reconcileStuckClaims).not.toHaveBeenCalled();
    expect(mocks.retryEmailOutbox).not.toHaveBeenCalled();
  });

  it("runs each step once when none fills its batch, and answers the counts", async () => {
    script({ expired: [2], reconciled: [1], emailsSent: [0] });
    const response = await get(BEARER);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe(
      '{"expired":2,"reconciled":1,"emailsSent":0}',
    );
    const stopAt = START.getTime() + 45_000;
    expect(mocks.expireDueRequests).toHaveBeenCalledExactlyOnceWith({
      limit: 100,
      actor: CRON,
      stopAt,
    });
    expect(mocks.reconcileStuckClaims).toHaveBeenCalledExactlyOnceWith({
      olderThanMinutes: 10,
      limit: 50,
      actor: CRON,
      stopAt,
    });
    expect(mocks.retryEmailOutbox).toHaveBeenCalledExactlyOnceWith({
      limit: 50,
      stopAt,
    });
  });

  it("runs again only the steps that filled their batch, the reconcile first in each pass", async () => {
    const order: string[] = [];
    script({
      expired: [100, 100, 7],
      reconciled: [50, 4],
      emailsSent: [50, 2],
    });
    for (const [name, mock] of [
      ["expire", mocks.expireDueRequests],
      ["reconcile", mocks.reconcileStuckClaims],
      ["emails", mocks.retryEmailOutbox],
    ] as const) {
      const run = mock.getMockImplementation();
      mock.mockImplementation(async (...args: unknown[]) => {
        order.push(name);
        return run?.(...args);
      });
    }
    const response = await get(BEARER);
    expect(await response.json()).toEqual({
      expired: 207,
      reconciled: 54,
      emailsSent: 52,
    });
    expect(order).toEqual([
      "reconcile",
      "expire",
      "emails",
      "reconcile",
      "expire",
      "emails",
      "expire",
    ]);
  });

  it("starts no step once the budget is spent", async () => {
    script({ reconciled: [3] });
    mocks.expireDueRequests.mockImplementation(async () => {
      vi.setSystemTime(START.getTime() + 45_000);
      return 100;
    });
    const response = await get(BEARER);
    expect(await response.json()).toEqual({
      expired: 100,
      reconciled: 3,
      emailsSent: 0,
    });
    expect(mocks.reconcileStuckClaims).toHaveBeenCalledTimes(1);
    expect(mocks.expireDueRequests).toHaveBeenCalledTimes(1);
    expect(mocks.retryEmailOutbox).not.toHaveBeenCalled();
  });

  it("answers 500 cron_failed when a step throws, logging only the error's name", async () => {
    script({});
    mocks.reconcileStuckClaims.mockRejectedValue(
      new TypeError(`select … ${BEARER}`),
    );
    const response = await get(BEARER);
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: { code: "cron_failed" } });
    expect(mocks.logEvent).toHaveBeenCalledExactlyOnceWith(
      "error",
      "cron.expire_requests_failed",
      { error: "TypeError" },
    );
    expect(JSON.stringify(mocks.logEvent.mock.calls)).not.toContain(
      mocks.env.CRON_SECRET,
    );
  });
});
