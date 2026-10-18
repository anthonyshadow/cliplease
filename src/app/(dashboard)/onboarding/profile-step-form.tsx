"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { NativeCheckbox } from "@/components/ui/checkbox";
import { PRIMARY_WIDTH } from "@/components/ui/primary-width";
import { TextField } from "@/components/ui/text-field";
import { useFormAction } from "@/components/ui/use-form-action";
import { DISPLAY_NAME_MAX } from "@/lib/validation/display-name";
import {
  HANDLE_COPY,
  handleProblem,
  handleProblemMessage,
  normalizeHandleInput,
} from "@/lib/validation/handle";
import { checkHandle, completeOnboarding } from "./actions";

type Availability = Awaited<ReturnType<typeof checkHandle>>;
// The latest answer for a handle; `failed` when the check couldn't run (its line then stays empty, not "Checking…").
type Check = Availability | { handle: string; state: "failed" };
type Field = "displayName" | "handle" | "ageConfirmed";
const FIELD_ORDER: readonly Field[] = ["displayName", "handle", "ageConfirmed"];
const CHECK_DELAY_MS = 300; // 01 J1.4

/** The availability line (04 §11.10) for a handle with no format problem, from the latest server answer. */
function availabilityText(handle: string, result: Availability): string {
  switch (result.state) {
    case "available":
      return `@${handle} is yours`;
    case "taken":
      return `@${handle} is taken`;
    case "reserved":
      return HANDLE_COPY.reserved;
    case "invalid":
      return HANDLE_COPY.characters;
  }
}

/**
 * Step 1 (05 §5.2): name, handle, the 18+ box and a hidden time zone. Continue is never disabled; the server checks
 * everything and answers with field errors, and nothing is saved without the tick (07 D93). Typed values survive an
 * error (useFormAction); only the handle is controlled, because it is normalized as typed.
 */
export function ProfileStepForm({ linkHost }: { linkHost: string }) {
  const [handleTouched, setHandleTouched] = useState(false);
  const { state, pending, formProps } = useFormAction(
    completeOnboarding,
    null,
    () => setHandleTouched(true),
  );
  const [handle, setHandle] = useState("");
  const [timeZone, setTimeZone] = useState("");
  // The handle as it was when typing last paused: format messages wait for it, like the availability check.
  const [settled, setSettled] = useState("");
  const [checked, setChecked] = useState<Check | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [alertId, setAlertId] = useState(0);
  const nameRef = useRef<HTMLInputElement>(null);
  const handleRef = useRef<HTMLInputElement>(null);
  const ageRef = useRef<HTMLInputElement>(null);
  const lineId = useId();

  // The device's zone, read after mount so the server and client renders match (07 D84); empty without JS → UTC.
  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  // Once typing pauses: settle the handle, and ask the server when its format allows. A newer handle ends this effect,
  // so an older answer never replaces a newer one.
  useEffect(() => {
    let current = true;
    setChecked(null);
    const timer = setTimeout(() => {
      setSettled(handle);
      if (handle === "" || handleProblem(handle) !== null) return;
      checkHandle({ handle })
        .then((result) => {
          if (current) setChecked(result);
        })
        .catch(() => {
          if (current) setChecked({ handle, state: "failed" });
        });
    }, CHECK_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [handle]);

  // A refusal: show its field errors and move focus to the first one (05 §5.2).
  useEffect(() => {
    if (state === null) return;
    const next: Partial<Record<Field, string>> = {};
    for (const field of FIELD_ORDER) {
      const message = state.error.fields?.[field]?.[0];
      if (message) next[field] = message;
    }
    setErrors(next);
    setAlertId((id) => id + 1);
    const first = FIELD_ORDER.find((field) => next[field]);
    const ref = {
      displayName: nameRef,
      handle: handleRef,
      ageConfirmed: ageRef,
    };
    if (first) ref[first].current?.focus();
  }, [state]);

  function clearError(field: Field) {
    setErrors(({ [field]: _, ...rest }) => rest);
  }

  function changeHandle(value: string) {
    const next = normalizeHandleInput(value);
    // A keystroke that normalizes away (a space, "@") changes nothing, so a refusal such as "was just taken" stays.
    if (next === handle) return;
    setHandle(next);
    clearError("handle");
  }

  const problem = handleProblem(handle);
  const paused = settled === handle;
  // A handle that more typing can still make valid ("ma", or "maya." on the way to "maya.films") also waits for a
  // blur or Continue before its message shows (04 §9.6); a bad character shows once typing pauses (01 J1.4).
  const unfinished =
    problem === "length" ||
    (problem === "characters" && handleProblem(`${handle}a`) === null);
  let line: string | null = null;
  if (errors.handle === undefined && handle !== "") {
    if (problem === "length" || problem === "characters") {
      line =
        paused && (handleTouched || !unfinished)
          ? handleProblemMessage(handle)
          : null;
    } else if (!paused) {
      line = "Checking…";
    } else if (problem === "reserved") {
      line = HANDLE_COPY.reserved;
    } else if (checked?.handle === handle) {
      line =
        checked.state === "failed" ? null : availabilityText(handle, checked);
    } else {
      line = "Checking…";
    }
  }
  // A refusal's fresh suggestions while its handle error shows, else the latest check's.
  const chips =
    errors.handle !== undefined
      ? (state?.suggestions ?? [])
      : checked?.handle === handle && checked.state === "taken"
        ? checked.suggestions
        : [];

  return (
    <form {...formProps} className="flex flex-col gap-6">
      <TextField
        ref={nameRef}
        label="Your name"
        name="displayName"
        autoComplete="name"
        maxLength={DISPLAY_NAME_MAX}
        helper="Shown on your page and on licenses."
        onChange={() => clearError("displayName")}
        error={errors.displayName}
      />
      <div className="flex flex-col gap-2">
        <TextField
          ref={handleRef}
          label="Handle"
          name="handle"
          type="text"
          prefix="@"
          // Not a sign-in name: autofill would only offer unrelated values (04 §9.6).
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={handle}
          onChange={(event) => changeHandle(event.target.value)}
          onBlur={() => setHandleTouched(true)}
          error={errors.handle}
          aria-describedby={lineId}
        />
        <p id={lineId} aria-live="polite" className="text-footnote text-ink-2">
          {line}
        </p>
        {chips.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {chips.map((suggestion) => (
              <Button
                key={suggestion}
                type="button"
                size="sm"
                variant="secondary"
                // A 30-character suggestion can be wider than a phone column: the label wraps inside the chip (07 D153).
                className="h-auto min-h-9 max-w-full whitespace-normal wrap-anywhere"
                onClick={() => {
                  changeHandle(suggestion);
                  handleRef.current?.focus();
                }}
              >
                {`@${suggestion}`}
              </Button>
            ))}
          </div>
        ) : null}
        {handle !== "" ? (
          <p className="text-footnote text-ink-2">
            Your links will look like {`${linkHost}/@${handle}/your-video`}
          </p>
        ) : null}
      </div>
      <NativeCheckbox
        ref={ageRef}
        label="I'm 18 or older"
        name="ageConfirmed"
        required
        onChange={() => clearError("ageConfirmed")}
        error={errors.ageConfirmed}
      />
      <input type="hidden" name="timeZone" value={timeZone} />
      {state !== null ? (
        <p key={alertId} role="alert" className="sr-only">
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
