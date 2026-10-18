"use client";

import {
  type FormEvent,
  type ReactNode,
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast";
import { DISPLAY_NAME_MAX } from "@/lib/validation/profile";
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
  const [state, formAction, pending] = useActionState(saveDisplayName, null);
  const [value, setValue] = useState(initial);
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

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <form
      noValidate
      action={formAction}
      onSubmit={submit}
      className="flex flex-col gap-4"
    >
      <TextField
        ref={fieldRef}
        label="Display name"
        name="displayName"
        autoComplete="name"
        maxLength={DISPLAY_NAME_MAX}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setError(undefined);
        }}
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
