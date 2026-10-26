"use client";

import { useCallback, useEffect, useRef } from "react";

/** The longest an update waits for its press to end in a click (a press released off the page has none). */
const PRESS_WAIT_MS = 1000;

/**
 * Returns `later(update)`: runs `update` once the press in progress, if any, has ended in its click; at once otherwise
 * (a key press). A field's error shown on blur moves the controls below it; shown between the pointerdown that blurred
 * the field and that press's click, it moves the control under the pointer and the click is lost (P12 met it in
 * WebKit; P15's license form in Chromium and WebKit both).
 */
export function useAfterPress() {
  const pressing = useRef(false);
  useEffect(() => {
    const listeners = new AbortController();
    const track = (type: string, value: boolean) =>
      window.addEventListener(
        type,
        () => {
          pressing.current = value;
        },
        { capture: true, signal: listeners.signal },
      );
    track("pointerdown", true);
    track("mousedown", true);
    track("click", false);
    track("pointercancel", false);
    track("keydown", false);
    return () => listeners.abort();
  }, []);
  return useCallback((update: () => void) => {
    if (!pressing.current) {
      update();
      return;
    }
    const waiting = new AbortController();
    const run = () => {
      if (waiting.signal.aborted) return;
      waiting.abort();
      clearTimeout(fallback);
      // After the click's own handlers, so it lands where the pointer was.
      setTimeout(update, 0);
    };
    const fallback = setTimeout(run, PRESS_WAIT_MS);
    window.addEventListener("click", run, { signal: waiting.signal });
  }, []);
}
