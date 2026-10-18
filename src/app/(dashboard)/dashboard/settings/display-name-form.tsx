"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast";
import { useFormAction } from "@/components/ui/use-form-action";
import { DISPLAY_NAME_MAX } from "@/lib/validation/display-name";
import { saveDisplayName } from "./actions";

/**
 * Profile → Display name + Save (secondary: payouts holds the page's primary, 05 §6.11 callout 5). `children` (the
 * read-only handle) sits between the field and Save, as the 05 frame draws it.
 */
export function DisplayNameForm({
  initial,
  children,
}: {
  initial: string;
  children?: ReactNode;
}) {
  const { state, pending, formProps } = useFormAction(saveDisplayName, null);
  const [error, setError] = useState<string | undefined>();
  const fieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state === null) return;
    if (state.ok) {
      setError(undefined);
      toast("Saved.");
      return;
    }
    setError(state.error.fields?.displayName?.[0] ?? state.error.message);
    fieldRef.current?.focus();
  }, [state]);

  return (
    <form {...formProps} className="flex flex-col gap-4">
      <TextField
        ref={fieldRef}
        label="Display name"
        name="displayName"
        autoComplete="name"
        maxLength={DISPLAY_NAME_MAX}
        defaultValue={initial}
        onChange={() => setError(undefined)}
        error={error}
      />
      {children}
      {state !== null && !state.ok ? (
        <p role="alert" className="sr-only">
          {state.error.message}
        </p>
      ) : null}
      <Button
        type="submit"
        variant="secondary"
        loading={pending}
        loadingLabel="Saving…"
        className="self-start"
      >
        Save
      </Button>
    </form>
  );
}
