"use client";

import { DropdownMenu } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// 04 §9.1: Radix DropdownMenu, always portaled. Words only, no icons, no red items: destructive actions go
// through ConfirmSheet. Items are 44 px tall.
export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;

export function MenuContent({
  className,
  align = "end",
  sideOffset = 6,
  children,
  ...props
}: ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 flex min-w-44 flex-col rounded-md border border-transparent bg-surface-raised p-1 text-ink shadow-overlay animate-fade-in data-[state=closed]:animate-fade-out",
          className,
        )}
        {...props}
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

export function MenuItem({
  className,
  ...props
}: ComponentProps<typeof DropdownMenu.Item>) {
  return (
    <DropdownMenu.Item
      className={cn(
        "flex min-h-11 cursor-default select-none items-center rounded-sm px-3 text-callout text-ink data-[disabled]:text-ink-3 data-[highlighted]:bg-fill",
        className,
      )}
      {...props}
    />
  );
}
