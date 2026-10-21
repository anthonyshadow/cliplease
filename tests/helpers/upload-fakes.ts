// Unit-test stand-ins for what the upload code uses from the browser (P10c): localStorage, where the resume hint lives,
// the connection, and XMLHttpRequest for the PUTs. Shared by the http, resume, upload-original and upload-store tests.
import { vi } from "vitest";
import type { NetworkWatch } from "../../src/lib/upload/upload-original";

/** A Map-backed localStorage: `items` is what it holds, and each method is a mock a test can check or make throw. */
export function memoryStorage(entries: Record<string, string> = {}) {
  const items = new Map(Object.entries(entries));
  return {
    items,
    getItem: vi.fn((key: string) => items.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      items.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      items.delete(key);
    }),
  };
}

/** navigator.onLine and its events, switched by the test with `set`. */
export function fakeNetwork(): NetworkWatch & {
  set: (online: boolean) => void;
} {
  const listeners = new Set<(online: boolean) => void>();
  let online = true;
  return {
    isOnline: () => online,
    onChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (next) => {
      online = next;
      for (const listener of [...listeners]) listener(next);
    },
  };
}

/** How a send answers: a status, a dropped connection, or "hang" (nothing comes by itself). */
type XhrAnswer = number | "error" | "hang";

/**
 * XMLHttpRequest for the PUTs, stubbed with `vi.stubGlobal("XMLHttpRequest", xhrs.XMLHttpRequest)`. Each send asks
 * `answers(xhr, send)` how it answers, `send` counting the sends to that URL from 1. A status or "error" comes by
 * itself, after half then full progress, each a timer apart; "hang" leaves the request to the test's `progress`,
 * `sent`, `answer` and `fail`. Abort answers at once, as browsers do, and an answered request can't be aborted. `all`
 * holds every send, in order, and `maxInFlight` the most running at once.
 */
export function fakeXhr() {
  const sendsTo = new Map<string, number>();

  class FakeXhr {
    method = "";
    url = "";
    status = 0;
    headers: [string, string][] = [];
    body: Blob | null = null;
    aborted = false;
    answered = false;
    sentAt = 0;
    answeredAt = 0;
    upload: {
      onprogress: ((event: { loaded: number }) => void) | null;
      onload: (() => void) | null;
    } = { onprogress: null, onload: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;

    open(method: string, url: string): void {
      this.method = method;
      this.url = url;
    }

    setRequestHeader(name: string, value: string): void {
      this.headers.push([name, value]);
    }

    send(body: Blob): void {
      this.body = body;
      this.sentAt = Date.now();
      xhrs.all.push(this);
      xhrs.inFlight++;
      xhrs.maxInFlight = Math.max(xhrs.maxInFlight, xhrs.inFlight);
      const send = (sendsTo.get(this.url) ?? 0) + 1;
      sendsTo.set(this.url, send);
      const answer = xhrs.answers(this, send);
      if (answer === "hang") return;
      setTimeout(() => {
        if (this.aborted) return;
        this.progress(Math.floor(body.size / 2));
        setTimeout(() => {
          if (answer === "error") this.fail();
          else this.answer(answer);
        }, 0);
      }, 0);
    }

    abort(): void {
      if (this.aborted || this.answered) return;
      this.aborted = true;
      xhrs.inFlight--;
      this.onabort?.();
    }

    /** Upload progress: `loaded` bytes of the body sent. */
    progress(loaded: number): void {
      this.upload.onprogress?.({ loaded });
    }

    /** The whole body is sent; the answer is still to come. */
    sent(): void {
      this.upload.onload?.();
    }

    /** The server's answer, after the body's last progress. */
    answer(status: number): void {
      if (!this.settle()) return;
      this.upload.onprogress?.({ loaded: this.body?.size ?? 0 });
      this.status = status;
      this.onload?.();
    }

    /** A dropped connection. */
    fail(): void {
      if (!this.settle()) return;
      this.onerror?.();
    }

    private settle(): boolean {
      if (this.aborted || this.answered) return false;
      this.answered = true;
      this.answeredAt = Date.now();
      xhrs.inFlight--;
      return true;
    }
  }

  const xhrs = {
    XMLHttpRequest: FakeXhr,
    all: [] as FakeXhr[],
    inFlight: 0,
    maxInFlight: 0,
    /** Every send answers 200 unless the test says otherwise. */
    answers: (_xhr: FakeXhr, _send: number): XhrAnswer => 200,
    /** The latest send; it throws when none was sent. */
    last: (): FakeXhr => {
      const xhr = xhrs.all.at(-1);
      if (!xhr) throw new Error("no PUT was sent");
      return xhr;
    },
  };
  return xhrs;
}
