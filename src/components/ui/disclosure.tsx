"use client";

import { ChevronDown } from "lucide-react";
import { Collapsible } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/**
 * Radix Collapsible with a `tertiary sm` trigger and a 16 px ChevronDown, e.g. the Inbox "Details" (04 §9.11). With
 * `actions` (null for a row's reserved spot) the trigger shares a row with them: after them below md, before them and
 * right-aligned from md (Details · Decline · Approve). With real actions the trigger is rendered once per tier, the other
 * copy hidden, so the tab order follows what each tier shows (WCAG 2.4.3). `rowClassName` and `contentClassName` place
 * the row and the content in a parent grid (the root then takes `contents`); the content opens under the row, full width.
 */
export function Disclosure({
  label,
  defaultOpen,
  actions,
  className,
  rowClassName,
  contentClassName,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  actions?: ReactNode;
  className?: string;
  rowClassName?: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  const trigger = (
    <Collapsible.Trigger asChild>
      <Button variant="tertiary" size="sm">
        {label}
        {/* Turned by its own trigger's state, so a closed Disclosure inside an open one keeps its chevron down. */}
        <ChevronDown
          aria-hidden
          size={16}
          strokeWidth={2}
          className="transition-transform duration-250 ease-out [[data-state=open]>&]:rotate-180"
        />
      </Button>
    </Collapsible.Trigger>
  );
  return (
    <Collapsible.Root defaultOpen={defaultOpen} className={className}>
      {actions === undefined ? (
        trigger
      ) : (
        <div
          className={cn(
            "flex flex-col items-start gap-2 md:flex-row md:items-center md:justify-end",
            rowClassName,
          )}
        >
          {actions ? (
            <>
              <div className="hidden md:block">{trigger}</div>
              {actions}
              <div className="md:hidden">{trigger}</div>
            </>
          ) : (
            trigger
          )}
        </div>
      )}
      <Collapsible.Content
        className={cn(
          "pt-2 data-[state=open]:animate-fade-in",
          contentClassName,
        )}
      >
        {children}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
