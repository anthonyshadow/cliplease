"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { PRIMARY_WIDTH } from "@/components/ui/primary-width";
import { TextField } from "@/components/ui/text-field";
import { useFormAction } from "@/components/ui/use-form-action";
import { TITLE_MAX } from "@/lib/videos/title";
import { createVideoFromUpload } from "./actions";

/** S18's form (05 §6.6 callouts 2–3): Title, then Continue; a refusal shows on the field and takes the focus. */
export function TitleForm() {
  const { state, pending, resultKey, formProps } = useFormAction(
    createVideoFromUpload,
    null,
  );
  const [error, setError] = useState<string>();
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state === null) return;
    setError(state.error.fields?.title?.[0] ?? state.error.message);
    titleRef.current?.focus();
  }, [state]);

  return (
    <form {...formProps} className="flex flex-col gap-6">
      <TextField
        ref={titleRef}
        label="Title"
        name="title"
        autoComplete="off"
        maxLength={TITLE_MAX}
        error={error}
        onChange={() => setError(undefined)}
      />
      {state !== null ? (
        <p key={resultKey} role="alert" className="sr-only">
          {state.error.message}
        </p>
      ) : null}
      <Button
        type="submit"
        loading={pending}
        loadingLabel="Continuing…"
        className={PRIMARY_WIDTH}
      >
        Continue
      </Button>
    </form>
  );
}
