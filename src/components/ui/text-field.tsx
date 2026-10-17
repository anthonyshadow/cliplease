"use client";

import { CircleAlert } from "lucide-react";
import { type ComponentProps, type ReactNode, useId } from "react";
import { cn } from "@/lib/utils";

// Shared field chrome for TextField, TextArea, SelectField and Checkbox (04 §9.6, §9.7).
export const FIELD_BOX =
  "w-full rounded-md border border-hairline-strong bg-surface text-body text-ink placeholder:text-ink-2 hover:border-ink-2 disabled:border-transparent disabled:bg-fill disabled:text-ink-3 disabled:hover:border-transparent";
// Text inputs and textareas only: a <select> always matches :read-only, so SelectField never gets these.
const FIELD_READ_ONLY =
  "read-only:border-transparent read-only:bg-fill read-only:hover:border-transparent";
export const FIELD_ERROR =
  "border-danger ring-1 ring-inset ring-danger hover:border-danger";

function fieldIds(id: string) {
  return { helper: `${id}-helper`, error: `${id}-error` };
}

export function describedBy(
  id: string,
  helper: ReactNode,
  error: ReactNode,
): string | undefined {
  const ids = fieldIds(id);
  const parts = [error ? ids.error : null, helper ? ids.helper : null].filter(
    Boolean,
  );
  return parts.length > 0 ? parts.join(" ") : undefined;
}

export function FieldLabel({
  htmlFor,
  optional,
  children,
}: {
  htmlFor: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="text-callout font-semibold text-ink">
      {children}
      {optional ? (
        <span className="font-normal text-ink-2"> (optional)</span>
      ) : null}
    </label>
  );
}

export function FieldMessages({
  id,
  helper,
  error,
}: {
  id: string;
  helper?: ReactNode;
  error?: ReactNode;
}) {
  const ids = fieldIds(id);
  return (
    <>
      {error ? (
        <p
          id={ids.error}
          className="flex items-start gap-1.5 text-footnote text-danger-text"
        >
          <CircleAlert
            aria-hidden
            size={16}
            strokeWidth={2}
            className="mt-px shrink-0"
          />
          <span>{error}</span>
        </p>
      ) : null}
      {helper ? (
        <p id={ids.helper} className="text-footnote text-ink-2">
          {helper}
        </p>
      ) : null}
    </>
  );
}

export function FieldShell({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("flex flex-col gap-2", className)}>{children}</div>;
}

type FieldProps = {
  label: ReactNode;
  optional?: boolean;
  helper?: ReactNode;
  /** Shown on blur or submit, never while typing (04 §9.6). */
  error?: ReactNode;
};

// React's HTMLAttributes already has an RDFa `prefix`, so it is replaced here by the adornment.
export type TextFieldProps = Omit<ComponentProps<"input">, "prefix"> &
  FieldProps & {
    /** Leading adornment, e.g. `CURRENCY_DISPLAY[currency].prefix` ("CA$"); never a bare "$" (07 D98). */
    prefix?: string;
  };

/** 04 §9.6: label above, helper and error linked by aria-describedby. */
export function TextField({
  label,
  optional,
  helper,
  error,
  prefix,
  id,
  className,
  ...props
}: TextFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const prefixId = `${fieldId}-prefix`;
  // The prefix is read first in the description ("CA$"), so a screen reader hears the currency; it stays
  // aria-hidden so browse mode doesn't read it twice.
  const description = [
    prefix ? prefixId : null,
    describedBy(fieldId, helper, error),
  ].filter(Boolean);
  return (
    <FieldShell className={className}>
      <FieldLabel htmlFor={fieldId} optional={optional}>
        {label}
      </FieldLabel>
      <div className="relative">
        {prefix ? (
          <span
            id={prefixId}
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-body text-ink-2"
          >
            {prefix}
          </span>
        ) : null}
        <input
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            description.length > 0 ? description.join(" ") : undefined
          }
          className={cn(
            FIELD_BOX,
            FIELD_READ_ONLY,
            "h-12 px-3.5 lg:h-11",
            prefix && "pl-12",
            error && FIELD_ERROR,
          )}
          {...props}
        />
      </div>
      <FieldMessages id={fieldId} helper={helper} error={error} />
    </FieldShell>
  );
}

export type TextAreaProps = ComponentProps<"textarea"> & FieldProps;

export function TextArea({
  label,
  optional,
  helper,
  error,
  id,
  className,
  rows = 4,
  ...props
}: TextAreaProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <FieldShell className={className}>
      <FieldLabel htmlFor={fieldId} optional={optional}>
        {label}
      </FieldLabel>
      <textarea
        id={fieldId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, helper, error)}
        className={cn(
          FIELD_BOX,
          FIELD_READ_ONLY,
          "px-3.5 py-3",
          error && FIELD_ERROR,
        )}
        {...props}
      />
      <FieldMessages id={fieldId} helper={helper} error={error} />
    </FieldShell>
  );
}
