"use client";

import { type FormEvent, type MouseEvent, useRef, useState } from "react";
import { TWO_COLUMN } from "@/components/layout/gutter";
import { ExclusiveRow } from "@/components/pricing/exclusive-row";
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
import { RefusalAlert, useRefusal } from "@/components/ui/refusal-alert";
import { Switch } from "@/components/ui/switch";
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
import {
  enabledKeys,
  examplePriceCents,
  exclusiveExamplePriceCents,
  rateChoices,
} from "@/lib/pricing/choices";
import {
  FOLLOWS_RATE_CARD,
  hasExclusiveTerm,
  resolveExclusiveOffer,
} from "@/lib/pricing/exclusive";
import { EXCLUSIVE_COPY } from "@/lib/pricing/exclusive-copy";
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
const EXCLUSIVE = "exclusiveMultiplierBps";
const GROUP_ERROR_ID = (dimension: RateDimension) => `rate-card-${dimension}`;
// The error fields in page order: where a failed Save moves the focus first.
const FIELD_ORDER = [
  BASE,
  ...RATE_DIMENSIONS.flatMap((d) => [d, ...RATE_DIMENSION_KEYS[d]]),
  EXCLUSIVE,
];

/** One option as typed: its text, and the last value that passed the bounds, which the prices use meanwhile. */
type Row = {
  dimension: RateDimension;
  key: RateOptionKey;
  enabled: boolean;
  text: string;
  bps: number;
};

/** The premium as typed, and the last value that passed the bounds, which the prices use meanwhile. */
type Form = {
  baseText: string;
  baseCents: number;
  rows: Row[];
  exclusiveEnabled: boolean;
  exclusiveText: string;
  exclusiveBps: number;
};

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
    exclusiveEnabled: card.exclusiveEnabled,
    exclusiveText: multiplierFieldValue(card.exclusiveMultiplierBps),
    exclusiveBps: card.exclusiveMultiplierBps,
  };
}

/**
 * What Save sends: the typed text read again, NaN where it doesn't read as a number (the schema names it), and the stored
 * premium while the Switch hides the row.
 */
function inputOf(form: Form, savedExclusiveBps: number) {
  return {
    basePriceCents: parseWholeDollars(form.baseText) ?? Number.NaN,
    exclusiveEnabled: form.exclusiveEnabled,
    exclusiveMultiplierBps: form.exclusiveEnabled
      ? (parseMultiplierBps(form.exclusiveText) ?? Number.NaN)
      : savedExclusiveBps,
    options: form.rows.map((r) => ({
      dimension: r.dimension,
      key: r.key,
      enabled: r.enabled,
      multiplierBps: parseMultiplierBps(r.text) ?? Number.NaN,
    })),
  };
}

/** A multiplier's basis points, or null when the text doesn't read as one within the bounds. */
function validBps(text: string) {
  const bps = parseMultiplierBps(text);
  return bps !== null && MultiplierBpsSchema.safeParse(bps).success
    ? bps
    : null;
}

/** The form as text, to tell unsaved edits from the saved card: a premium the Switch hides isn't one. */
const textsOf = (form: Form) =>
  JSON.stringify([
    form.baseText,
    form.rows.map((r) => [r.enabled, r.text]),
    form.exclusiveEnabled,
    form.exclusiveEnabled ? form.exclusiveText : null,
  ]);

