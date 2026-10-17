import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** A static `fill` block: no pulse, no shimmer (04 §6 rule 2). Size it with classes. */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      className={cn("rounded-md bg-fill", className)}
      {...props}
    />
  );
}
