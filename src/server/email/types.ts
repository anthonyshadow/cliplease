import "server-only";

// The email layer's shared types (02 §5.10).

/** The 16 CORE templates (07 D123; the teen-consent email is Later, 07 D93). */
export type EmailTemplateId =
  | "sign-in-code"
  | "request-new"
  | "request-received"
  | "license-approved"
  | "request-declined"
  | "renewal-locked"
  | "renewal-reminder"
  | "renewal-price-proposed"
  | "renewal-price-reminder"
  | "renewal-price-decreased"
  | "renewal-price-response"
  | "auto-renew-changed"
  | "renewal-succeeded"
  | "renewal-payment-failed"
  | "renewal-reservation-started"
  | "renewal-reservation-reminder";

export type EmailMessage = {
  template: EmailTemplateId;
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
};

/** Who delivers an email: email_log.provider's values (03 §3.8). */
export type EmailProvider = "console" | "resend";

/** A transport: console in dev and test (P04), Resend from P26. `providerMessageId` is null for the console. */
export type EmailDriver = {
  provider: EmailProvider;
  send(
    message: EmailMessage,
    options?: { idempotencyKey?: string },
  ): Promise<{ providerMessageId: string | null }>;
};
