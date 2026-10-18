"use client";

import { Check } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { FieldMessages, useFieldControl } from "./text-field";

export type CheckboxProps = Omit<
  ComponentProps<typeof CheckboxPrimitive.Root>,
  "children"
> & {
  /** The label; it may contain links. The whole row (≥ 44 px) is the hit area. */
  label: ReactNode;
  helper?: ReactNode;
  error?: ReactNode;
};

/** 04 §9.7: 22 px box; checked = action fill with a 14 px check. */
export function Checkbox({
  label,
  helper,
  error,
  "aria-describedby": describedBy,
  id,
  className,
  ...props
}: CheckboxProps) {
  const { fieldId, controlProps } = useFieldControl({
    id,
    helper,
    error,
    describedBy,
  });
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {/* The whole row is the label, so the ≥ 44 px row is the hit area. A click on the box itself doesn't toggle
          twice, and links inside the label still navigate. */}
      <label
        htmlFor={fieldId}
        className="flex min-h-11 items-start gap-3 py-2.5"
      >
        <CheckboxPrimitive.Root
          {...controlProps}
          className={cn(
            "mt-px flex size-5.5 shrink-0 items-center justify-center rounded-xs border-[1.5px] border-hairline-strong bg-surface text-action-ink transition-colors duration-200 ease-standard data-[state=checked]:border-action data-[state=checked]:bg-action disabled:cursor-not-allowed disabled:border-hairline disabled:bg-fill",
            error && "border-danger",
          )}
          {...props}
        >
          <CheckboxPrimitive.Indicator>
            <Check aria-hidden size={14} strokeWidth={2.5} />
          </CheckboxPrimitive.Indicator>
        </CheckboxPrimitive.Root>
        <span className="text-body text-ink">{label}</span>
      </label>
      <FieldMessages id={fieldId} helper={helper} error={error} />
    </div>
  );
}