/**
 * S21 (05 §6.9, J4): the base price and the 10 options, each with its example price, the Exclusive licenses section
 * (04 §9.29, 07 D109) and the PricePreview, all from computeQuote on every keystroke. Nothing saves before Save prices,
 * except a confirmed Reset to defaults (owner answer Q-92). Errors show on Save (04 §9.6), which moves the focus to the
 * first one.
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
  const [saved, setSaved] = useState<RateCardInput>(card);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // A refused Enter: the focus is already on the field, so the alert says it.
  const [refusal, refuse, clearRefusal] = useRefusal();
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

  useUnsavedChangesGuard(textsOf(form) !== textsOf(formOf(saved)));

  function clearError(field: string) {
    clearRefusal();
    setErrors((prev) => {
      if (!(field in prev)) return prev;
      const { [field]: _, ...rest } = prev;
      return rest;
    });
  }

  function showErrors(fields: Record<string, string>) {
    setErrors(fields);
    const first = FIELD_ORDER.find((field) => field in fields);
    if (!first) return;
    const control = controls.current.get(first);
    // Enter in the field: the focus is already there, so moving it would announce nothing.
    if (control === document.activeElement) refuse(fields[first]);
    else {
      clearRefusal();
      control?.focus();
    }
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
    const bps = validBps(text);
    setRow(key, bps === null ? { text } : { text, bps });
    clearError(key);
  }

  /** Off hides the premium: its error goes, and its text stays until the next save replaces it with the stored one. */
  function setExclusiveEnabled(exclusiveEnabled: boolean) {
    setForm((f) => ({ ...f, exclusiveEnabled }));
    if (!exclusiveEnabled) clearError(EXCLUSIVE);
  }

  function setExclusiveText(exclusiveText: string) {
    const bps = validBps(exclusiveText);
    setForm((f) => ({
      ...f,
      exclusiveText,
      exclusiveBps: bps ?? f.exclusiveBps,
    }));
    clearError(EXCLUSIVE);
  }

  function onSaved(stored: RateCardInput) {
    setSaved(stored);
    setErrors({});
    clearRefusal();
    setSaveFailed(false);
    toast("Prices saved.");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const input = inputOf(form, saved.exclusiveMultiplierBps);
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
      onSaved(parsed.data);
      // Edited since the press: the edits stay.
      setForm((current) =>
        textsOf(current) === submitted ? formOf(parsed.data) : current,
      );
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
    setResetFailed(false);
    const result = await runReset(() => saveRateCard(defaults));
    if (result === null) return;
    if (!result.ok) {
      setResetFailed(true);
      return;
    }
    setResetOpen(false);
    onSaved(defaults);
    // Always: the sheet blocks edits, but a Save in flight can still change the form.
    setForm(formOf(defaults));
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
  const moneyOrNone = (cents: number | null) =>
    cents === null ? null : formatMoney(cents, currency);
  const termKeys = enabledKeys(choices.term);
  const exclusiveOffer = resolveExclusiveOffer(
    {
      exclusiveEnabled: form.exclusiveEnabled,
      exclusiveMultiplierBps: form.exclusiveBps,
    },
    FOLLOWS_RATE_CARD,
    termKeys,
  );

  const whole = (cents: number) =>
    formatMoney(cents, currency, { wholeDollars: true });

  return (
    <form noValidate onSubmit={save} className={TWO_COLUMN.page}>
      <RefusalAlert refusal={refusal} />
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
                    examplePrice={moneyOrNone(
                      examplePriceCents(
                        form.baseCents,
                        choices,
                        row.dimension,
                        row.bps,
                      ),
                    )}
                    groupErrorId={groupError ? errorId : undefined}
                    switchRef={i === 0 ? register(dimension) : undefined}
                    fieldRef={register(row.key)}
                  />
                ))}
            </fieldset>
          );
        })}
        <fieldset className="flex flex-col gap-4">
          <legend className="mb-4 text-title-2 text-ink">
            {EXCLUSIVE_COPY.title}
          </legend>
          <Switch
            label={EXCLUSIVE_COPY.offerSwitch}
            helper={EXCLUSIVE_COPY.offerSwitchHelper}
            checked={form.exclusiveEnabled}
            onCheckedChange={setExclusiveEnabled}
          />
          {form.exclusiveEnabled ? (
            <ExclusiveRow
              label={EXCLUSIVE_COPY.premiumLabel}
              helper={EXCLUSIVE_COPY.premiumHelper}
              note={
                hasExclusiveTerm(termKeys)
                  ? undefined
                  : EXCLUSIVE_COPY.noExclusiveTerm
              }
              value={form.exclusiveText}
              onChange={setExclusiveText}
              error={errors[EXCLUSIVE]}
              examplePrice={moneyOrNone(
                exclusiveExamplePriceCents(
                  form.baseCents,
                  choices,
                  form.exclusiveBps,
                ),
              )}
              fieldRef={register(EXCLUSIVE)}
            />
          ) : null}
        </fieldset>
      </div>

      <div
        className={cn(
          TWO_COLUMN.side,
          "flex flex-col gap-4 lg:sticky lg:top-[calc(var(--nav-h)+24px)]",
        )}
      >
        <PricePreview
          options={preview}
          platformFeeBps={platformFeeBps}
          exclusive={exclusiveOffer}
        />
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
          description={EXCLUSIVE_COPY.resetSheet(
            whole(DEFAULT_BASE_PRICE_CENTS[currency]),
          )}
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
