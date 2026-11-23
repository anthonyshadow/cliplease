"use client";

import { useRef } from "react";
import { useFocusOnRemove } from "@/components/ui/use-focus-on-remove";
import { focusAnchorSelector } from "./focus-anchor";

/** The trigger's row anchor, then its list's (focusAnchor): the ones still on the page take the focus, in that order. */
function anchorsOf(trigger: HTMLElement): HTMLElement[] {
  const row = trigger
    .closest("li, tr")
    ?.querySelector<HTMLElement>(focusAnchorSelector("row"));
  const list = trigger
    .closest("section")
    ?.querySelector<HTMLElement>(focusAnchorSelector("list"));
  return [row, list].filter((el): el is HTMLElement => el != null);
}

function focusFirst(anchors: readonly HTMLElement[]): void {
  anchors.find((el) => el.isConnected)?.focus();
}

/**
 * Keeps the focus on the page when a row's action leaves after it worked (a revoked license's Revoke, a Retry that went
 * through, an Events row that left its list; 04 §9.22): its sheet hands the focus back to the trigger while the trigger
 * is there, else to the trigger's row anchor, else to its list's, as they were found when the sheet opened (`opening`,
 * from the trigger's click). A trigger that leaves the page while it has the focus (the refreshed row dropped it after
 * the sheet closed) hands it on the same way, its anchors found as it leaves (useFocusOnRemove). Returns the trigger's
 * ref, `opening` and the sheet's onCloseAutoFocus.
 */
export function useFocusHandOff<T extends HTMLElement>() {
  const anchors = useRef<HTMLElement[]>([]);
  const trigger = useFocusOnRemove<T>((leaving) => {
    const left = anchorsOf(leaving);
    return () => focusFirst(left);
  });
  const opening = () => {
    if (trigger.current) anchors.current = anchorsOf(trigger.current);
  };
  const onCloseAutoFocus = (event: Event) => {
    event.preventDefault();
    const button = trigger.current;
    if (button?.isConnected) button.focus();
    else focusFirst(anchors.current);
  };
  return { trigger, opening, onCloseAutoFocus };
}
