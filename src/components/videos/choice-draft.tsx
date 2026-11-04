"use client";

import { type FormEvent, useLayoutEffect, useRef, useState } from "react";
import type { ZodSafeParseResult } from "zod";
import { RefusalAlert, useRefusal } from "@/components/ui/refusal-alert";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast";
import { usePendingAction } from "@/components/ui/use-pending-action";
import { useRefocusOnSwap } from "@/components/ui/use-refocus-on-swap";
import { useUnsavedChangesGuard } from "@/components/ui/use-unsaved-changes-guard";
import { type ActionResult, GENERIC_ERROR_MESSAGE } from "@/lib/result";
import { SaveCancelButtons } from "./save-cancel-buttons";

/** A radio choice as an editor shows it, with its field's text. */
type StoredChoice<C extends string> = { choice: C; text: string };

/**
 * A stored radio choice, one of which has a field, as a draft (VideoPriceEditor, ExclusiveOfferEditor; owner answers
 * Q-161, Q-163): `dirty` while it differs from what is stored (`same`), `lastValid` the field's last value `parse`
 * accepted, for the preview. `save` sends the choice and the field's value (null for a choice without the field),
 * `cancel` goes back to what is stored; closing or reloading the tab asks first. A value stored elsewhere (another tab,
 * the rate card's base): a clean editor follows it, an edit in progress stays; a save's own refresh finds the editor
 * showing what it stored, and takes its value too (the card's base, after "Use my rate card", so the field starts from
 * it again). A refusal, numbered so each one is announced, takes the focus in the commit that shows it: the field, or
 * the checked radio named `radioName` without one; so does that radio once Save and Cancel go away. Spread `refocus` on
 * the editor's box.
 */
export function useChoiceDraft<C extends string, V>({
  stored,
  storedValue,
  fieldChoice,
  same,
  parse,
  toText,
  radioName,
  refocusKey = "",
  submit,
  savedToast,
}: {
  stored: StoredChoice<C>;
  storedValue: V;
  /** The choice that shows the field. */
  fieldChoice: C;
  same: (a: StoredChoice<C>, b: StoredChoice<C>) => boolean;
  parse: (text: string) => ZodSafeParseResult<V>;
  /** A saved value as the refreshed page will show it. */
  toText: (value: V) => string;
  radioName: string;
  /** What else swaps the box's controls, for `refocus`. */
  refocusKey?: string;
  submit: (choice: C, value: V | null) => Promise<ActionResult>;
  savedToast: string;
}) {
  const fresh = { ...stored, lastValid: storedValue };
  const [draft, setDraft] = useState(fresh);
  const [seen, setSeen] = useState(stored);
  const [refusal, refuse, clearRefusal] = useRefusal();
  const [saving, run] = usePendingAction();
  const field = useRef<HTMLInputElement>(null);
  const dirty = !same(draft, stored);
  const checked = `input[name="${radioName}"]:checked`;
  const refocus = useRefocusOnSwap<HTMLDivElement>(
    `${dirty ? "dirty" : "clean"}:${refocusKey}`,
    [checked],
  );

  if (seen.choice !== stored.choice || seen.text !== stored.text) {
    setSeen(stored);
    if (same(draft, seen) || same(draft, stored)) setDraft(fresh);
  }

  useLayoutEffect(() => {
    if (!refusal) return;
    const target =
      field.current ?? refocus.ref.current?.querySelector<HTMLElement>(checked);
    target?.focus();
  }, [refusal, refocus.ref, checked]);
  useUnsavedChangesGuard(dirty);

  function choose(choice: C) {
    setDraft((current) => ({ ...current, choice }));
    clearRefusal();
  }

  function edit(text: string) {
    const parsed = parse(text);
    setDraft((current) => ({
      ...current,
      text,
      lastValid: parsed.success ? parsed.data : current.lastValid,
    }));
    clearRefusal();
  }

  function cancel() {
    // A new object: React skips setting the same one but keeps the update queued, and that would undo the next follow.
    setDraft({ ...fresh });
    clearRefusal();
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Enter in an unchanged field saves nothing.
    if (saving || !dirty) return;
    const { choice, text } = draft;
    const parsed = choice === fieldChoice ? parse(text) : null;
    if (parsed && !parsed.success) {
      refuse(parsed.error.issues[0]?.message ?? GENERIC_ERROR_MESSAGE);
      return;
    }
    clearRefusal();
    const result = await run(() => submit(choice, parsed ? parsed.data : null));
    if (result === null) return;
    if (result.ok) {
      // "1,000" or "4" saved shows as the refreshed page will ("1000", "4.00"), unless the field was edited meanwhile.
      if (parsed) {
        const savedText = toText(parsed.data);
        setDraft((current) =>
          current.text === text ? { ...current, text: savedText } : current,
        );
      }
      toast(savedToast);
      return;
    }
    refuse(result.error.message);
  }

  return {
    choice: draft.choice,
    text: draft.text,
    lastValid: draft.lastValid,
    showField: draft.choice === fieldChoice,
    dirty,
    saving,
    refusal,
    field,
    refocus,
    choose,
    edit,
    cancel,
    save,
  };
}

/**
 * The draft's field while its choice is chosen, and Save and Cancel while it differs from what is stored. Enter saves,
 * Escape cancels; a refusal goes under the field and is announced.
 */
export function ChoiceDraftForm<C extends string, V>({
  draft,
  label,
  prefix,
  helper,
}: {
  draft: ReturnType<typeof useChoiceDraft<C, V>>;
  label: string;
  prefix: string;
  helper: string;
}) {
  if (!draft.showField && !draft.dirty) return null;
  return (
    <form
      noValidate
      onSubmit={draft.save}
      onKeyDown={(event) => {
        // A save in flight finishes first.
        if (event.key === "Escape" && !draft.saving) draft.cancel();
      }}
      className="flex flex-col gap-2"
    >
      {draft.showField ? (
        <TextField
          ref={draft.field}
          label={label}
          prefix={prefix}
          inputMode="decimal"
          autoComplete="off"
          helper={helper}
          value={draft.text}
          onChange={(event) => draft.edit(event.target.value)}
          error={draft.refusal?.message}
        />
      ) : null}
      {draft.dirty ? (
        <SaveCancelButtons saving={draft.saving} onCancel={draft.cancel} />
      ) : null}
      <RefusalAlert refusal={draft.refusal} />
    </form>
  );
}
