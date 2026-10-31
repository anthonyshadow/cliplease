"use client";

import { Switch as SwitchPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { FieldMessages, useFieldControl } from "./text-field";

export type SwitchProps = Omit<
  ComponentProps<typeof SwitchPrimitive.Root>,
  "children"
> & {
  /** Shown to the left of the switch; Radix announces the on/off state. */
  label: ReactNode;
  /** Under the row, linked by aria-describedby (04 §9.6's field messages). */
  helper?: ReactNode;
  error?: ReactNode;
};

/**
 * 04 §9.7's toggle alone: 51 × 31 track; off = fill with a hairline border, on = action. For a layout that places its
 * own `<label htmlFor>` (RateRow); everywhere else use Switch.
 */
export function SwitchControl(
  props: Omit<ComponentProps<typeof SwitchPrimitive.Root>, "children">,
) {
  return (
    <SwitchPrimitive.Root
      className="hit-44 inline-flex h-[31px] w-[51px] shrink-0 items-center rounded-full border border-hairline-strong bg-fill p-0.5 transition-colors duration-200 ease-out data-[state=checked]:border-transparent data-[state=checked]:bg-action disabled:cursor-not-allowed disabled:border-hairline aria-disabled:cursor-not-allowed aria-disabled:border-hairline"
      {...props}
    >
      {/* The thumb keeps a transparent border so it stays visible in forced-colors mode (04 §7). */}
      <SwitchPrimitive.Thumb className="block size-[25px] rounded-full border border-transparent bg-surface transition-transform duration-200 ease-out data-[state=checked]:translate-x-5 data-[state=checked]:bg-action-ink" />
    </SwitchPrimitive.Root>
  );
}

/**
 * 04 §9.7: the label on the left, the toggle on the right, then the helper and error under the row. A caller's
 * `aria-describedby` is added to theirs, as a field's.
 */
export function Switch({
  label,
  helper,
  error,
  "aria-describedby": describedBy,
  id,
  className,
  ...props
}: SwitchProps) {
  const { fieldId, controlProps } = useFieldControl({
    id,
    helper,
    error,
    describedBy,
  });
  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn(
          "flex min-h-11 items-center justify-between gap-4",
          className,
        )}
      >
        <label htmlFor={fieldId} className="text-body text-ink">
          {label}
        </label>
        <SwitchControl {...controlProps} {...props} />
      </div>
      <FieldMessages id={fieldId} helper={helper} error={error} />
    </div>
  );
}
