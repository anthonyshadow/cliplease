"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import { SHELL_GUTTER } from "@/components/layout/gutter";
import { useKeepFocusAboveBar } from "@/components/layout/use-keep-focus-above-bar";
import { Button } from "@/components/ui/button";
import { FadeText } from "@/components/ui/fade-text";
import { formatMoney } from "@/lib/format";
import { LICENSE_PAGE_COPY } from "@/lib/licensing/license-page";
import type { Quote } from "@/lib/pricing/compute-quote";
import { cn } from "@/lib/utils";

/** The form the bar's button submits (04 §9.4). */
export const LICENSE_FORM_ID = "license-form";

const ANNOUNCE_DELAY_MS = 500;

/**
 * 04 §9.4 PriceBar, one bar at every tier (07 D148), last in the DOM after the form it submits. Below lg it is fixed at
 * the bottom: the license price and the service fee on two lines, the total beside them (on its own line when they
 * don't fit, 320 px), the full-width button; its content in the page column (640 on Tablet). From lg it is fixed under
 * the NavBar (it looks sticky: it sits there from the top of the page, and runs edge to edge as bars do, 07 D145): the
 * title and @handle, then every amount on one line and the button, in max-w-license. Every amount carries its currency
 * (07 D98). A visually hidden status says "Total {total}" 500 ms after the total settles, never on load.
 */
export function PriceBar({
  quote,
  title,
  handle,
  chooseTerritory,
  ready,
  pending,
}: {
  quote: Quote;
  title: string;
  handle: string;
  /** One country or One region with nothing chosen yet: the button says so. */
  chooseTerritory: "country" | "region" | null;
  /** The page has hydrated: before that a press would post the form to the page itself, so the button stays off. */
  ready: boolean;
  /** startCheckout is running: "Starting checkout…", and a second tap does nothing. */
  pending: boolean;
}) {
  useKeepFocusAboveBar();
  const bar = useRef<HTMLDivElement>(null);
  useBarHeight(bar);
  const money = (cents: number) => formatMoney(cents, quote.currency);
  const total = money(quote.totalCents);
  const announced = useAnnouncedTotal(total);
  return (
    <div
      ref={bar}
      data-pricebar
      data-covers-focus
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-hairline frosted pb-[env(safe-area-inset-bottom)] lg:top-(--nav-h) lg:bottom-auto lg:h-(--pricebar-h) lg:border-t-0 lg:border-b lg:pb-0",
        SHELL_GUTTER,
      )}
    >
      <div
        data-pricebar-content
        className="mx-auto flex w-full max-w-reading flex-col gap-2 pt-2.25 pb-2.5 lg:h-full lg:max-w-license lg:flex-row lg:items-center lg:gap-6 lg:py-0"
      >
        <div className="hidden min-w-0 flex-1 flex-col lg:flex">
          <p className="truncate text-callout font-semibold text-ink">
            {title}
          </p>
          <p className="truncate text-footnote text-ink-2">{`@${handle}`}</p>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-x-3 tabular-nums lg:flex-nowrap lg:items-baseline lg:gap-x-0">
          <p
            data-price-lines
            className="whitespace-nowrap text-footnote text-ink-2"
          >
            <FadeText
              className="block lg:inline"
              text={LICENSE_PAGE_COPY.license(money(quote.licensePriceCents))}
            />
            <span className="hidden lg:inline"> · </span>
            <FadeText
              className="block lg:inline"
              text={LICENSE_PAGE_COPY.serviceFee(money(quote.platformFeeCents))}
            />
          </p>
          <p
            data-price-total
            className="ml-auto whitespace-nowrap text-body font-semibold text-ink lg:ml-0 lg:text-callout"
          >
            <span className="hidden font-normal text-footnote text-ink-2 lg:inline">
              {" · "}
            </span>
            <FadeText text={LICENSE_PAGE_COPY.total(total)} />
          </p>
        </div>
        {/* Off until hydration (a disabled default button also stops Enter in a field from submitting). While no
            country or region is chosen it asks for one: the form's submit focuses the select (04 §9.3). */}
        <Button
          type="submit"
          form={LICENSE_FORM_ID}
          disabled={!ready}
          loading={pending}
          loadingLabel={LICENSE_PAGE_COPY.startingCheckout}
          className="w-full lg:hit-44 lg:h-9 lg:w-auto lg:min-w-0 lg:px-4 lg:text-callout"
        >
          {chooseTerritory
            ? LICENSE_PAGE_COPY[chooseTerritory].choose
            : LICENSE_PAGE_COPY.request(total)}
        </Button>
        <output aria-live="polite" className="sr-only">
          {announced}
        </output>
      </div>
    </div>
  );
}

/**
 * Below lg the bar is as tall as its content (108 px; more when the amounts wrap at 320 px): its height without the safe
 * area goes to `--pricebar-measured-h` on the root, which `--pricebar-h` reads below lg (globals.css), so the page's
 * bottom padding, the scroll padding and the toast offset follow (UploadIndicator's pattern). From lg the token is 56 px
 * whatever is measured: the tier stays in CSS (07 D144).
 */
function useBarHeight(bar: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const node = bar.current;
    if (!node) return;
    const root = document.documentElement;
    const measure = () => {
      const safeArea = Number.parseFloat(getComputedStyle(node).paddingBottom);
      root.style.setProperty(
        "--pricebar-measured-h",
        `${node.offsetHeight - safeArea}px`,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--pricebar-measured-h");
    };
  }, [bar]);
}

/** "Total {total}" once `total` has held for 500 ms after a change; "" until the first change (04 §9.4). */
function useAnnouncedTotal(total: string): string {
  const [announced, setAnnounced] = useState("");
  const said = useRef(total);
  useEffect(() => {
    if (total === said.current) return;
    const timer = setTimeout(() => {
      said.current = total;
      setAnnounced(LICENSE_PAGE_COPY.total(total));
    }, ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [total]);
  return announced;
}
