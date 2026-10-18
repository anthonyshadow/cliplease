"use client";

import { CircleAlert } from "lucide-react";
import { type ComponentProps, type ReactNode, useId } from "react";
import { cn } from "@/lib/utils";

// Shared field chrome for TextField, TextArea, SelectField, Checkbox and Switch (04 §9.6, §9.7).
export const FIELD_BOX =
  "w-full rounded-md border border-hairline-strong bg-surface text-body text-ink placeholder:text-ink-2 hover:border-ink-2 disabled:border-transparent disabled:bg-fill disabled:text-ink-3 disabled:hover:border-transparent";
// Text inputs and textareas only: a <select> always matches :read-only, so SelectField never gets these.
const FIELD_READ_ONLY =
  "read-only:border-transparent read-only:bg-fill read-only:hover:border-transparent";
export const FIELD_ERROR =
  "border-danger ring-1 ring-inset ring-danger hover:border-danger";

function fieldIds(id: string) {
  return {
    helper: `${id}-helper`,
    error: `${id}-error`,
    prefix: `${id}-prefix`,
  };
}

/**
 * A control's id (`id`, or a generated one) and its ARIA wiring (04 §9.6): invalid while there is an error, and
 * described by the prefix (TextField's currency, read first), then the error, then the caller's own `aria-describedby`
 * (text elsewhere on the page that explains the field), then the helper. Each field takes `aria-describedby` out of its
 * props and passes it here, so it adds to these links instead of replacing them.
 */
export function useFieldControl({
  id,
  helper,
  error,
  prefix,
  describedBy: extra,
}: {
  id?: string;
  helper?: ReactNode;
  error?: ReactNode;
  prefix?: string;
  describedBy?: string;
}) {
  const generated = useId();
  const fieldId = id ?? generated;
  const ids = fieldIds(fieldId);
  const describedBy = [
    prefix ? ids.prefix : null,
    error ? ids.error : null,
    extra,
    helper ? ids.helper : null,
  ].filter(Boolean);
  return {
    fieldId,
    ids,
    controlProps: {
      id: fieldId,
      "aria-invalid": error ? true : undefined,
      "aria-describedby":
        describedBy.length > 0 ? describedBy.join(" ") : undefined,
    },
  };
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
          <span className="min-w-0 wrap-anywhere">{error}</span>
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

export type FieldProps = {
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
  "aria-describedby": describedBy,
  id,
  className,
  ...props
}: TextFieldProps) {
  const { fieldId, ids, controlProps } = useFieldControl({
    id,
    helper,
    error,
    prefix,
    describedBy,
  });
  return (
    <FieldShell className={className}>
      <FieldLabel htmlFor={fieldId} optional={optional}>
        {label}
      </FieldLabel>
      <div className="relative">
        {/* The description reads the prefix ("CA$") first, so a screen reader hears the currency; it stays
            aria-hidden so browse mode doesn't read it twice. */}
        {prefix ? (
          <span
            id={ids.prefix}
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-body text-ink-2"
          >
            {prefix}
          </span>
        ) : null}
        <input
          {...controlProps}
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
  "aria-describedby": describedBy,
  id,
  className,
  rows = 4,
  ...props
}: TextAreaProps) {
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
      <textarea
        {...controlProps}
        rows={rows}
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
