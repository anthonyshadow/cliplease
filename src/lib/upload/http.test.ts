import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { putWithProgress } from "./http";
import { PUT_STALL_MS } from "./limits";

/** An XMLHttpRequest the test drives: progress, the body sent, an answer or an error, each when the test says. */
class FakeXhr {
  static last: FakeXhr | null = null;
  status = 0;
  aborted = false;
  upload: {
    onprogress: ((event: { loaded: number }) => void) | null;
    onload: (() => void) | null;
  } = { onprogress: null, onload: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open() {}
  setRequestHeader() {}
  send() {
    FakeXhr.last = this;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  progress(loaded: number) {
    this.upload.onprogress?.({ loaded });
  }
  sent() {
    this.upload.onload?.();
  }
  answer(status: number) {
    this.status = status;
    this.onload?.();
  }
}

const xhr = () => {
  if (!FakeXhr.last) throw new Error("no PUT was sent");
  return FakeXhr.last;
};

const put = (signal?: AbortSignal) =>
  putWithProgress("https://storage.test/part-1", new Blob(["part"]), {
    signal,
  });

beforeEach(() => {
  FakeXhr.last = null;
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
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
    expect(xhr().aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stays alive while progress comes, until the answer, and leaves no timer", async () => {
    const pending = put();
    for (let n = 1; n <= 4; n++) {
      await vi.advanceTimersByTimeAsync(PUT_STALL_MS / 2);
      xhr().progress(n);
    }
    xhr().sent();
    await vi.advanceTimersByTimeAsync(PUT_STALL_MS - 1);
    xhr().answer(200);
    await expect(pending).resolves.toEqual({ ok: true, status: 200 });
    expect(xhr().aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends as network when the body is sent but no answer comes", async () => {
    const pending = put();
    xhr().progress(4);
    xhr().sent();
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
    xhr().onerror?.();
    await expect(pending).resolves.toEqual({ ok: false, code: "network" });
    expect(vi.getTimerCount()).toBe(0);
  });
});
