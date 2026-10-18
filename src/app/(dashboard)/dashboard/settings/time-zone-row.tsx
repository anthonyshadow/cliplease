"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { updateTimeZoneFromDevice } from "./actions";

/**
 * Emails (07 D84): the stored zone, and a button that replaces it with this device's zone. The action revalidates
 * Settings, and its response carries the re-rendered page, so the new zone shows without another fetch.
 */
export function TimeZoneRow({ zone }: { zone: string }) {
  const [pending, startTransition] = useTransition();

  function update() {
    startTransition(async () => {
      await updateTimeZoneFromDevice({
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      toast("Time zone updated.");
    });
  }

  return (
    <>
      <p className="text-body text-ink">{`Emails use ${zone} (from this device)`}</p>
      <Button
        variant="secondary"
        loading={pending}
        loadingLabel="Updating…"
        className="self-start"
        onClick={update}
      >
        Update from this device
      </Button>
    </>
  );
}
