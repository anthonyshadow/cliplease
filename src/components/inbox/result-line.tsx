"use client";

import { SetUpPayoutsLink } from "@/components/payouts/set-up-payouts-link";
import { SupportEmailLink } from "@/components/ui/support-email-link";
import { INBOX_COPY, type ResultLine } from "@/lib/licensing/inbox";
import { cn } from "@/lib/utils";
import { PayoutsWaiting } from "./payouts-waiting";

const LINE = "text-footnote wrap-anywhere";

/** "License {code} issued" (04 §11.5): a held row's line and the approved request page's. P20 adds " · View license". */
export function LicenseIssuedLine({
  code,
  id,
  className,
}: {
  code: string;
  id?: string;
  className?: string;
}) {
  return (
    <p id={id} className={cn(LINE, "text-ink", className)}>
      {INBOX_COPY.licenseIssued(code)}
    </p>
  );
}

/** An action's result in words (04 §11.5), under a row's "You get" line or above the request page's actions. */
export function ResultLineView({
  line,
  expiresAt,
  id,
}: {
  line: ResultLine;
  /** The request's deadline, for the payouts sentence. */
  expiresAt: string | null;
  id?: string;
}) {
  const shown = cn(LINE, "animate-fade-in");
  switch (line.kind) {
    case "issued":
      return (
        <LicenseIssuedLine
          id={id}
          code={line.code}
          className="animate-fade-in"
        />
      );
    case "text":
      return (
        <p
          id={id}
          className={cn(shown, line.danger ? "text-danger-text" : "text-ink-2")}
        >
          {line.text}
        </p>
      );
    case "original_missing":
      return (
        <p id={id} className={cn(shown, "text-ink-2")}>
          {INBOX_COPY.originalMissing} <SupportEmailLink />
        </p>
      );
    case "payouts":
      return (
        <div id={id} className={cn(shown, "flex flex-col items-start gap-1")}>
          <p className="text-ink-2">
            {expiresAt ? <PayoutsWaiting expiresAt={expiresAt} /> : null}
          </p>
          <SetUpPayoutsLink size="sm" />
        </div>
      );
  }
}
