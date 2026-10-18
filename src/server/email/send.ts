import "server-only";
import { createElement } from "react";
import { render, toPlainText } from "react-email";
import { SignInCode } from "@/emails/sign-in-code";
import { env } from "@/server/env";
import { createConsoleDriver } from "./drivers/console";
import { signInCodeSubject } from "./subjects";
import type { EmailDriver } from "./types";

export type { EmailTemplateId } from "./types";

// html-to-text capitalizes headings by default; the plain-text part keeps the email's own casing.
const PLAIN_TEXT = {
  selectors: [{ selector: "h1", options: { uppercase: false } }],
};

/** The console driver while RESEND_API_KEY is unset (Phase A). The Resend driver arrives in P26. */
export function emailDriver(): EmailDriver {
  if (env.RESEND_API_KEY) throw new Error("Resend driver arrives in P26");
  return createConsoleDriver();
}

/**
 * Sends a 6-digit sign-in code (02 §5.10). The subject never contains the code. No email_log row and no log line: sign-in
 * codes are never logged (07 D47). Called only from the Better Auth sendVerificationOTP hook.
 */
export async function sendSignInCode(to: string, code: string): Promise<void> {
  const html = await render(createElement(SignInCode, { code }));
  await emailDriver().send({
    template: "sign-in-code",
    from: env.EMAIL_FROM,
    to,
    subject: signInCodeSubject(),
    html,
    text: toPlainText(html, PLAIN_TEXT),
  });
}
