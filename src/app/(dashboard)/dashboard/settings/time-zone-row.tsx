"use client";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { usePendingAction } from "@/components/ui/use-pending-action";
import { updateTimeZoneFromDevice } from "./actions";

/**
 * Emails (07 D84): the stored zone, and a button that replaces it with this device's zone. The action revalidates
 * Settings, and its response carries the re-rendered page, so the new zone shows without another fetch. A failure says
 * so in a toast; the button stays for another try.
 */
export function TimeZoneRow({ zone }: { zone: string }) {
  const [pending, run] = usePendingAction();

  async function update() {
    const result = await run(() =>
      updateTimeZoneFromDevice({
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    );
    if (result === null) return;
    toast(result.ok ? "Time zone updated." : result.error.message);
  }

  return (
    <>
      <p className="text-body text-ink">{`Emails use ${zone} (from this device)`}</p>
      <Button
        variant="secondary"
        loading={pending}
        loadingLabel="Updating…"
        className="self-start"
        onClick={() => void update()}
      >
        Update from this device
      </Button>
    </>
  );
}
