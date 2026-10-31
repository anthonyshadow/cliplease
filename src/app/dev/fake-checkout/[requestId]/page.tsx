import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { READING_COLUMN, SHELL_MAIN } from "@/components/layout/gutter";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { PRIMARY_WIDTH, TERTIARY } from "@/components/ui/primary-width";
import { formatMoney } from "@/lib/format";
import { CHECKOUT_COPY } from "@/lib/licensing/checkout-copy";
import { cn } from "@/lib/utils";
import { openFakeCheckout } from "@/server/payments/fake-checkout";
import {
  fakeCheckoutCancel,
  fakeCheckoutExpire,
  fakeCheckoutPay,
} from "./actions";

const COPY = CHECKOUT_COPY;

export const metadata: Metadata = {
  title: COPY.fakeTitle,
  robots: { index: false, follow: false },
};

/**
 * Pay's work after the response can capture an auto-approve request and send the creator's transfer (07 D75, D81):
 * every route that can send one stops within 60 s, inside the 2-minute claim lease (P19b). Its actions file is "use
 * server", which can't export it.
 */
export const maxDuration = 60;

/**
 * S28, the fake driver's checkout (05 §10; 07 D35), development and test only: the request's snapshot laid out like
 * Stripe's two line items, then Pay, Cancel and Let it expire (02 §5.8). 05 §10 draws no NavBar, so the page brings its
 * own <main> in the reading column. A request past checkout goes to its /r page. Like Stripe's, the buttons show no
 * pending label: each answers with a redirect.
 */
export default async function FakeCheckoutPage({
  params,
}: PageProps<"/dev/fake-checkout/[requestId]">) {
  const checkout = await openFakeCheckout((await params).requestId);
  if (!checkout) notFound();
  if (checkout.status !== "checkout_pending") redirect(checkout.returnPath());
  const lines = [
    { label: COPY.license, cents: checkout.licensePriceCents },
    { label: COPY.serviceFee, cents: checkout.platformFeeCents },
    { label: COPY.total, cents: checkout.amountTotalCents, total: true },
  ];
  return (
    <main className={SHELL_MAIN}>
      <div className={READING_COLUMN}>
        <Banner tone="warning" live={false}>
          {COPY.fakeBanner}
        </Banner>
        <div className="flex flex-col gap-1">
          <h1 className="text-title-1 text-ink wrap-anywhere">
            {checkout.title}
          </h1>
          <p className="text-body text-ink-2">{checkout.scope}</p>
        </div>
        <dl className="flex flex-col gap-2">
          {lines.map((line) => (
            <div
              key={line.label}
              className={cn(
                "flex items-baseline justify-between gap-4 text-body text-ink",
                line.total && "font-semibold",
              )}
            >
              <dt>{line.label}</dt>
              <dd className="tabular-nums">
                {formatMoney(line.cents, checkout.currency)}
              </dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-col gap-3">
          <form
            action={fakeCheckoutPay.bind(null, checkout.id)}
            className="flex flex-col"
          >
            <Button type="submit" className={PRIMARY_WIDTH}>
              {COPY.pay(
                formatMoney(checkout.amountTotalCents, checkout.currency),
              )}
            </Button>
          </form>
          <form action={fakeCheckoutCancel.bind(null, checkout.id)}>
            <Button type="submit" variant="secondary">
              {COPY.cancel}
            </Button>
          </form>
          <form action={fakeCheckoutExpire.bind(null, checkout.id)}>
            <Button type="submit" variant="tertiary" className={TERTIARY}>
              {COPY.letItExpire}
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}
