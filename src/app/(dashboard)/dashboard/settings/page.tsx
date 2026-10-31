import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TransferFailedBanner } from "@/components/layout/finish-payouts-banner";
import { SignOutSettingsButton } from "@/components/layout/sign-out";
import { PayoutCurrencyFacts } from "@/components/payouts/payout-currency-facts";
import { PayoutsStatusLine } from "@/components/payouts/payouts-status-line";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { FactList } from "@/components/ui/fact-list";
import { PRIMARY_WIDTH } from "@/components/ui/primary-width";
import { StatusPill } from "@/components/ui/status-pill";
import { ToastOnMount } from "@/components/ui/toast";
import { currencyLabel } from "@/lib/money/currency";
import {
  APPROVAL_WINDOW_LABEL,
  PAYOUTS_ON_MESSAGE,
  payoutsSetupHref,
  payoutsSetupLabel,
} from "@/lib/payouts";
import { GENERIC_ERROR_MESSAGE } from "@/lib/result";
import { requireCreator } from "@/server/auth/session";
import { payoutsStatusForPage } from "@/server/creators/profile";
import { settleCreatorMoney } from "@/server/licensing/lazy";
import { failedTransferTotalCents } from "@/server/licensing/money";
import { DisplayNameForm } from "./display-name-form";
import { TimeZoneRow } from "./time-zone-row";

export const metadata: Metadata = { title: "Settings" };

/**
 * This page sends the creator's transfers (07 D75), awaited back from payout setup and after the response otherwise, and
 * its actions re-render it with ?payouts=returned kept: 60 s keeps every send under the claim's 2-minute lease (07 D26).
 */
export const maxDuration = 60;

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
 * at every tier (07 D145). The payouts status is re-read when older than 10 minutes, and on the return from payout
 * setup (?payouts=returned) unless it was read in the last 10 s; a failed read shows the stored one. Payout setup that
 * failed comes back with ?payouts=error: an error Banner, with the setup button as the retry (05 §1). While payouts are
 * active the creator's pending and failed transfers are sent (07 D75; 05 §6.11 callout 2): back from payout setup within
 * the settle budget, before the failed total is read, so the transfer Banner above Payouts shows what is still owed;
 * otherwise after the response. Settings shows that Banner alone, never the setup banners: its Payouts section already
 * says what setup needs.
 */
export default async function SettingsPage({
  searchParams,
}: PageProps<"/dashboard/settings">) {
  const { user, creator } = await requireCreator("/dashboard/settings");
  const { payouts } = await searchParams;
  const returned = payouts === "returned";
  const status = await payoutsStatusForPage(creator.id, {
    row: creator,
    returned,
  });
  await settleCreatorMoney({
    creatorId: creator.id,
    payoutsStatus: status,
    wait: returned,
  });
  // After the sweep, never beside it: the total counts what it couldn't send.
  const failedCents = await failedTransferTotalCents(creator.id);
  const setupLabel = payoutsSetupLabel(status);

  return (
    <div className="flex w-full max-w-reading flex-col gap-8 py-6 lg:py-12">
      <h1 className="text-title-1 text-ink">Settings</h1>

      <TransferFailedBanner
        failedTransfer={{
          cents: failedCents,
          currency: creator.payoutCurrency,
        }}
        payoutsStatus={status}
      />

      <Section title="Payouts" id="payouts">
        {payouts === "error" ? (
          <Banner tone="error">{GENERIC_ERROR_MESSAGE}</Banner>
        ) : null}
        {status !== "active" ? (
          <StatusPill tone="awaiting" className="self-start">
            Finish payout setup
          </StatusPill>
        ) : null}
        <PayoutsStatusLine status={status} />
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
          <Button asChild className={PRIMARY_WIDTH}>
            <a href={payoutsSetupHref()}>{setupLabel}</a>
          </Button>
        ) : null}
        {/* Back from payout setup with payouts on (05 §6.11 States, proposed copy). The address keeps
            ?payouts=returned: rewriting it on the client starts a router update in Next 16, and a Settings action
            sent during it is cancelled. */}
        {returned && status === "active" ? (
          <ToastOnMount message={PAYOUTS_ON_MESSAGE} />
        ) : null}
      </Section>

      <Section title="Profile">
        <DisplayNameForm initial={creator.displayName}>
          <div className="flex flex-col gap-1">
            <p className="text-callout font-semibold text-ink">Handle</p>
            <p className="text-body text-ink">{`@${creator.handle}`}</p>
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
