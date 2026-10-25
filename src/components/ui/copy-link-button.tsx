"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { TextField } from "./text-field";
import { COPY_LINK_COPY, useCopyLink } from "./use-copy-link";

/**
 * A card's "Copy link" (04 §9.27; 05 §6.8): a secondary sm button that reads "Link copied" for 2 s, announced politely.
 * Without a clipboard the link shows selected in a read-only field named `label`, with "Press and hold to copy"
 * (01 J6.1). Several on one page share the name "Copy link": `describedBy` names the card each one belongs to.
 */
export function CopyLinkButton({
  url,
  label,
  describedBy,
  className,
}: {
  url: string;
  label: string;
  describedBy?: string;
  className?: string;
}) {
  const { status, copy } = useCopyLink(url);
  const copied = status.kind === "copied";
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (status.kind === "manual") field.current?.select();
  }, [status]);
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <Button
        variant="secondary"
        size="sm"
        aria-describedby={describedBy}
        onClick={copy}
        className="self-start"
      >
        {copied ? COPY_LINK_COPY.copied : "Copy link"}
      </Button>
      {status.kind === "manual" ? (
        <TextField
          ref={field}
          label={label}
          hideLabel
          readOnly
          value={url}
          helper={COPY_LINK_COPY.manual}
        />
      ) : null}
      {/* Keyed by the press, so a repeated copy is announced again. */}
      <p aria-live="polite" className="sr-only">
        <span key={status.id}>{copied ? COPY_LINK_COPY.copied : null}</span>
      </p>
    </div>
  );
}
