"use client";

import { type FormEvent, type MouseEvent, useRef, useState } from "react";
import { TWO_COLUMN } from "@/components/layout/gutter";
import {
  type PreviewOptions,
  PricePreview,
} from "@/components/pricing/price-preview";
import { PricesTitle } from "@/components/pricing/prices-title";
import { RateRow } from "@/components/pricing/rate-row";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { PRIMARY_WIDTH, TERTIARY } from "@/components/ui/primary-width";
import { FieldMessages, fieldIds, TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast";
import { usePendingAction } from "@/components/ui/use-pending-action";
import { useUnsavedChangesGuard } from "@/components/ui/use-unsaved-changes-guard";
import {
  RATE_DIMENSION_KEYS,
  RATE_DIMENSIONS,
  type RateDimension,
  type RateOptionKey,
} from "@/lib/domain/values";
import { formatMoney } from "@/lib/format";
import { DIMENSION_LABELS, rateOptionLabel } from "@/lib/licensing/options";
import { CURRENCY_DISPLAY, currencyLabel } from "@/lib/money/currency";
import { examplePriceCents, rateChoices } from "@/lib/pricing/choices";
import {
  multiplierFieldValue,
  parseMultiplierBps,
  parseWholeDollars,
  wholeDollarsFieldValue,
} from "@/lib/pricing/multiplier";
import {
  BASE_PRICE_MAX_CENTS,
  BASE_PRICE_MIN_CENTS,
  DEFAULT_BASE_PRICE_CENTS,
} from "@/lib/pricing/presets";
import { GENERIC_ERROR_MESSAGE } from "@/lib/result";
import { cn } from "@/lib/utils";
import {
  basePriceCentsSchema,
  defaultRateCardInput,
  MultiplierBpsSchema,
  type RateCardInput,
  rateCardFieldErrors,
  rateCardInputSchema,
} from "@/lib/validation/pricing";
import type { RateCardDTO } from "@/server/pricing/rate-card";
import { saveRateCard } from "./actions";

const BASE = "basePriceCents";
const GROUP_ERROR_ID = (dimension: RateDimension) => `rate-card-${dimension}`;
// The error fields in page order: where a failed Save moves the focus first.
const FIELD_ORDER = [
  BASE,
  ...RATE_DIMENSIONS.flatMap((d) => [d, ...RATE_DIMENSION_KEYS[d]]),
];

/** One option as typed: its text, and the last value that passed the bounds, which the prices use meanwhile. */
type Row = {
  dimension: RateDimension;
  key: RateOptionKey;
  enabled: boolean;
  text: string;
  bps: number;
};

type Form = { baseText: string; baseCents: number; rows: Row[] };

function formOf(card: RateCardInput): Form {
  return {
    baseText: wholeDollarsFieldValue(card.basePriceCents),
    baseCents: card.basePriceCents,
    rows: card.options.map((o) => ({
      dimension: o.dimension,
      key: o.key,
      enabled: o.enabled,
      text: multiplierFieldValue(o.multiplierBps),
      bps: o.multiplierBps,
    })),
  };
}

/** What Save sends: the typed text read again, NaN where it doesn't read as a number (the schema names it). */
function inputOf(form: Form) {
  return {
    basePriceCents: parseWholeDollars(form.baseText) ?? Number.NaN,
    options: form.rows.map((r) => ({
      dimension: r.dimension,
      key: r.key,
      enabled: r.enabled,
      multiplierBps: parseMultiplierBps(r.text) ?? Number.NaN,
    })),
  };
}

/** The form as text, to tell unsaved edits from the saved card. */
const textsOf = (form: Form) =>
  JSON.stringify([form.baseText, form.rows.map((r) => [r.enabled, r.text])]);

/**
 * S21 (05 §6.9, J4): the base price and the 10 options, each with its example price, and the PricePreview, all from
 * computeQuote on every keystroke. Nothing saves before Save prices, except a confirmed Reset to defaults (owner answer
 * Q-92). Errors show on Save (04 §9.6), which moves the focus to the first one.
 */
export function RateCardEditor({
  card,
  platformFeeBps,
}: {
  card: RateCardDTO;
  platformFeeBps: number;
}) {
  const { currency } = card;
  const [form, setForm] = useState(() => formOf(card));
  const [savedTexts, setSavedTexts] = useState(() => textsOf(formOf(card)));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, runSave] = usePendingAction();
  const [saveFailed, setSaveFailed] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, runReset] = usePendingAction();
  const [resetFailed, setResetFailed] = useState(false);
  // The control each error field moves the focus to: the base field, a row's multiplier, a group's first switch.
  const controls = useRef(new Map<string, HTMLElement>());
  const register = (field: string) => (element: HTMLElement | null) => {
    if (element) controls.current.set(field, element);
    else controls.current.delete(field);
  };

  useUnsavedChangesGuard(textsOf(form) !== savedTexts);

  const clearError = (field: string) =>
    setErrors((prev) => {
      if (!(field in prev)) return prev;
      const { [field]: _, ...rest } = prev;
      return rest;
    });

  function showErrors(fields: Record<string, string>) {
    setErrors(fields);
    const first = FIELD_ORDER.find((field) => field in fields);
    if (first) controls.current.get(first)?.focus();
  }

  function setBaseText(text: string) {
    const cents = parseWholeDollars(text);
    const valid =
      cents !== null && basePriceCentsSchema(currency).safeParse(cents).success;
    setForm((f) => ({
      ...f,
      baseText: text,
      baseCents: valid ? cents : f.baseCents,
    }));
    clearError(BASE);
  }

  function setRow(key: RateOptionKey, change: Partial<Row>) {
    setForm((f) => ({
      ...f,
      rows: f.rows.map((r) => (r.key === key ? { ...r, ...change } : r)),
    }));
  }

  function setRowText(key: RateOptionKey, text: string) {
    const bps = parseMultiplierBps(text);
    const valid = bps !== null && MultiplierBpsSchema.safeParse(bps).success;
    setRow(key, valid ? { text, bps } : { text });
    clearError(key);
  }

  /** After a save: the card is what's stored now, and it fills the form unless the form was edited meanwhile. */
  function onSaved(saved: RateCardInput, submitted: string) {
    const next = formOf(saved);
    setForm((current) => (textsOf(current) === submitted ? next : current));
    setSavedTexts(textsOf(next));
    setErrors({});
    setSaveFailed(false);
    toast("Prices saved.");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const input = inputOf(form);
    const parsed = rateCardInputSchema(currency).safeParse(input);
    if (!parsed.success) {
      showErrors(rateCardFieldErrors(parsed.error, input));
      return;
    }
    const submitted = textsOf(form);
    setSaveFailed(false);
    const result = await runSave(() => saveRateCard(parsed.data));
    if (result === null) return;
    if (result.ok) {
      onSaved(parsed.data, submitted);
      return;
    }
    const { fields } = result.error;
    if (fields) {
      showErrors(
        Object.fromEntries(
          Object.entries(fields).map(([field, [message = ""]]) => [
            field,
            message,
          ]),
        ),
      );
    } else {
      setSaveFailed(true);
    }
  }

  async function reset(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (resetting) return;
    const defaults = defaultRateCardInput(currency);
    // The sheet holds the focus while it runs, so the form can't change meanwhile.
    const submitted = textsOf(form);
    setResetFailed(false);
    const result = await runReset(() => saveRateCard(defaults));
    if (result === null) return;
    if (!result.ok) {
      setResetFailed(true);
      return;
    }
    setResetOpen(false);
    onSaved(defaults, submitted);
  }

  const choices = rateChoices(
    form.rows.map((r) => ({
      key: r.key,
      multiplierBps: r.bps,
      enabled: r.enabled,
    })),
  );
  const preview: PreviewOptions = {
    currency,
    basePriceCents: form.baseCents,
    ...choices,
  };
  const examplePrice = (row: Row) => {
    const cents = examplePriceCents(
      form.baseCents,
      choices,
      row.dimension,
      row.bps,
    );
    return cents === null ? null : formatMoney(cents, currency);
  };

  const whole = (cents: number) =>
    formatMoney(cents, currency, { wholeDollars: true });

  return (
    <form noValidate onSubmit={save} className={TWO_COLUMN.page}>
      <div className={cn(TWO_COLUMN.span, "flex flex-col gap-2")}>
        <PricesTitle />
        <p className="text-footnote text-ink-2">
          {`Your prices are in ${currencyLabel(currency)}.`}
        </p>
      </div>

      <div className={cn(TWO_COLUMN.main, "flex flex-col gap-8")}>
        <TextField
          ref={register(BASE)}
          label="Base price"
          prefix={CURRENCY_DISPLAY[currency].prefix}
          inputMode="decimal"
          autoComplete="off"
          helper={`${whole(BASE_PRICE_MIN_CENTS[currency])} to ${whole(BASE_PRICE_MAX_CENTS[currency])}. New requests only.`}
          value={form.baseText}
          onChange={(event) => setBaseText(event.target.value)}
          error={errors[BASE]}
        />
        {RATE_DIMENSIONS.map((dimension) => {
          const groupError = errors[dimension];
          const errorId = fieldIds(GROUP_ERROR_ID(dimension)).error;
          return (
            <fieldset key={dimension} className="flex flex-col gap-4">
              <legend className="mb-4 text-title-2 text-ink">
                {DIMENSION_LABELS[dimension]}
              </legend>
              <FieldMessages
                id={GROUP_ERROR_ID(dimension)}
                error={groupError}
              />
              {form.rows
                .filter((r) => r.dimension === dimension)
                .map((row, i) => (
                  <RateRow
                    key={row.key}
                    label={rateOptionLabel(row.key)}
                    enabled={row.enabled}
                    onEnabledChange={(enabled) => {
                      setRow(row.key, { enabled });
                      clearError(dimension);
                    }}
                    multiplier={row.text}
                    onMultiplierChange={(text) => setRowText(row.key, text)}
                    error={errors[row.key]}
                    examplePrice={examplePrice(row)}
                    groupErrorId={groupError ? errorId : undefined}
                    switchRef={i === 0 ? register(dimension) : undefined}
                    fieldRef={register(row.key)}
                  />
                ))}
            </fieldset>
          );
        })}
      </div>

      <div
        className={cn(
          TWO_COLUMN.side,
          "flex flex-col gap-4 lg:sticky lg:top-[calc(var(--nav-h)+24px)]",
        )}
      >
        <PricePreview options={preview} platformFeeBps={platformFeeBps} />
        {saveFailed ? (
          <Banner tone="error">{GENERIC_ERROR_MESSAGE}</Banner>
        ) : null}
        <Button
          type="submit"
          loading={saving}
          loadingLabel="Saving…"
          className={PRIMARY_WIDTH}
        >
          Save prices
        </Button>
        <ConfirmSheet
          trigger={
            <Button type="button" variant="tertiary" className={TERTIARY}>
              Reset to defaults
            </Button>
          }
          open={resetOpen}
          onOpenChange={(open) => {
            // The sheet stays while "Resetting…" runs: the reset still saves and fills the form when it ends.
            if (resetting) return;
            setResetOpen(open);
            setResetFailed(false);
          }}
          title="Reset prices to defaults?"
          description={`Your base price goes back to ${whole(DEFAULT_BASE_PRICE_CENTS[currency])} and every option to its default, switched on. New requests only.`}
          confirmLabel="Reset prices"
          confirmLoading={resetting}
          confirmLoadingLabel="Resetting…"
          onConfirm={reset}
          cancelLabel="Keep my prices"
        >
          {resetFailed ? (
            <Banner tone="error">{GENERIC_ERROR_MESSAGE}</Banner>
          ) : null}
        </ConfirmSheet>
      </div>
    </form>
  );
}
