"use client";

import { useEffect, useId, useRef, useState } from "react";
import { confirmSameVideo } from "@/app/(dashboard)/dashboard/videos/[id]/actions";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { NativeCheckbox } from "@/components/ui/checkbox";
import { PRIMARY_WIDTH } from "@/components/ui/primary-width";
import { useFormAction } from "@/components/ui/use-form-action";
import { SAME_VIDEO_COPY } from "@/lib/videos/source-page";

/**
 * A Library video's tick and Continue once the original is attached (07 D39; owner answer Q-64 a): the duration warning
 * above the tick (01 J5.10), the required "This file is the same video as the post" (a native checkbox posting `on`, as
 * onboarding's 18+ box does) and Continue, the submit of confirmSameVideo, disabled until the box is ticked with "Tick the
 * box to continue." under it. A refusal shows on the box (and takes the focus) or under Continue. Mounted only while the
 * original is ready, so the tick starts from what the server stored.
 */
export function SameVideoForm({
  videoId,
  confirmed,
  warning,
}: {
  videoId: string;
  /** same_video_confirmed_at is already set: the box starts ticked. */
  confirmed: boolean;
  /** The duration warning (durationMismatchMessage), or null. */
  warning: string | null;
}) {
  const { state, pending, resultKey, formProps } = useFormAction(
    confirmSameVideo,
    null,
  );
  const [ticked, setTicked] = useState(confirmed);
  const [error, setError] = useState<{ tick?: string; form?: string }>({});
  const tickRef = useRef<HTMLInputElement>(null);
  const helperId = useId();

  useEffect(() => {
    if (state === null) return;
    const tick = state.error.fields?.sameVideo?.[0];
    setError(tick ? { tick } : { form: state.error.message });
    if (tick) tickRef.current?.focus();
  }, [state]);

  const helper = !ticked && !error.tick;
  return (
    <form {...formProps} className="flex flex-col gap-6">
      <input type="hidden" name="videoId" value={videoId} />
      {warning ? <Banner tone="warning">{warning}</Banner> : null}
      <NativeCheckbox
        ref={tickRef}
        name="sameVideo"
        label={SAME_VIDEO_COPY.tick}
        required
        checked={ticked}
        onChange={(event) => {
          setTicked(event.target.checked);
          setError({});
        }}
        error={error.tick}
      />
      <div className="flex flex-col gap-2">
        <Button
          type="submit"
          disabled={!ticked}
          loading={pending}
          loadingLabel="Continuing…"
          aria-describedby={helper ? helperId : undefined}
          className={PRIMARY_WIDTH}
        >
          Continue
        </Button>
        {helper ? (
          <p id={helperId} className="text-footnote text-ink-2">
            {SAME_VIDEO_COPY.tickToContinue}
          </p>
        ) : null}
        {error.form ? (
          <p
            key={resultKey}
            role="alert"
            className="text-footnote text-danger-text"
          >
            {error.form}
          </p>
        ) : null}
      </div>
    </form>
  );
}
