"use client";

import { type Ref, useId } from "react";
import { TextField } from "@/components/ui/text-field";
import { EXAMPLE_PRICE_CELL } from "./rate-row";

type ExclusiveRowProps = {
  label: string;
  helper: string;
  /** A full-width line under the helper: the no-term line. */
  note?: string;
  /** The field's text ("3.00"; the × is its adornment). */
  value: string;
  onChange: (text: string) => void;
  error?: string;
  /** Formatted by the caller, or null for none. */
  examplePrice: string | null;
  fieldRef?: Ref<HTMLInputElement>;
};

/**
 * 04 §9.29, 05 §6.9 callout 10: RateRow's layout without its switch (the row shows only while the section's Switch is
 * on), in a fieldset the label names, then the helper and the note read with the field. The field is named once, by its
 * own hidden label (next to owner answer Q-93); the example price follows the RateRow rule.
 */
export function ExclusiveRow({
  label,
  helper,
  note,
  value,
  onChange,
  error,
  examplePrice,
  fieldRef,
}: ExclusiveRowProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const helperId = `${id}-helper`;
  const noteId = `${id}-note`;
  return (
    <fieldset
      aria-labelledby={labelId}
      className="grid min-w-0 grid-cols-[minmax(0,8rem)_minmax(0,1fr)] items-start gap-x-4 gap-y-1 md:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]"
    >
      <span id={labelId} className="col-span-2 text-body text-ink">
        {label}
      </span>
      <TextField
        ref={fieldRef}
        label={label}
        hideLabel
        prefix="×"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        error={error}
        aria-describedby={note ? `${helperId} ${noteId}` : helperId}
      />
      <p data-example-price className={EXAMPLE_PRICE_CELL}>
        {examplePrice}
      </p>
      <p id={helperId} className="col-span-2 text-footnote text-ink-2">
        {helper}
      </p>
      {note ? (
        <p id={noteId} className="col-span-2 text-footnote text-ink-2">
          {note}
        </p>
      ) : null}
    </fieldset>
  );
}
