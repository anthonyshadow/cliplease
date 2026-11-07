"use client";

import Link from "next/link";
import { CREATOR_NAV } from "@/components/layout/creator-nav";
import { SetUpPayoutsLink } from "@/components/payouts/set-up-payouts-link";
import { INLINE_LINK } from "@/components/ui/inline-link";
import { SupportEmailLink } from "@/components/ui/support-email-link";
import { INBOX_COPY, type ResultLine } from "@/lib/licensing/inbox";
import { payoutLine } from "@/lib/licensing/payout-line";
import type { CreatorRequest } from "@/lib/licensing/request-dto";
import { cn } from "@/lib/utils";
import { PayoutsWaiting } from "./payouts-waiting";

/** A request's footnote line in a row's text column or the request page's status block (04 §9.11). */
export const LINE = "text-footnote wrap-anywhere";

/** "View license" → /dashboard/licenses (04 §10.3, §11.5): after the issued line, and after a History row's code. */
export function ViewLicenseLink() {
  return (
    <Link
      href={CREATOR_NAV.licenses.href}
      className={cn(INLINE_LINK, "hit-44 text-footnote")}
    >
      {INBOX_COPY.viewLicense}
    </Link>
  );
}

/**
 * "License {code} issued · View license" (04 §10.3, §11.5): a held row's line and the approved request page's. The
 * sentence keeps an element of its own, so it reads (and is found) without the link.
 */
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
      <span>{INBOX_COPY.licenseIssued(code)}</span> · <ViewLicenseLink />
    </p>
  );
}

/** 04 §9.11's tones for those lines: the payout line's, and auto-approve's. */
export const LINE_TONE = {
  cleared: "text-cleared-text",
  neutral: "text-ink-2",
  awaiting: "text-awaiting-text",
} as const;

/**
 * An approved request's payout line (04 §9.11, §11.5; owner answer Q-146 a): Paid out, Payout pending, or "Finish your
 * payout setup to receive {amount}.", in the History row's text column and under the request page's code. Nothing before
 * the transfer row exists, or for a canceled one.
 */
export function PayoutLineView({
  request,
}: {
  request: Pick<
    CreatorRequest,
    "transferStatus" | "transferAmountCents" | "transferCurrency"
  >;
}) {
  const {
    transferStatus: status,
    transferAmountCents: amountCents,
    transferCurrency: currency,
  } = request;
  const line = payoutLine(
    status && amountCents !== null && currency
      ? { status, amountCents, currency }
      : null,
  );
  if (!line) return null;
  return <p className={cn(LINE, LINE_TONE[line.tone])}>{line.text}</p>;
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
