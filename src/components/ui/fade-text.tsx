"use client";

import { type ComponentProps, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Text that cross-fades in when it changes (04 §9.3, §9.4: the license page's deltas and amounts, `duration-200`; the
 * global reduced-motion rule makes it instant). The first text, as the server rendered it, doesn't fade: a new text
 * mounts a new node with `animate-fade-in`.
 */
export function FadeText({
  text,
  className,
  ...props
}: Omit<ComponentProps<"span">, "children"> & { text: string }) {
  const [first] = useState(text);
  return (
    <span
      key={text}
      className={cn(className, text !== first && "animate-fade-in")}
      {...props}
    >
      {text}
    </span>
  );
}
