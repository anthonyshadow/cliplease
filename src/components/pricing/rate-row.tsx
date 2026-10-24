"use client";

import { type Ref, useId } from "react";
import { SwitchControl } from "@/components/ui/switch";
import { FIELD_HEIGHT, TextField } from "@/components/ui/text-field";
import { cn } from "@/lib/utils";

// The switch and the example price sit in boxes as tall as the field, so all three line up while a field error grows
// the row below them.
const ROW_CELL = cn("flex items-center", FIELD_HEIGHT);

type RateRowProps = {
  label: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  /** The field's text, e.g. "1.50" (the × is its adornment). */
  multiplier: string;
  onMultiplierChange: (text: string) => void;
  error?: string;
  /** The formatted example price, or null when another group has no option on. */
  examplePrice: string | null;
  /** The group's "Keep at least one …" error, read with the switch. */
  groupErrorId?: string;
  switchRef?: Ref<HTMLButtonElement>;
  fieldRef?: Ref<HTMLInputElement>;
};

/**
 * 04 §9.29, 05 §6.9 callout 3: the option's label, then its switch, its multiplier and its example price, in a fieldset
 * the label names. The label also names the switch; the field's own name, "{label} multiplier", is for screen readers
 * (owner answer Q-93).
 */
export function RateRow({
  label,
  enabled,
  onEnabledChange,
  multiplier,
  onMultiplierChange,
  error,
  examplePrice,
  groupErrorId,
  switchRef,
  fieldRef,
}: RateRowProps) {
  const switchId = useId();
  const labelId = `${switchId}-label`;
  return (
    <fieldset
      aria-labelledby={labelId}
      className="grid min-w-0 grid-cols-[auto_minmax(0,8rem)_minmax(0,1fr)] items-start gap-x-4 gap-y-1 md:grid-cols-[auto_minmax(0,10rem)_minmax(0,1fr)]"
    >
      <label
        id={labelId}
        htmlFor={switchId}
        className="col-span-3 text-body text-ink"
      >
        {label}
      </label>
      <div className={ROW_CELL}>
        <SwitchControl
          ref={switchRef}
          id={switchId}
          checked={enabled}
          onCheckedChange={onEnabledChange}
          aria-describedby={groupErrorId}
        />
      </div>
      <TextField
        ref={fieldRef}
        label={`${label} multiplier`}
        hideLabel
        prefix="×"
        inputMode="decimal"
        autoComplete="off"
        value={multiplier}
        onChange={(event) => onMultiplierChange(event.target.value)}
        error={error}
      />
      <p
        className={cn(
          ROW_CELL,
          "justify-end text-right text-footnote text-ink-2 tabular-nums wrap-anywhere",
        )}
      >
        {examplePrice}
      </p>
    </fieldset>
  );
}
