import { describe, expect, it, type Mock, vi } from "vitest";
import { holdScreenWakeLock } from "./wake-lock";

type FakeSentinel = { release: Mock<() => Promise<void>> };

class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = "visible";

  show(state: DocumentVisibilityState) {
    this.visibilityState = state;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

/** A navigator whose wakeLock grants every request; each lock's release answers with `release`. */
function fakeNav(release: () => Promise<void> = () => Promise.resolve()) {
  const sentinels: FakeSentinel[] = [];
  const request = vi.fn((_type: "screen") => {
    const sentinel = { release: vi.fn(release) };
    sentinels.push(sentinel);
    return Promise.resolve(sentinel);
  });
  return { nav: { wakeLock: { request } }, request, sentinels };
}

/** Lets every queued promise callback run. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("holdScreenWakeLock (07 D80)", () => {
  it("does nothing where navigator.wakeLock is missing", () => {
    const doc = new FakeDocument();
    const listen = vi.spyOn(doc, "addEventListener");
    const lock = holdScreenWakeLock({ nav: {}, doc });
    expect(listen).not.toHaveBeenCalled();
    expect(() => {
      doc.show("visible");
      lock.release();
      lock.release();
    }).not.toThrow();
  });

  it("requests the screen lock once at the start", async () => {
    const { nav, request } = fakeNav();
    holdScreenWakeLock({ nav, doc: new FakeDocument() });
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("screen");
  });

  it("swallows a refused request and can still be released", async () => {
    const doc = new FakeDocument();
    const request = vi.fn((_type: "screen") =>
      Promise.reject(new DOMException("Not allowed.", "NotAllowedError")),
    );
    const lock = holdScreenWakeLock({ nav: { wakeLock: { request } }, doc });
    doc.show("visible");
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(() => lock.release()).not.toThrow();
  });

  it("asks again when the page becomes visible, not when it is hidden", async () => {
    const { nav, request, sentinels } = fakeNav();
    const doc = new FakeDocument();
    const lock = holdScreenWakeLock({ nav, doc });
    doc.show("hidden");
    expect(request).toHaveBeenCalledTimes(1);
    doc.show("visible");
    expect(request).toHaveBeenCalledTimes(2);
    await flush();
    lock.release();
    expect(sentinels[1]?.release).toHaveBeenCalledTimes(1);
  });

  it("releases the lock it holds, once", async () => {
    const { nav, sentinels } = fakeNav();
    const lock = holdScreenWakeLock({ nav, doc: new FakeDocument() });
    await flush();
    lock.release();
    lock.release();
    expect(sentinels).toHaveLength(1);
    expect(sentinels[0]?.release).toHaveBeenCalledTimes(1);
  });

  it("stops asking after release and removes its listener", async () => {
    const { nav, request } = fakeNav();
    const doc = new FakeDocument();
    const listen = vi.spyOn(doc, "addEventListener");
    const unlisten = vi.spyOn(doc, "removeEventListener");
    const lock = holdScreenWakeLock({ nav, doc });
    lock.release();
    doc.show("hidden");
    doc.show("visible");
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
    expect(unlisten).toHaveBeenCalledWith(
      "visibilitychange",
      listen.mock.calls[0]?.[1],
    );
  });

  it("releases at once a lock granted after release()", async () => {
    const granted = Promise.withResolvers<FakeSentinel>();
    const request = vi.fn((_type: "screen") => granted.promise);
    const lock = holdScreenWakeLock({
      nav: { wakeLock: { request } },
      doc: new FakeDocument(),
    });
    lock.release();
    const sentinel = { release: vi.fn(() => Promise.resolve()) };
    granted.resolve(sentinel);
    await flush();
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it("ignores a lock whose release fails", async () => {
    const { nav, sentinels } = fakeNav(() =>
      Promise.reject(
        new DOMException("Already released.", "InvalidStateError"),
      ),
    );
    const lock = holdScreenWakeLock({ nav, doc: new FakeDocument() });
    await flush();
    expect(() => lock.release()).not.toThrow();
    await flush();
    expect(sentinels[0]?.release).toHaveBeenCalledTimes(1);
  });
});
