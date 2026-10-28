import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { READING_COLUMN, SHELL_MAIN } from "@/components/layout/gutter";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { CHECKOUT_COPY } from "@/lib/licensing/checkout-copy";
import { cn } from "@/lib/utils";
import { openFakeCheckout } from "@/server/payments/fake-checkout";
import { fakeCheckoutCancel } from "./actions";

const COPY = CHECKOUT_COPY;

export const metadata: Metadata = {
  title: COPY.fakeTitle,
  robots: { index: false, follow: false },
};

/**
 * S28, the fake driver's checkout (05 §10; 07 D35), development and test only: the request's snapshot laid out like
 * Stripe's two line items, and Cancel (P16b adds Pay and Let it expire). 05 §10 draws no NavBar, so the page brings its
 * own <main> in the reading column. A request past checkout goes to its /r page.
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
        <form action={fakeCheckoutCancel.bind(null, checkout.id)}>
          <Button type="submit" variant="secondary">
            {COPY.cancel}
          </Button>
        </form>
      </div>
    </main>
  );
}
