"use client";

import { useEffect, useId, useRef, useState } from "react";
import { OptionGroup, OptionTile } from "@/components/license/option-group";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { useFormAction } from "@/components/ui/use-form-action";
import {
  APPROVAL_WINDOW_HOURS,
  type ApprovalWindowHours,
} from "@/lib/domain/values";
import {
  APPROVAL_WINDOW_LABEL,
  REQUESTS_SETTINGS_COPY as COPY,
} from "@/lib/payouts";
import { updateCreatorSettings } from "./actions";

/**
 * Requests → the approval window, auto-approve and their own Save (05 §6.11 callouts 4, 5 and 8; 07 D81). The window's
 * tiles are native radios (compact: titles only), 2 × 2 below md and a row of four from md. The Switch has no name: it
 * posts through the hidden "on"/"off" field. It is locked (aria-disabled, presses ignored, the lock reason in place of
 * the helper) while payouts aren't active and it is stored off; stored on, it can always be turned off (owner answer
 * Q-153). `payoutsActive` is the page's fresh read; the server decides the payouts rule either way. A refusal moves the
 * focus to the Switch, whose error says why (04 §9.2); once the page re-renders locked, the lock reason says it alone.
 */
export function RequestsSettingsForm({
  approvalWindowHours,
  autoApprove,
  payoutsActive,
}: {
  approvalWindowHours: ApprovalWindowHours;
  autoApprove: boolean;
  payoutsActive: boolean;
}) {
  const { state, pending, resultKey, formProps } = useFormAction(
    updateCreatorSettings,
    null,
  );
  const [on, setOn] = useState(autoApprove);
  const [refusal, setRefusal] = useState<string>();
  const switchRef = useRef<HTMLButtonElement>(null);
  const helpId = useId();
  const locked = !payoutsActive && !autoApprove;

  useEffect(() => {
    if (state === null) return;
    if (state.ok) {
      setRefusal(undefined);
      toast(COPY.saved);
      return;
    }
    setRefusal(state.error.message);
    // Only turning it on is refused, so the stored value is off.
    if (state.error.code === "payouts_not_active") setOn(false);
    switchRef.current?.focus();
  }, [state]);

  return (
    <form {...formProps} className="flex flex-col gap-4">
      <OptionGroup legend={COPY.approvalWindow} aria-describedby={helpId}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {APPROVAL_WINDOW_HOURS.map((hours) => (
            <OptionTile
              key={hours}
              name="approvalWindowHours"
              value={String(hours)}
              defaultChecked={hours === approvalWindowHours}
              title={APPROVAL_WINDOW_LABEL[hours]}
            />
          ))}
        </div>
        <p id={helpId} className="mt-2 text-callout text-ink-2">
          {COPY.newRequestsOnly}
        </p>
      </OptionGroup>
      <Switch
        ref={switchRef}
        label={COPY.autoApprove}
        checked={on}
        onCheckedChange={(next) => {
          if (locked) return;
          setOn(next);
          setRefusal(undefined);
        }}
        // Radix ignores aria-disabled: the press is stopped here and above.
        onClick={(event) => {
          if (locked) event.preventDefault();
        }}
        aria-disabled={locked || undefined}
        helper={locked ? COPY.autoApproveLocked : COPY.autoApproveHelper}
        error={locked ? undefined : refusal}
      />
      <input type="hidden" name="autoApprove" value={on ? "on" : "off"} />
      {state !== null && !state.ok ? (
        <p key={resultKey} role="alert" className="sr-only">
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
