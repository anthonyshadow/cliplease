"use client";

import { type RefObject, useRef, useState } from "react";
import { Banner } from "@/components/ui/banner";
import { SelectField } from "@/components/ui/select-field";
import { TextArea } from "@/components/ui/text-field";
import { DISABLE_COPY } from "@/lib/admin/copy";
import { isOneOf } from "@/lib/domain/values";
import { ADMIN_NOTE_MAX } from "@/lib/validation/admin";

/** The reason and note words: Disable's, which the Revoke sheet shares (05 §7 callouts 6, 10). */
const COPY = DISABLE_COPY;

/** A sheet's reason (`""` until one is chosen) and note as the form holds them, and the reason's error. */
export type ReasonField<R extends string> = {
  reasons: readonly R[];
  reason: R | "";
  setReason: (reason: R | "") => void;
  note: string;
  setNote: (note: string) => void;
  error: string | null;
  setError: (error: string | null) => void;
  select: RefObject<HTMLSelectElement | null>;
};

/**
 * The state of a sheet's reason and note (one of `reasons`, required; the note optional): `field` for
 * ReasonNoteFields, the reason and the note; `showReasonError` puts a message under the reason and moves the focus
 * there; `chosen` answers the reason, or null once it has shown "Choose a reason." for none.
 */
export function useReasonField<const R extends string>(reasons: readonly R[]) {
  const [reason, setReason] = useState<R | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const select = useRef<HTMLSelectElement>(null);
  const showReasonError = (message: string) => {
    setError(message);
    select.current?.focus();
  };
  const field: ReasonField<R> = {
    reasons,
    reason,
    setReason,
    note,
    setNote,
    error,
    setError,
    select,
  };
  return {
    field,
    reason,
    note,
    showReasonError,
    chosen(): R | null {
      if (reason !== "") return reason;
      showReasonError(COPY.reasonRequired);
      return null;
    },
  };
}

/**
 * A Disable or Revoke sheet's fields (05 §7 callouts 6, 10): its error Banner when there is one, the reason to choose
 * (a placeholder over `labels`; its error, if any, below it) and the optional note for admins, up to ADMIN_NOTE_MAX
 * characters. `locked`: both read-only and the note without its helper (a Disable whose sweep left requests waiting).
 */
export function ReasonNoteFields<R extends string>({
  field,
  labels,
  error,
  locked = false,
}: {
  field: ReasonField<R>;
  labels: Record<R, string>;
  error: string | null;
  locked?: boolean;
}) {
  return (
    <div className="mt-4 flex flex-col gap-4">
      {error ? <Banner tone="error">{error}</Banner> : null}
      <SelectField
        ref={field.select}
        label={COPY.reason}
        value={field.reason}
        onChange={(event) => {
          const { value } = event.target;
          const chosen = isOneOf(field.reasons, value);
          field.setReason(chosen ? value : "");
          if (chosen) field.setError(null);
        }}
        required
        disabled={locked}
        error={field.error ?? undefined}
      >
        <option value="">{COPY.reasonPlaceholder}</option>
        {field.reasons.map((key) => (
          <option key={key} value={key}>
            {labels[key]}
          </option>
        ))}
      </SelectField>
      <TextArea
        label={COPY.note}
        value={field.note}
        onChange={(event) => field.setNote(event.target.value)}
        maxLength={ADMIN_NOTE_MAX}
        rows={3}
        readOnly={locked}
        helper={locked ? undefined : COPY.noteHelper}
      />
    </div>
  );
}
