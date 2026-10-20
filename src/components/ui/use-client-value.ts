import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/** `read()` once hydrated, `serverValue` before: the server's HTML and the client's first render agree. */
export function useClientValue<T>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(noSubscribe, read, () => serverValue);
}
