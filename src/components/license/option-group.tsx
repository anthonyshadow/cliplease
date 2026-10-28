import { type ComponentProps, type ReactNode, useId } from "react";
import { FadeText } from "@/components/ui/fade-text";
import { FieldMessages, fieldIds } from "@/components/ui/text-field";
import { cn } from "@/lib/utils";

/**
 * 04 §9.3 OptionGroup: a `<fieldset>` whose `<legend>` is `title-2`, an optional `help` line under it (05 §6.5 draws
 * the music question's on its own line; `callout` ink-2, the group's description), then its OptionTiles. The tiles hold
 * native radios, so arrow keys, form posting and no-JS work for free; no Radix RadioGroup. The Rights step's two
 * questions are its first use (owner answer Q-97 a); the license page reuses it (P15). `error`: a line under the tiles,
 * as a field's (the license page's "That option isn't available anymore.", P16a).
 */
export function OptionGroup({
  legend,
  help,
  error,
  className,
  children,
  "aria-describedby": describedBy,
  ...props
}: Omit<ComponentProps<"fieldset">, "children"> & {
  legend: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}) {
  const helpId = useId();
  const groupId = useId();
  return (
    <fieldset
      {...props}
      aria-describedby={
        [
          help ? helpId : null,
          error ? fieldIds(groupId).error : null,
          describedBy,
        ]
          .filter(Boolean)
          .join(" ") || undefined
      }
      className={cn("flex min-w-0 flex-col", className)}
    >
      <legend className={cn("text-title-2 text-ink", help ? "mb-1" : "mb-3")}>
        {legend}
      </legend>
      {help ? (
        <p id={helpId} className="mb-3 text-callout text-ink-2">
          {help}
        </p>
      ) : null}
      {children}
      {error ? (
        <div className="mt-2">
          <FieldMessages id={groupId} error={error} />
        </div>
      ) : null}
    </fieldset>
  );
}

/**
 * 04 §9.3 OptionTile: a box holding a `<label>` around a visually hidden native radio and the title, `body` semibold,
 * then the license page's delta and description (P15). The label is stretched over the box, so a tap anywhere selects,
 * and `picker` (the territory's select and "Which countries?") sits after it, above the stretch: a label can't hold
 * other controls. The box's styles read its own radio only (`>label>input`), never the picker's options, and its focus
 * ring shows only for the radio (globals.css `[data-option-tile]`). Selected: the ink border and a 1 px inset ring, no
 * layout shift; forced colors drop the ring (a box-shadow), so there it is a 4 px `Highlight` border (04 §7). Disabled:
 * `fill`, no border, the title `ink-3`, and `reason` in place of the description, read with the title (01 J7.4).
 */
export function OptionTile({
  title,
  description,
  delta,
  deltaPlacement = "beside",
  reason,
  picker,
  className,
  ...input
}: Omit<ComponentProps<"input">, "type" | "title"> & {
  title: ReactNode;
  /** The option's one-liner (01 §4.1–§4.3), `callout` `ink-2`. */
  description?: ReactNode;
  /** formatDelta's license-price difference (04 §9.3), cross-faded on change; kept but hidden on the selected tile. */
  delta?: string | null;
  /** `beside` the title (Use, Territory) or `below` it (Term's half-width tiles, 05 frame). */
  deltaPlacement?: "beside" | "below";
  /** Why the option is off: replaces the description. */
  reason?: ReactNode;
  picker?: ReactNode;
}) {
  const deltaText =
    delta == null ? null : (
      <FadeText
        text={delta}
        aria-hidden={input.checked || undefined}
        className={cn(
          "text-callout text-ink-2 tabular-nums",
          deltaPlacement === "beside" && "shrink-0",
          input.checked && "invisible",
        )}
      />
    );
  const detail = reason ?? description;
  return (
    <div
      data-option-tile
      className={cn(
        "relative flex flex-col rounded-md border border-hairline-strong bg-surface hover:border-ink-2 has-[>label>input:checked]:border-ink has-[>label>input:checked]:ring-1 has-[>label>input:checked]:ring-ink has-[>label>input:checked]:ring-inset forced-colors:has-[>label>input:checked]:border-4 forced-colors:has-[>label>input:checked]:border-[Highlight] has-[>label>input:disabled]:border-transparent has-[>label>input:disabled]:bg-fill",
        className,
      )}
    >
      <label className="group/tile flex min-h-16 cursor-pointer items-center px-4 py-3.5 after:absolute after:inset-0 has-disabled:cursor-not-allowed">
        <input type="radio" className="sr-only" {...input} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 text-body font-semibold text-ink group-has-disabled/tile:text-ink-3">
              {title}
            </span>
            {deltaPlacement === "beside" ? deltaText : null}
          </span>
          {deltaPlacement === "below" ? deltaText : null}
          {detail ? (
            <span className="text-callout text-ink-2">{detail}</span>
          ) : null}
        </span>
      </label>
      {picker ? (
        <div className="relative z-10 flex min-w-0 flex-col gap-3 px-4 pb-4">
          {picker}
        </div>
      ) : null}
    </div>
  );
}
