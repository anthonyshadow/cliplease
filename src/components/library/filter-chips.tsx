import { Check } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useId } from "react";
import { FieldMessages, fieldIds } from "@/components/ui/text-field";
import { cn } from "@/lib/utils";

const CHIP =
  "hit-44 inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 text-callout font-semibold tabular-nums transition-colors duration-200 ease-standard";
const OFF = "border-hairline-strong bg-surface text-ink hover:border-ink";
const ON = "border-transparent bg-action text-action-ink";

/**
 * Multiple mode's chip: 44 px visible (`h-11`, the step's main input) and at least as wide (`min-w-11`: "X" alone is
 * about 40 px), the 16 px Check sitting in the label's gap. An aria-disabled chip keeps its on look when it is on (the
 * locked source chip, 07 D69) and takes Button's disabled tokens when it is off (04 §9.2; 04 §9.14 draws no disabled chip).
 */
const TOGGLE =
  "inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-callout font-semibold transition-colors duration-200 ease-standard aria-disabled:cursor-not-allowed";
const OFF_DISABLED = "border-hairline bg-surface text-ink-3";

type LinkChip = {
  key: string;
  label: string;
  href: string;
  current: boolean;
};

/** One toggle in multiple mode, controlled by the caller. */
export type ToggleChip<V extends string = string> = {
  value: V;
  label: ReactNode;
  pressed: boolean;
  /** `aria-disabled`: still focusable and announced, but a press does nothing (the locked source chip; the not-posted tick). */
  disabled?: boolean;
};

export type FilterChipsProps<V extends string = string> =
  | {
      mode?: "single";
      chips: readonly LinkChip[];
      className?: string;
    }
  | {
      mode: "multiple";
      /** The id of the visible legend that names the group (the picker's "Where was it posted?" header). */
      labelledBy: string;
      chips: readonly ToggleChip<V>[];
      onToggle: (value: V) => void;
      /**
       * Mirrors each enabled chip into a hidden `<input type="checkbox" name={mirrorName}>` (04 §9.14), so the form posts
       * the chips without JS. A disabled chip never mirrors: the locked source chip must not post a second, link-less row.
       */
      mirrorName?: string;
      /** The group's field error (05 §6.5 "Say where it was posted"), shown under the chips; each chip is described by it. */
      error?: ReactNode;
      className?: string;
    };

/**
 * FilterChips (04 §9.14).
 *
 * Single mode (the default): links that set ?platform= (server-rendered and shareable), "All {n}" then one chip per
 * linked platform with its count; the current one is filled with aria-current="page". The row scrolls inside itself
 * where it overflows (07 D146); the 4 px block padding keeps each 44 px target inside the scroller.
 *
 * Multiple mode (`mode="multiple"`, 07 D69; PostingPicker, 04 §9.33): a `role="group"` named by `labelledBy`, each chip
 * a `<button type="button" aria-pressed>` toggle, so any number can be on; Space and Enter toggle (native button), Tab
 * moves chip to chip, no arrow-key roving. On shows a leading 16 px Check, so the state never depends on fill alone. No
 * "All" chip and no counts. The row wraps (`flex-wrap gap-2`) at every tier and never scrolls (07 D146, D153). An
 * `error` shows under the row in FieldMessages' look and describes every chip; the wrapper carries `data-chip-error`
 * meanwhile (the step's focus goes to its first chip). Controlled and stateless: the caller owns `pressed` and answers
 * `onToggle`. It takes handlers, so only a client component renders it; this module stays free of "use client" so
 * single mode stays a server component.
 */
export function FilterChips<V extends string = string>(
  props: FilterChipsProps<V>,
) {
  if (props.mode === "multiple") return <ToggleChips {...props} />;
  const { chips, className } = props;
  return (
    <ul
      className={cn(
        "scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 py-1",
        className,
      )}
    >
      {chips.map((chip) => (
        <li key={chip.key} className="flex">
          <Link
            href={chip.href}
            aria-current={chip.current ? "page" : undefined}
            className={cn(CHIP, chip.current ? ON : OFF)}
          >
            {chip.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ToggleChips<V extends string>({
  labelledBy,
  chips,
  onToggle,
  mirrorName,
  error,
  className,
}: Extract<FilterChipsProps<V>, { mode: "multiple" }>) {
  const errorId = useId();
  return (
    <div
      data-chip-error={error ? "" : undefined}
      className="flex flex-col gap-2"
    >
      {/* biome-ignore lint/a11y/useSemanticElements: 04 §9.14 names a role="group" div; a <fieldset>'s min-content sizing and legend box would fight the wrapping row. */}
      <div
        role="group"
        aria-labelledby={labelledBy}
        className={cn("flex flex-wrap gap-2", className)}
      >
        {chips.map((chip) => (
          <ToggleChipButton
            key={chip.value}
            chip={chip}
            onToggle={onToggle}
            mirrorName={mirrorName}
            describedBy={error ? fieldIds(errorId).error : undefined}
          />
        ))}
      </div>
      <FieldMessages id={errorId} error={error} />
    </div>
  );
}

function ToggleChipButton<V extends string>({
  chip,
  onToggle,
  mirrorName,
  describedBy,
}: {
  chip: ToggleChip<V>;
  onToggle: (value: V) => void;
  mirrorName: string | undefined;
  describedBy: string | undefined;
}) {
  const look = chip.pressed ? ON : chip.disabled ? OFF_DISABLED : OFF;
  return (
    <>
      <button
        type="button"
        aria-pressed={chip.pressed}
        aria-disabled={chip.disabled || undefined}
        aria-describedby={describedBy}
        onClick={chip.disabled ? undefined : () => onToggle(chip.value)}
        className={cn(TOGGLE, look)}
      >
        {chip.pressed ? (
          <Check aria-hidden size={16} className="shrink-0" />
        ) : null}
        {chip.label}
      </button>
      {mirrorName !== undefined && !chip.disabled ? (
        <input
          type="checkbox"
          name={mirrorName}
          value={chip.value}
          checked={chip.pressed}
          readOnly
          hidden
        />
      ) : null}
    </>
  );
}
