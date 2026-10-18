import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SignOutSettingsButton } from "@/components/layout/sign-out";
import { PayoutCurrencyFacts } from "@/components/payouts/payout-currency-facts";
import { Button } from "@/components/ui/button";
import { FactList } from "@/components/ui/fact-list";
import { INLINE_LINK } from "@/components/ui/inline-link";
import { StatusPill } from "@/components/ui/status-pill";
import { SUPPORT_EMAIL } from "@/lib/app-name";
import { currencyLabel } from "@/lib/money/currency";
import {
  APPROVAL_WINDOW_LABEL,
  PAYOUTS_STATUS_LABEL,
  payoutsSetupLabel,
} from "@/lib/payouts";
import { requireCreator } from "@/server/auth/session";
import { refreshPayoutsStatus } from "@/server/creators/profile";
import { DisplayNameForm } from "./display-name-form";
import { PayoutsReturnedToast } from "./payouts-returned-toast";
import { TimeZoneRow } from "./time-zone-row";

export const metadata: Metadata = { title: "Settings" };

function Section({
  title,
  id,
  children,
}: {
  title: string;
  id?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id ?? title.toLowerCase()}-title`}
      className="flex flex-col gap-4 border-t border-hairline pt-6 first-of-type:border-t-0 first-of-type:pt-0"
    >
      <h2
        id={`${id ?? title.toLowerCase()}-title`}
        className="text-title-2 text-ink"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * S23 (05 §6.11): Payouts, Profile, Requests, Emails, Account, in one max-w-reading column left-aligned with the title
 * at every tier (07 D145). The payouts status is re-read when older than 10 minutes, and always on the return from
 * payout setup (?payouts=returned).
 */
export default async function SettingsPage({
  searchParams,
}: PageProps<"/dashboard/settings">) {
  const { user, creator } = await requireCreator("/dashboard/settings");
  const { payouts } = await searchParams;
  const returned = payouts === "returned";
  const status = await refreshPayoutsStatus(
    creator.id,
    returned ? { maxAgeMs: 0 } : {},
  );
  const setupLabel = payoutsSetupLabel(status);
  const unavailable = status === "rejected" || status === "unsupported";

  return (
    <div className="flex w-full max-w-reading flex-col gap-8 py-6 lg:py-12">
      <h1 className="text-title-1 text-ink">Settings</h1>

      <Section title="Payouts" id="payouts">
        {status !== "active" ? (
          <StatusPill tone="awaiting" className="self-start">
            Finish payout setup
          </StatusPill>
        ) : null}
        {unavailable ? (
          <p className="text-body text-ink">
            Payouts unavailable. Contact{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className={INLINE_LINK}>
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        ) : (
          <p className="text-body text-ink">{PAYOUTS_STATUS_LABEL[status]}</p>
        )}
        <FactList
          facts={[
            {
              label: "Payout currency",
              value: currencyLabel(creator.payoutCurrency),
            },
          ]}
        />
        <PayoutCurrencyFacts currency={creator.payoutCurrency} />
        {setupLabel ? (
          <Button asChild className="w-full md:w-auto md:self-start">
            <a href="/api/stripe/onboarding">{setupLabel}</a>
          </Button>
        ) : null}
        {returned && status === "active" ? <PayoutsReturnedToast /> : null}
      </Section>

      <Section title="Profile">
        <DisplayNameForm initial={creator.displayName}>
          <div className="flex flex-col gap-1">
            <p className="text-callout font-semibold text-ink">Handle</p>
            <p className="text-body text-ink wrap-anywhere">{`@${creator.handle}`}</p>
            <p className="text-footnote text-ink-2">
              Handles can't change yet.
            </p>
          </div>
        </DisplayNameForm>
      </Section>

      <Section title="Requests">
        <FactList
          facts={[
            {
              label: "Time to answer",
              value: APPROVAL_WINDOW_LABEL[creator.approvalWindowHours],
            },
          ]}
        />
      </Section>

      <Section title="Emails">
        <TimeZoneRow zone={creator.timeZone} />
      </Section>

      <Section title="Account">
        <FactList facts={[{ label: "Email", value: user.email }]} />
        <SignOutSettingsButton />
      </Section>
    </div>
  );
}
