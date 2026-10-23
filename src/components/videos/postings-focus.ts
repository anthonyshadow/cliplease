// Where focus goes on "Where was it posted?" (04 §9.33 Footer, §9.6; 05 §6.5 Interaction notes): after a Continue, an
// Add another link, a Remove, a Move or a check. DOM-only: PostingsForm asks once the render it waits for has painted.
import { linkFieldId } from "./posting-link-row";

/**
 * Where focus goes next: the first problem, a row's link field, a checked row's action or result, or a card's "Add
 * another link" (`key` is then the platform) when the field removed was its only added one.
 */
export type FocusTarget =
  | { kind: "problem" }
  | { kind: "link" | "row" | "add"; key: string };

/**
 * After a Continue, in order: the first field error, the refusal Banner, the chips ("Say where it was posted"), the
 * first link that needs action (its action, else its result), then a same-video tick still to tick (04 §9.33 Footer).
 */
const PROBLEMS = [
  '[aria-invalid="true"]',
  "[data-form-error]",
  "[data-chip-error] button",
  "[data-needs-action] [data-row-action]",
  "[data-needs-action] [data-posting-result]",
  '[data-same-video] input[type="checkbox"]:not(:checked)',
];

/** The element itself when it takes focus, else the link or button inside it (a Connect link's wrapper). */
function focusable(el: Element | null): HTMLElement | null {
  if (!(el instanceof HTMLElement)) return null;
  return el.matches("a, button, input, [tabindex]")
    ? el
    : el.querySelector<HTMLElement>("a, button");
}

function firstProblem(form: HTMLElement): HTMLElement | null {
  for (const selector of PROBLEMS) {
    const target = focusable(form.querySelector(selector));
    if (target) return target;
  }
  return null;
}

/** A checked row: its action, else "Checking the link…", else its result (focus left the removed button). */
function rowTarget(form: HTMLElement, key: string): HTMLElement | null {
  // Keys are posting ids (uuids) or "new-<n>": nothing to escape in the selector.
  const row = form.querySelector(`[data-row-key="${key}"]`);
  if (!row) return null;
  const active = document.activeElement;
  if (active && active !== document.body && !row.contains(active)) return null;
  return (
    focusable(row.querySelector("[data-row-action]")) ??
    focusable(row.querySelector("[data-checking]")) ??
    focusable(row.querySelector("[data-posting-result]"))
  );
}

/** The element a focus request lands on, or null (nothing there, or focus already elsewhere for a row's check). */
export function focusTarget(
  form: HTMLElement,
  target: FocusTarget,
): HTMLElement | null {
  if (target.kind === "problem") return firstProblem(form);
  if (target.kind === "link") {
    return document.getElementById(linkFieldId(target.key));
  }
  if (target.kind === "add") {
    return form.querySelector<HTMLElement>(
      `[data-posting-card="${target.key}"] [data-add-link]`,
    );
  }
  return rowTarget(form, target.key);
}
