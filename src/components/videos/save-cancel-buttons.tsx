import { Button } from "@/components/ui/button";
import { REVIEW_COPY } from "@/lib/videos/review";

/** An in-place edit's tertiary Save (its form's submit, "Saving…" while it runs) and Cancel. */
export function SaveCancelButtons({
  saving,
  onCancel,
}: {
  saving: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="flex gap-4">
      <Button
        type="submit"
        variant="tertiary"
        size="sm"
        loading={saving}
        loadingLabel="Saving…"
      >
        {REVIEW_COPY.save}
      </Button>
      <Button
        type="button"
        variant="tertiary"
        size="sm"
        disabled={saving}
        onClick={onCancel}
      >
        {REVIEW_COPY.cancel}
      </Button>
    </div>
  );
}
