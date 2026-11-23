// The DOM of a sheet's component tests (the admin's Disable, Enable, Revoke and Retry; P21, P21b) and the Inbox's
// (P18): the open sheet (an alertdialog) and what is in it, a button's idle words, the footer's buttons, a tap that lets
// the action's answer render, a Server Action's answer held back or given, and the newest toast.
import { act, fireEvent, screen, within } from "@testing-library/react";
import type { Mock } from "vitest";

/** The open sheet: the test fails when there is none. */
export const sheet = () => screen.getByRole("alertdialog");

/** The open sheet, or null. */
export const noSheet = () => screen.queryByRole("alertdialog");

/** Queries in the open sheet. */
export const inSheet = () => within(sheet());

/** A button's words as a screen reader gets them while it is idle: without its hidden loading layer. */
export function label(button: Element): string {
  const copy = button.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) {
    hidden.remove();
  }
  return copy.textContent ?? "";
}

/** The footer's buttons, primary first as the sheet lays them out below md (the header's ✕ is not one of them). */
export const footerButtons = () => [
  ...sheet().querySelectorAll<HTMLButtonElement>("button[data-variant]"),
];

/** The footer as each button's idle words and variant. */
export const footer = () =>
  footerButtons().map((b) => [label(b), b.getAttribute("data-variant")]);

/** Taps the button named `name` in `scope` (the open sheet unless given) and lets the action's answer render. */
export async function press(name: string, scope: HTMLElement = sheet()) {
  await act(async () => {
    fireEvent.click(within(scope).getByRole("button", { name }));
  });
}

/**
 * Holds back a mocked Server Action's answer: the next call's, or with `every` each call's until the mock is set again.
 * Returns the call that gives it `value` and lets it render.
 */
export function holdAnswer(action: Mock, { every = false } = {}) {
  let answer: (value: unknown) => void = () => {};
  const held = new Promise((resolve) => {
    answer = resolve;
  });
  if (every) action.mockReturnValue(held);
  else action.mockReturnValueOnce(held);
  return (value: unknown) =>
    act(async () => {
      answer(value);
    });
}

/** A Server Action's answer that went through with `data`. */
export const answered = (data: unknown) => ({ ok: true, data });

/**
 * The newest toast: the last item of the Toaster's list (Radix renders each toast as an `li` of the viewport's `ol`).
 * The toast store outlives a test, so a file's earlier toasts are still listed: compare the last one, or the count
 * before and after.
 */
export const latestToast = () =>
  [...document.querySelectorAll("ol > li")].at(-1) ?? null;

/** How many toasts the Toaster lists now (the store outlives a test: compare before and after). */
export const toastCount = () => document.querySelectorAll("ol > li").length;
