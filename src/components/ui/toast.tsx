"use client";

import { Toast } from "radix-ui";
import { useSyncExternalStore } from "react";

// 04 §9.23: Radix Toast. A small module store lets toast() run from any client component; mount <Toaster /> once
// (root layout). Polite (`type="background"`), 4 s (8 s with an action), pauses on hover and focus.

type ToastAction = { label: string; altText: string; onClick: () => void };
type ToastItem = {
  id: number;
  message: string;
  action?: ToastAction;
  open: boolean;
};

const EMPTY: ToastItem[] = [];
let items: ToastItem[] = EMPTY;
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function close(id: number) {
  items = items.map((item) =>
    item.id === id ? { ...item, open: false } : item,
  );
  emit();
  // Remove it once Radix's exit animation has finished.
  setTimeout(() => {
    items = items.filter((item) => item.id !== id);
    emit();
  }, 400);
}

/** Shows a monochrome toast. Never the only record of something important (04 §9.23). */
export function toast(message: string, options?: { action?: ToastAction }) {
  items = [
    ...items,
    { id: nextId++, message, action: options?.action, open: true },
  ];
  emit();
}

export function Toaster() {
  const current = useSyncExternalStore(
    subscribe,
    () => items,
    () => EMPTY,
  );
  return (
    <Toast.Provider swipeDirection="down" label="Notification">
      {current.map((item) => (
        <Toast.Root
          key={item.id}
          open={item.open}
          onOpenChange={(open) => {
            if (!open) close(item.id);
          }}
          duration={item.action ? 8000 : 4000}
          type="background"
          className="flex min-h-11 max-w-[26rem] items-center gap-4 rounded-full border border-transparent bg-ink px-5 py-2 text-callout font-semibold text-canvas shadow-overlay animate-toast-in data-[state=closed]:animate-fade-out"
        >
          <Toast.Description>{item.message}</Toast.Description>
          {item.action ? (
            <Toast.Action
              altText={item.action.altText}
              onClick={item.action.onClick}
              // The ring is drawn on the ink toast, so it uses the canvas color there (~19:1 in both themes).
              className="hit-44 shrink-0 text-canvas underline underline-offset-4 [--focus:var(--canvas)]"
            >
              {item.action.label}
            </Toast.Action>
          ) : null}
        </Toast.Root>
      ))}
      <Toast.Viewport className="fixed bottom-[calc(16px+env(safe-area-inset-bottom)+var(--toast-offset,0px))] left-1/2 z-60 m-0 flex w-max max-w-[calc(100%-2*var(--gutter))] -translate-x-1/2 list-none flex-col items-center gap-2 p-0" />
    </Toast.Provider>
  );
}
