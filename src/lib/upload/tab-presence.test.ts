import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Presence from "./tab-presence";

const h = vi.hoisted(() => ({
  subscribe: null as ((listener: () => void) => () => void) | null,
}));

// useUploadElsewhere is a hook: read the snapshot straight from getSnapshot, outside React, and keep subscribe so a
// test can subscribe the way React would.
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useSyncExternalStore: <T>(
    subscribe: (listener: () => void) => () => void,
    getSnapshot: () => T,
  ) => {
    h.subscribe = subscribe;
    return getSnapshot();
  },
}));

const CHANNEL = "cliplease.uploads";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

type Message =
  | { type: "live"; tab: string; videoIds: string[] }
  | { type: "ask" };
type Live = Extract<Message, { type: "live" }>;

/** BroadcastChannel in one process: a post reaches every other open channel of the same name at once, never itself. */
class FakeChannel {
  static open: FakeChannel[] = [];

  name: string;
  onmessage: ((event: { data: Message }) => void) | null = null;
  received: Message[] = [];
  closed = false;

  constructor(name: string) {
    this.name = name;
    FakeChannel.open.push(this);
  }

  postMessage(data: Message) {
    if (this.closed) throw new DOMException("closed", "InvalidStateError");
    for (const other of FakeChannel.open) {
      if (other === this || other.closed || other.name !== this.name) continue;
      const copy = structuredClone(data);
      other.received.push(copy);
      other.onmessage?.({ data: copy });
    }
  }

  close() {
    this.closed = true;
  }
}

type PageListener = (event: { persisted: boolean }) => void;

