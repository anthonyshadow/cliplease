import type { ReactElement } from "react";
import { render, toPlainText } from "react-email";

// html-to-text capitalizes headings by default; the plain-text part keeps the email's own casing.
const PLAIN_TEXT = {
  selectors: [{ selector: "h1", options: { uppercase: false } }],
};

/** An email's two parts (infra §7): the HTML, and the plain text built from it. */
export async function renderEmail(
  element: ReactElement,
): Promise<{ html: string; text: string }> {
  const html = await render(element);
  return { html, text: toPlainText(html, PLAIN_TEXT) };
}
