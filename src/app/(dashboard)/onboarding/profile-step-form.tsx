"use client";

import {
  type FormEvent,
  startTransition,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { NativeCheckbox } from "@/components/ui/checkbox";
import { TextField } from "@/components/ui/text-field";
import {
  HANDLE_COPY,
  handleProblem,
  handleProblemMessage,
  normalizeHandleInput,
} from "@/lib/validation/handle";
import { DISPLAY_NAME_MAX } from "@/lib/validation/profile";
import { checkHandle, completeOnboarding } from "./actions";

type Availability = Awaited<ReturnType<typeof checkHandle>>;
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
      return handleProblemMessage(handle) ?? HANDLE_COPY.characters;
  }
}

/**
 * Step 1 (05 §5.2): name, handle, the 18+ box and a hidden time zone. Continue is never disabled; the server checks
 * everything and answers with field errors, and nothing is saved without the tick (07 D93). The form dispatches its
 * action by hand, so React doesn't reset it: typed values survive an error.
 */
export function ProfileStepForm({ linkHost }: { linkHost: string }) {
  const [state, formAction, pending] = useActionState(completeOnboarding, null);
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [timeZone, setTimeZone] = useState("");
  const [handleTouched, setHandleTouched] = useState(false);
  // The handle as it was when typing last paused: format messages wait for it, like the availability check.
  const [settled, setSettled] = useState("");
  const [checked, setChecked] = useState<Availability | null>(null);
  // The handle whose availability check failed: its line stays empty rather than "Checking…" for good.
  const [unchecked, setUnchecked] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [alertId, setAlertId] = useState(0);
  const latestCheck = useRef(0);
  const nameRef = useRef<HTMLInputElement>(null);
  const handleRef = useRef<HTMLInputElement>(null);
  const ageRef = useRef<HTMLInputElement>(null);
  const lineId = useId();

  // The device's zone, read after mount so the server and client renders match (07 D84); empty without JS → UTC.
  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  // Once typing pauses: settle the handle, and ask the server when its format allows; an older answer never replaces a
  // newer one.
  useEffect(() => {
    const id = ++latestCheck.current;
    setChecked(null);
    setUnchecked(null);
    const timer = setTimeout(() => {
      setSettled(handle);
      if (handle === "" || handleProblem(handle) !== null) return;
      checkHandle({ handle })
        .then((result) => {
          if (id === latestCheck.current) setChecked(result);
        })
        .catch(() => {
          if (id === latestCheck.current) setUnchecked(handle);
        });
    }, CHECK_DELAY_MS);
    return () => clearTimeout(timer);
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
    setSuggestions(state.suggestions ?? []);
    setAlertId((id) => id + 1);
    const first = FIELD_ORDER.find((field) => next[field]);
    const ref = {
      displayName: nameRef,
      handle: handleRef,
      ageConfirmed: ageRef,
    };
    if (first) ref[first].current?.focus();
  }, [state]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHandleTouched(true);
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  function changeHandle(value: string) {
    const next = normalizeHandleInput(value);
    // A keystroke that normalizes away (a space, "@") changes nothing, so a refusal such as "was just taken" stays.
    if (next === handle) return;
    setHandle(next);
    setErrors(({ handle: _, ...rest }) => rest);
    setSuggestions([]);
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
      line = availabilityText(handle, checked);
    } else {
      line = unchecked === handle ? null : "Checking…";
    }
  }
  const chips =
    errors.handle !== undefined
      ? suggestions
      : checked?.handle === handle && checked.state === "taken"
        ? checked.suggestions
        : [];

  return (
    <form
      noValidate
      action={formAction}
      onSubmit={submit}
      className="flex flex-col gap-6"
    >
      <TextField
        ref={nameRef}
        label="Your name"
        name="displayName"
        autoComplete="name"
        maxLength={DISPLAY_NAME_MAX}
        helper="Shown on your page and on licenses."
        value={displayName}
        onChange={(event) => {
          setDisplayName(event.target.value);
          setErrors(({ displayName: _, ...rest }) => rest);
        }}
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
        <p
          id={lineId}
          aria-live="polite"
          className="text-footnote text-ink-2 wrap-anywhere"
        >
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
                // A 30-character suggestion can be wider than a phone column: it wraps instead (07 D153).
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
            Your links will look like{" "}
            <span className="wrap-anywhere">{`${linkHost}/@${handle}/your-video`}</span>
          </p>
        ) : null}
      </div>
      <NativeCheckbox
        ref={ageRef}
        label="I'm 18 or older"
        name="ageConfirmed"
        required
        checked={ageConfirmed}
        onChange={(event) => {
          setAgeConfirmed(event.target.checked);
          setErrors(({ ageConfirmed: _, ...rest }) => rest);
        }}
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
        className="w-full md:w-auto md:self-start"
      >
        Continue
      </Button>
    </form>
  );
}
