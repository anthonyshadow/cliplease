// What assistive tech is told about an element, a focused press and the unload guard's answer, for component tests (jsdom).
import { act, fireEvent, screen } from "@testing-library/react";

/** An element's accessible description: the text of its aria-describedby ids, in order. */
export const description = (el: HTMLElement) =>
  (el.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent)
    .join(" ");

export const button = (name: string) => screen.getByRole("button", { name });
export const noButton = (name: string) =>
  screen.queryByRole("button", { name });

/** Press the named button, focused first as a press would (jsdom's click doesn't focus). */
export function pressFocused(name: string) {
  const target = button(name);
  act(() => target.focus());
  fireEvent.click(target);
}

/** Whether closing or reloading the tab would ask first. */
export function unloadPrevented() {
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  return unload.defaultPrevented;
}
