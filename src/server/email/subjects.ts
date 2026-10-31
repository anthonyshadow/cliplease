import "server-only";
import { REQUEST_EMAIL_COPY } from "@/emails/request-copy";
import { APP_NAME } from "@/lib/app-name";

// Email subjects (05 §8), built from APP_NAME. A subject never contains a sign-in code, token or link (07 D34).
export const signInCodeSubject = (): string => `Your ${APP_NAME} sign-in code`;

/** request-new: "New request: Daily Laughs Media LLC wants to license “First snow”" (curly quotes, 04 §11.1). */
export const requestNewSubject = REQUEST_EMAIL_COPY.newSubject;

/** request-received: "Request sent to @maya". */
export const requestReceivedSubject = REQUEST_EMAIL_COPY.receivedSubject;

/** license-approved: "Approved: your license CL-7K3M-9QXA is ready". */
export const licenseApprovedSubject = REQUEST_EMAIL_COPY.approvedSubject;

/** request-declined: "Not approved: you weren't charged", whatever the reason. */
export const requestDeclinedSubject = (): string =>
  REQUEST_EMAIL_COPY.declinedSubject;
