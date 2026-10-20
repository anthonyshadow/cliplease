// Unit-test stand-ins for what the upload code reads from the browser (P10c): localStorage, where the resume hint lives,
// and the connection. Shared by the resume, upload-original and upload-store tests.
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
