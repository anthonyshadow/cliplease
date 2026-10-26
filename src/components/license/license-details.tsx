"use client";

import { type FocusEvent, type ReactNode, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { NativeCheckbox } from "@/components/ui/checkbox";
import { INLINE_LINK } from "@/components/ui/inline-link";
import { TextArea, TextField } from "@/components/ui/text-field";
import { useAfterPress } from "@/components/ui/use-after-press";
import type { Currency } from "@/lib/domain/values";
import {
  LICENSE_V1_DISPLAY_TITLE,
  LICENSE_V1_VERSION,
} from "@/lib/legal/license-v1-summary";
import {
  type DetailsField,
  detailsFieldError,
  INTENDED_USE_MAX,
} from "@/lib/licensing/details";
import { LICENSE_PAGE_COPY } from "@/lib/licensing/license-page";
import { LICENSE_FORM_ID } from "./price-bar";

const COPY = LICENSE_PAGE_COPY;

/** What the form posts besides the fields (02 §5.7): the choice, the quote's total and the render's id. */
export type LicenseFormValues = {
  videoId: string;
  useKey: string;
  termKey: string;
  territoryKey: string;
  /** "" while none is chosen (and for Worldwide); P16a reads "" as null. */
  territoryCode: string;
  submissionId: string;
  expectedTotalCents: number;
  /** The viewer's IANA zone once the page has mounted; "" before (the server then uses UTC, 07 D84). */
  timeZone: string;
};

/** A two-tone heading (04 §4.3): "Use." then the question in ink-2, one size and weight. */
export const twoTone = ([word, question]: readonly [string, string]) => (
  <>
    {`${word} `}
    <span className="text-ink-2">{question}</span>
  </>
);

/** A link inside running text that opens the legal page in a new tab, keeping the buyer's choices on this one. */
function LegalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={INLINE_LINK}
    >
      {children}
    </a>
  );
}

/**
 * 01 J7.5; 04 §11.2; 05 §4.1 callouts 13–14: "Your details. For the license.", the four fields, the terms checkbox and
 * the hidden inputs, as `#license-form` (the PriceBar's button submits it). The option tiles sit outside it, so each
 * choice is posted once, by its hidden input. A field shows its error on blur once the buyer has typed in it (an
 * untouched field stays quiet while tabbing past), with the server schema's rules and words (owner answer Q-109 a), and
 * after the tap that blurred it has landed (useAfterPress). No action until P16a: submitting does nothing.
 */
export function LicenseDetails({
  handle,
  values,
}: {
  handle: string;
  values: LicenseFormValues;
}) {
  const [errors, setErrors] = useState<Partial<Record<DetailsField, string>>>(
    {},
  );
  // Read only by the handlers below, so a ref: typing re-renders nothing.
  const typed = useRef(new Set<DetailsField>());
  const afterPress = useAfterPress();
  const field = (name: DetailsField) => ({
    name,
    error: errors[name],
    onChange: () => {
      typed.current.add(name);
    },
    onBlur: (event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (!typed.current.has(name)) return;
      const error = detailsFieldError(name, event.target.value) ?? undefined;
      afterPress(() => setErrors((current) => ({ ...current, [name]: error })));
    },
  });
  return (
    <form
      id={LICENSE_FORM_ID}
      method="post"
      noValidate
      onSubmit={(event) => event.preventDefault()}
      className="flex flex-col gap-6"
    >
      <h2 className="text-title-2 text-ink">
        {twoTone(COPY.headings.details)}
      </h2>
      <TextField
        label={COPY.licensedTo}
        autoComplete="organization"
        helper={COPY.licensedToHelp}
        required
        {...field("licenseeName")}
      />
      <div className="flex flex-col gap-6 md:grid md:grid-cols-2 md:items-start md:gap-4">
        <TextField
          label={COPY.yourName}
          autoComplete="name"
          required
          {...field("contactName")}
        />
        <TextField
          label={COPY.email}
          type="email"
          inputMode="email"
          autoComplete="email"
          helper={COPY.emailHelper}
          required
          {...field("buyerEmail")}
        />
      </div>
      <TextArea
        label={COPY.intendedUse}
        optional
        rows={2}
        maxLength={INTENDED_USE_MAX}
        helper={COPY.intendedUseHelper(handle)}
        {...field("intendedUse")}
      />
      <NativeCheckbox
        name="acceptTerms"
        required
        label={
          <>
            {"I agree to the "}
            <LegalLink href="/legal/license/v1">
              {LICENSE_V1_DISPLAY_TITLE}
            </LegalLink>
            {" and "}
            <LegalLink href="/legal/terms">Terms</LegalLink>
            {". I'm 18 or older and buying for business or professional use."}
          </>
        }
      />
      <input type="hidden" name="videoId" value={values.videoId} />
      <input type="hidden" name="useKey" value={values.useKey} />
      <input type="hidden" name="termKey" value={values.termKey} />
      <input type="hidden" name="territoryKey" value={values.territoryKey} />
      <input type="hidden" name="territoryCode" value={values.territoryCode} />
      <input type="hidden" name="termsVersion" value={LICENSE_V1_VERSION} />
      <input type="hidden" name="submissionId" value={values.submissionId} />
      <input
        type="hidden"
        name="expectedTotalCents"
        value={values.expectedTotalCents}
      />
      <input type="hidden" name="timeZone" value={values.timeZone} />
    </form>
  );
}

/**
 * 01 J7.6 (manual approval; P19c adds the auto variant) and 04 §11.2's small print. The deadline is an estimate, now plus
 * the creator's approval window in the viewer's zone, so it renders only after mount (`deadline` null before; no
 * clock reads in the server render, 02 §4.4). Then the legal links, in a new tab like the summary's.
 */
export function HoldCopy({
  handle,
  total,
  deadline,
  currency,
}: {
  handle: string;
  /** formatMoney's total, the bar's. */
  total: string;
  deadline: string | null;
  currency: Currency;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-callout text-ink-2">
        <span className="font-semibold text-ink">{COPY.holdLead(handle)}</span>
        {` ${COPY.holdAmount(total)}`}
        {deadline ? ` ${COPY.holdDeadline(handle, deadline)}` : null}
      </p>
      <p className="text-footnote text-ink-2">
        {[...COPY.smallPrint(handle), COPY.currencyFaq(currency)].join(" ")}
      </p>
      <ul className="flex flex-wrap items-center gap-x-2 text-footnote text-ink-2">
        {COPY.legalLinks.map((link, index) => (
          <li key={link.href} className="flex items-center gap-x-2">
            {index > 0 ? <span aria-hidden>·</span> : null}
            <Button asChild variant="link" size="sm">
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${link.label} (opens in a new tab)`}
              >
                {link.label}
              </a>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
