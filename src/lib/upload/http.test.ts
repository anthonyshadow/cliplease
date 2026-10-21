import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeXhr } from "../../../tests/helpers/upload-fakes";
import { putWithProgress } from "./http";
import { PUT_STALL_MS } from "./limits";

let xhrs: ReturnType<typeof fakeXhr>;

const put = (signal?: AbortSignal) =>
  putWithProgress("https://storage.test/part-1", new Blob(["part"]), {
    signal,
  });

beforeEach(() => {
  // Each PUT waits for the test: its progress, the body sent, an answer or an error, each when the test says.
  xhrs = fakeXhr();
  xhrs.answers = () => "hang";
  vi.stubGlobal("XMLHttpRequest", xhrs.XMLHttpRequest);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("putWithProgress: a stalled PUT (07 D80)", () => {
  it("ends as network, aborting the request, after PUT_STALL_MS with no progress", async () => {
    const result = vi.fn();
    void put().then(result);
    await vi.advanceTimersByTimeAsync(PUT_STALL_MS - 1);
    expect(result).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toHaveBeenCalledWith({ ok: false, code: "network" });
    expect(xhrs.last().aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stays alive while progress comes, until the answer, and leaves no timer", async () => {
    const pending = put();
    for (let n = 1; n <= 4; n++) {
      await vi.advanceTimersByTimeAsync(PUT_STALL_MS / 2);
      xhrs.last().progress(n);
    }
    xhrs.last().sent();
    await vi.advanceTimersByTimeAsync(PUT_STALL_MS - 1);
    xhrs.last().answer(200);
    await expect(pending).resolves.toEqual({ ok: true, status: 200 });
    expect(xhrs.last().aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends as network when the body is sent but no answer comes", async () => {
    const pending = put();
    xhrs.last().progress(4);
    xhrs.last().sent();
    await vi.advanceTimersByTimeAsync(PUT_STALL_MS);
    await expect(pending).resolves.toEqual({ ok: false, code: "network" });
  });

  it("is still canceled when the caller aborts", async () => {
    const controller = new AbortController();
    const pending = put(controller.signal);
    controller.abort();
    await expect(pending).resolves.toEqual({ ok: false, code: "canceled" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no timer after a dropped connection", async () => {
    const pending = put();
    xhrs.last().fail();
    await expect(pending).resolves.toEqual({ ok: false, code: "network" });
    expect(vi.getTimerCount()).toBe(0);
  });
});
