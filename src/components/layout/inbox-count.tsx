"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

// The NavBar and TabBar Inbox badge (05 §6.3 callout 1: the waiting count). The layout reads the count, but a layout
// doesn't re-render on a client navigation (Next 16), so the Inbox page, which reads it again on every render, passes
// its own count up: the badge and the page's title always agree.

const InboxCount = createContext<{
  count: number;
  update: (count: number) => void;
} | null>(null);

/** Holds the badge's count: the layout's, until the Inbox page or a refresh brings a newer one. */
export function InboxCountProvider({
  count,
  children,
}: {
  count: number;
  children: ReactNode;
}) {
  const [current, setCurrent] = useState(count);
  // A refresh re-renders the layout with a fresh count: it wins.
  const [fromLayout, setFromLayout] = useState(count);
  if (count !== fromLayout) {
    setFromLayout(count);
    setCurrent(count);
  }
  return (
    <InboxCount.Provider value={{ count: current, update: setCurrent }}>
      {children}
    </InboxCount.Provider>
  );
}

/** The badge's count: the provider's, else `fallback` (a bar rendered alone, as in the dev gallery). */
export function useInboxCount(fallback = 0): number {
  return useContext(InboxCount)?.count ?? fallback;
}

/** Rendered by the Inbox page: its fresh count reaches the badge after a client navigation. */
export function SyncInboxCount({ count }: { count: number }): null {
  const update = useContext(InboxCount)?.update;
  useEffect(() => {
    update?.(count);
  }, [update, count]);
  return null;
}
