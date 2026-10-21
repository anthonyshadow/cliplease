"use client";

import { Avatar as AvatarPrimitive } from "radix-ui";
import { initials } from "@/lib/initials";
import { cn } from "@/lib/utils";

/** Round avatar with an initials fallback on `fill`. Size with a `size-*` class (default 40 px). */
export function Avatar({
  name,
  src,
  className,
}: {
  /** Used for the initials and the image's alt text. */
  name: string;
  src?: string | null;
  className?: string;
}) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        "relative flex size-10 shrink-0 overflow-hidden rounded-full bg-fill select-none",
        className,
      )}
    >
      {src ? (
        <AvatarPrimitive.Image
          src={src}
          alt={name}
          className="size-full object-cover"
        />
      ) : null}
      <AvatarPrimitive.Fallback
        // Without an image the initials render at once, in the server HTML too; with one they wait 300 ms, so they
        // don't flash before the photo. Keyed on the image, so one that goes away shows them at once too.
        key={src ? "image" : "none"}
        delayMs={src ? 300 : undefined}
        className="flex size-full items-center justify-center text-caption text-ink-2"
      >
        <span aria-hidden>{initials(name)}</span>
        <span className="sr-only">{name}</span>
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
