"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { updateVideoDetails } from "@/app/(dashboard)/dashboard/videos/[id]/review-actions";
import { Button } from "@/components/ui/button";
import { type Fact, FactList } from "@/components/ui/fact-list";
import { RefusalAlert, useRefusal } from "@/components/ui/refusal-alert";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast";
import { usePendingAction } from "@/components/ui/use-pending-action";
import { useRefocusOnSwap } from "@/components/ui/use-refocus-on-swap";
import { videoUrl } from "@/lib/urls";
import { editRowLabel, LINK_ROW_ID, REVIEW_COPY } from "@/lib/videos/review";
import { TITLE_MAX } from "@/lib/videos/title";
import { VIDEO_PAGE_COPY } from "@/lib/videos/video-page";
import { SaveCancelButtons } from "./save-cancel-buttons";

type Field = "title" | "slug";

const ROW_LABEL = { title: REVIEW_COPY.title, slug: REVIEW_COPY.link } as const;

/**
 * The Review's rows (05 §6.5 callouts 43–49), Title and Link first (07 D09, D23): _Edit_ reveals the field in place with
 * Save and Cancel; Save stores that field alone (updateVideoDetails), and the page shows the stored values again. The Link
 * reads "/@{handle}/{slug}" with "Can't change after you publish."; once published it reads "/@{handle}/{slug} (locked)"
 * with no _Edit_ (`slugLocked`, 05 §6.7 callout 5). The page's own rows (`facts`, rendered on the server) follow in the
 * same list. `savedToast`: a save says "Saved." (the video page, 05 §6.7 States); `readOnly` (a disabled video) offers
 * no _Edit_.
 */
export function ReviewDetails({
  videoId,
  title,
  slug,
  handle,
  slugLocked,
  savedToast = false,
  readOnly = false,
  facts: more,
}: {
  videoId: string;
  title: string;
  slug: string;
  handle: string;
  slugLocked: boolean;
  savedToast?: boolean;
  readOnly?: boolean;
  /** The rows after Link. */
  facts: readonly Fact[];
}) {
  const [editing, setEditing] = useState<Field | null>(null);
  const [draft, setDraft] = useState("");
  // A refusal, numbered so each one is announced and focuses the field once it has rendered.
  const [refusal, refuse, clearRefusal] = useRefusal();
  const [saving, run] = usePendingAction();
  const field = useRef<HTMLInputElement>(null);
  // The last row opened: its _Edit_ takes back a focus the closing field drops.
  const [lastOpened, setLastOpened] = useState<Field | null>(null);
  const refocus = useRefocusOnSwap<HTMLDivElement>(
    editing ?? `closed:${lastOpened}`,
    editing ? [] : [`[data-edit-row="${lastOpened}"]`],
  );

  useEffect(() => {
    if (editing) field.current?.focus();
  }, [editing]);
  useEffect(() => {
    if (refusal) field.current?.focus();
  }, [refusal]);

  function open(which: Field) {
    setLastOpened(which);
    setDraft(which === "title" ? title : slug);
    clearRefusal();
    setEditing(which);
  }

  const close = () => setEditing(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || saving) return;
    // Only this row: a value rendered earlier never overwrites another tab's newer one.
    const result = await run(() =>
      updateVideoDetails(
        editing === "title"
          ? { videoId, title: draft }
          : { videoId, slug: draft },
      ),
    );
    if (result === null) return;
    if (result.ok) {
      close();
      if (savedToast) toast(VIDEO_PAGE_COPY.saved);
      return;
    }
    refuse(result.error.fields?.[editing]?.[0] ?? result.error.message);
  }

  const editButton = (which: Field) =>
    editing || readOnly ? null : (
      <Button
        data-edit-row={which}
        variant="tertiary"
        size="sm"
        aria-label={editRowLabel(ROW_LABEL[which])}
        onClick={() => open(which)}
      >
        {REVIEW_COPY.edit}
      </Button>
    );

  const editor = (which: Field) => (
    <form
      noValidate
      onSubmit={save}
      onKeyDown={(event) => {
        // A save in flight finishes first: its result belongs to this row.
        if (event.key === "Escape" && !saving) close();
      }}
      className="flex flex-col gap-2"
    >
      <TextField
        ref={field}
        label={ROW_LABEL[which]}
        hideLabel
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          clearRefusal();
        }}
        maxLength={which === "title" ? TITLE_MAX : undefined}
        autoComplete="off"
        error={refusal?.message}
        helper={which === "slug" ? REVIEW_COPY.linkHelper : undefined}
      />
      <SaveCancelButtons saving={saving} onCancel={close} />
      <RefusalAlert refusal={refusal} />
    </form>
  );

  const facts: Fact[] = [
    {
      label: REVIEW_COPY.title,
      value:
        editing === "title" ? (
          editor("title")
        ) : (
          <span className="wrap-anywhere">{title}</span>
        ),
      action: editButton("title"),
    },
    {
      label: REVIEW_COPY.link,
      id: LINK_ROW_ID,
      value:
        editing === "slug" ? (
          editor("slug")
        ) : slugLocked ? (
          <p className="wrap-anywhere">
            {`${videoUrl(handle, slug)} ${VIDEO_PAGE_COPY.locked}`}
          </p>
        ) : (
          <>
            <p className="wrap-anywhere">{videoUrl(handle, slug)}</p>
            <p className="text-footnote text-ink-2">{REVIEW_COPY.linkHelper}</p>
          </>
        ),
      action: slugLocked ? null : editButton("slug"),
    },
    ...more,
  ];
  return (
    <div {...refocus}>
      <FactList facts={facts} />
    </div>
  );
}
