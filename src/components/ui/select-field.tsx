"use client";

import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import {
  FIELD_BOX,
  FIELD_ERROR,
  FIELD_HEIGHT,
  FieldLabel,
  FieldMessages,
  type FieldProps,
  FieldShell,
  useFieldControl,
} from "./text-field";

export type SelectFieldProps = ComponentProps<"select"> & FieldProps;

/** 04 §9.6: a native <select> (the best picker on phones) in the field box, with a 16 px ChevronDown. */
export function SelectField({
  label,
  optional,
  helper,
  error,
  "aria-describedby": describedBy,
  id,
  className,
  children,
  ...props
}: SelectFieldProps) {
  const { fieldId, controlProps } = useFieldControl({
    id,
    helper,
    error,
    describedBy,
  });
  return (
    <FieldShell className={className}>
      <FieldLabel htmlFor={fieldId} optional={optional}>
        {label}
      </FieldLabel>
      <div className="relative">
        <select
          {...controlProps}
          className={cn(
            FIELD_BOX,
            FIELD_HEIGHT,
            "appearance-none pr-10 pl-3.5",
            error && FIELD_ERROR,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden
          size={16}
          strokeWidth={2}
          className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-ink-2"
        />
      </div>
      <FieldMessages id={fieldId} helper={helper} error={error} />
    </FieldShell>
  );
}
