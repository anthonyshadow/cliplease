"use client";

import { ChevronDown } from "lucide-react";
import { type ComponentProps, type ReactNode, useId } from "react";
import { cn } from "@/lib/utils";
import {
  describedBy,
  FIELD_BOX,
  FIELD_ERROR,
  FieldLabel,
  FieldMessages,
  FieldShell,
} from "./text-field";

export type SelectFieldProps = ComponentProps<"select"> & {
  label: ReactNode;
  optional?: boolean;
  helper?: ReactNode;
  error?: ReactNode;
};

/** 04 §9.6: a native <select> (the best picker on phones) in the field box, with a 16 px ChevronDown. */
export function SelectField({
  label,
  optional,
  helper,
  error,
  id,
  className,
  children,
  ...props
}: SelectFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <FieldShell className={className}>
      <FieldLabel htmlFor={fieldId} optional={optional}>
        {label}
      </FieldLabel>
      <div className="relative">
        <select
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(fieldId, helper, error)}
          className={cn(
            FIELD_BOX,
            "h-12 appearance-none pr-10 pl-3.5 lg:h-11",
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
