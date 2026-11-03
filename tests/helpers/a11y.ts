// What assistive tech is told about an element, for component tests (jsdom).

/** An element's accessible description: the text of its aria-describedby ids, in order. */
export const description = (el: HTMLElement) =>
  (el.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent)
    .join(" ");