/** A window that keeps the listeners the module adds, by event type. */
function stubWindow() {
  const listeners = new Map<string, PageListener[]>();
  vi.stubGlobal("window", {
    addEventListener: (type: string, listener: PageListener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
  });
  return listeners;
}

let presence: typeof Presence;
/** Another tab of the same browser. */
let other: FakeChannel;
/** This tab's window listeners. */
let page: Map<string, PageListener[]>;

const elsewhere = (videoId: string) => presence.useUploadElsewhere(videoId);
const tell = (videoIds: string[], tab = "other") =>
  other.postMessage({ type: "live", tab, videoIds });
/** What this tab told the other tab. */
const told = () =>
  other.received.filter((message): message is Live => message.type === "live");
const asks = () =>
  other.received.filter((message) => message.type === "ask").length;
const fire = (type: "pagehide" | "pageshow", persisted = false, on = page) => {
  for (const listener of on.get(type) ?? []) listener({ persisted });
};

/** The File step mounts: React subscribes, which opens the channel and asks the other tabs. */
function mount() {
  elsewhere(A);
  const subscribe = h.subscribe;
  if (!subscribe) throw new Error("useSyncExternalStore was not called");
  const listener = vi.fn();
  return { listener, unsubscribe: subscribe(listener) };
}

async function load() {
  vi.resetModules();
  h.subscribe = null;
  presence = await import("./tab-presence");
}

beforeEach(async () => {
  FakeChannel.open = [];
  vi.stubGlobal("BroadcastChannel", FakeChannel);
  page = stubWindow();
  await load();
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  other = new FakeChannel(CHANNEL);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useUploadElsewhere (owner answer Q-49 b)", () => {
  it("asks the tabs already uploading when it subscribes", () => {
    mount();
    expect(other.received).toEqual([{ type: "ask" }]);
  });

  it("is true for a video another tab is uploading, false for the rest", () => {
    const { listener } = mount();
    expect(elsewhere(A)).toBe(false);

    tell([A]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(elsewhere(A)).toBe(true);
    expect(elsewhere(B)).toBe(false);
  });

  it("doesn't tell React again for the same list", () => {
    const { listener } = mount();
    tell([A]);
    tell([A]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps each tab's list apart", () => {
    mount();
    tell([A], "x");
    tell([B], "y");
    expect(elsewhere(A)).toBe(true);
    expect(elsewhere(B)).toBe(true);

    tell([], "y");
    expect(elsewhere(A)).toBe(true);
    expect(elsewhere(B)).toBe(false);
  });

  it("clears at once when that tab tells an empty list", () => {
    const { listener } = mount();
    tell([A, B]);
    tell([]);
    expect(elsewhere(A)).toBe(false);
    expect(elsewhere(B)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    // The tab is forgotten, not kept with an empty list until it goes stale: nobody is left to ask.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a tab that tells every 2 s, and drops one that stopped after about 6 s", () => {
    const { listener } = mount();
    tell([A]);
    for (let beat = 0; beat < 5; beat += 1) {
      vi.advanceTimersByTime(2000);
      tell([A]);
    }
    expect(elsewhere(A)).toBe(true);

    // The sweep looks every second: still there 6 s after the last word, gone the second after.
    vi.advanceTimersByTime(6000);
    expect(elsewhere(A)).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(elsewhere(A)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    // The sweep stops with no tab left to watch.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("asks every second once another tab is known, and not before", () => {
    mount();
    vi.advanceTimersByTime(5000);
    expect(other.received).toEqual([{ type: "ask" }]);

    tell([A]);
    vi.advanceTimersByTime(999);
    expect(asks()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(asks()).toBe(2);
    vi.advanceTimersByTime(3000);
    expect(asks()).toBe(5);
  });

  it("doesn't ask while no File step watches, even with another tab uploading", () => {
    mount().unsubscribe();
    for (let beat = 0; beat < 5; beat += 1) {
      tell([A]);
      vi.advanceTimersByTime(2000);
    }
    expect(asks()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("asks every second from a subscribe that finds another tab uploading until the last File step leaves", () => {
    mount().unsubscribe();
    tell([A]);
    vi.advanceTimersByTime(3000);

    const first = mount();
    const second = mount();
    expect(asks()).toBe(3);
    vi.advanceTimersByTime(1000);
    expect(asks()).toBe(4);
    first.unsubscribe();
    vi.advanceTimersByTime(1000);
    expect(asks()).toBe(5);
    second.unsubscribe();
    vi.advanceTimersByTime(5000);
    expect(asks()).toBe(5);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("drops a tab that went quiet while nobody watched, from the File step's first render", () => {
    mount().unsubscribe();
    tell([A]);
    vi.advanceTimersByTime(7000);
    expect(elsewhere(A)).toBe(false);

    const { listener } = mount();
    expect(listener).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("drops it when it subscribes too, for a File step that rendered the server's snapshot", () => {
    mount().unsubscribe();
    tell([A]);
    vi.advanceTimersByTime(7000);

    // Hydrating, React renders the server's snapshot and subscribes without reading this tab's first.
    const listener = vi.fn();
    h.subscribe?.(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(elsewhere(A)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a background tab that only answers asks, and drops it after about 6 s once it stops", () => {
    const { listener } = mount();
    // Its timers are throttled, so it never beats; its message handler still answers.
    other.onmessage = ({ data }) => {
      if (data.type === "ask") tell([A]);
    };
    tell([A]);
    vi.advanceTimersByTime(20_000);
    expect(elsewhere(A)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    // Crashed or frozen: it neither answers nor beats.
    other.onmessage = null;
    vi.advanceTimersByTime(6000);
    expect(elsewhere(A)).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(elsewhere(A)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a message carrying its own tab", () => {
    const { listener } = mount();
    presence.announceUploads([A]);
    const own = told()[0]?.tab ?? "";
    expect(own).not.toBe("");

    tell([B], own);
    expect(elsewhere(B)).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it("stops telling a listener that unsubscribed", () => {
    const { listener, unsubscribe } = mount();
    unsubscribe();
    tell([A]);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("announceUploads (owner answer Q-49 b)", () => {
  it("tells the others now and every 2 s while it has uploads, then once more with none", () => {
    presence.announceUploads([B, A]);
    expect(told()).toEqual([
      { type: "live", tab: expect.any(String), videoIds: [A, B] },
    ]);
    vi.advanceTimersByTime(1999);
    expect(told()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(told()).toHaveLength(2);
    vi.advanceTimersByTime(4000);
    expect(told()).toHaveLength(4);

    presence.announceUploads([]);
    expect(told()).toHaveLength(5);
    expect(told().at(-1)?.videoIds).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(told()).toHaveLength(5);
  });

  it("tells nothing for an unchanged list, and nothing at all before it had any", () => {
    presence.announceUploads([]);
    expect(other.received).toEqual([]);
    presence.announceUploads([A]);
    presence.announceUploads([A]);
    expect(told()).toHaveLength(1);
  });

  it("beats with the latest list", () => {
    presence.announceUploads([A]);
    presence.announceUploads([A, B]);
    vi.advanceTimersByTime(2000);
    expect(told().map((message) => message.videoIds)).toEqual([
      [A],
      [A, B],
      [A, B],
    ]);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("answers an ask at once while it has uploads", () => {
    presence.announceUploads([A]);
    other.received = [];
    other.postMessage({ type: "ask" });
    expect(other.received).toEqual([
      { type: "live", tab: expect.any(String), videoIds: [A] },
    ]);
  });

  it("doesn't answer an ask with no uploads", () => {
    presence.announceUploads([A]);
    presence.announceUploads([]);
    other.received = [];
    other.postMessage({ type: "ask" });
    expect(other.received).toEqual([]);
  });

  it("stays quiet without throwing once its channel is closed", () => {
    presence.announceUploads([A]);
    for (const channel of FakeChannel.open) {
      if (channel !== other) channel.close();
    }
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
    expect(() => presence.announceUploads([B])).not.toThrow();
    expect(told()).toHaveLength(1);
  });
});

describe("onOtherTabUploads", () => {
  it("hears each list another tab tells, its answers to a third tab's ask too, and never asks", () => {
    const heard = vi.fn();
    presence.onOtherTabUploads(heard);
    tell([A]);
    vi.advanceTimersByTime(5000);
    expect(asks()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    other.onmessage = ({ data }) => {
      if (data.type === "ask") tell([A, B]);
    };
    new FakeChannel(CHANNEL).postMessage({ type: "ask" });
    expect(heard.mock.calls).toEqual([[[A]], [[A, B]]]);
  });

  it("hears neither this tab's own list nor an empty one", () => {
    const heard = vi.fn();
    presence.onOtherTabUploads(heard);
    presence.announceUploads([A]);
    const own = told()[0]?.tab ?? "";
    expect(own).not.toBe("");

    tell([B], own);
    tell([]);
    expect(heard).not.toHaveBeenCalled();
  });

  it("stops hearing once unsubscribed", () => {
    const heard = vi.fn();
    presence.onOtherTabUploads(heard)();
    tell([A]);
    expect(heard).not.toHaveBeenCalled();
  });

  it("opens no channel on the server", () => {
    vi.stubGlobal("window", undefined);
    const heard = vi.fn();
    expect(() => presence.onOtherTabUploads(heard)()).not.toThrow();
    expect(FakeChannel.open).toEqual([other]);
  });
});

describe("leaving the page", () => {
  it("listens for pagehide and pageshow once, when the channel opens", () => {
    expect(page.size).toBe(0);
    mount();
    presence.announceUploads([A]);
    presence.announceUploads([]);
    presence.onOtherTabUploads(vi.fn());
    mount();
    expect(page.get("pagehide")).toHaveLength(1);
    expect(page.get("pageshow")).toHaveLength(1);
  });

  it("tells an empty list on pagehide while it has uploads, so a watching tab clears at once", async () => {
    presence.announceUploads([A]);
    const closing = page;
    page = stubWindow();
    await load();
    mount();
    expect(elsewhere(A)).toBe(true);

    fire("pagehide", false, closing);
    expect(told().at(-1)?.videoIds).toEqual([]);
    expect(elsewhere(A)).toBe(false);
  });

  it("tells its list again when the page comes back from the back/forward cache", () => {
    presence.announceUploads([A]);
    fire("pagehide");
    fire("pageshow");
    expect(told().map((message) => message.videoIds)).toEqual([[A], []]);

    fire("pageshow", true);
    expect(told().map((message) => message.videoIds)).toEqual([[A], [], [A]]);
  });

  it("tells nothing on pagehide or pageshow without uploads", () => {
    presence.announceUploads([A]);
    presence.announceUploads([]);
    other.received = [];
    fire("pagehide");
    fire("pageshow", true);
    expect(other.received).toEqual([]);
  });
});

describe("without BroadcastChannel", () => {
  it("never throws, and no other tab is ever uploading", async () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    await load();
    expect(() => presence.announceUploads([A])).not.toThrow();
    expect(() => presence.onOtherTabUploads(vi.fn())()).not.toThrow();
    const { unsubscribe } = mount();
    unsubscribe();
    expect(elsewhere(A)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(page.size).toBe(0);
  });
});
