"use client";

import { ChevronDown } from "lucide-react";
import { Collapsible } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Radix Collapsible with a `tertiary sm` trigger and a 16 px ChevronDown, e.g. the Inbox "Details" (04 §9.11). */
export function Disclosure({
  label,
  defaultOpen,
  className,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Collapsible.Root
      defaultOpen={defaultOpen}
      className={cn("group", className)}
    >
      <Collapsible.Trigger className="hit-44 inline-flex h-9 items-center gap-1.5 rounded-full border border-transparent px-4 text-callout font-semibold text-ink underline-offset-4 hover:underline active:opacity-70">
        {label}
        <ChevronDown
          aria-hidden
          size={16}
          strokeWidth={2}
          className="transition-transform duration-250 ease-out group-data-[state=open]:rotate-180"
        />
      </Collapsible.Trigger>
      <Collapsible.Content className="pt-2 data-[state=open]:animate-fade-in">
        {children}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
