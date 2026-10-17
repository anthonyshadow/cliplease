import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BannerTone = "info" | "warning" | "error";

const TONES = {
  info: { box: "bg-fill", icon: Info, iconClass: "text-ink-2" },
  warning: {
    box: "bg-awaiting-tint",
    icon: TriangleAlert,
    iconClass: "text-awaiting-text",
  },
  error: {
    box: "bg-danger-tint",
    icon: CircleAlert,
    iconClass: "text-danger-text",
  },
} as const;

/** Status line (04 §9.21): `role="status"`, or `role="alert"` for errors. There is no success banner. */
export function Banner({
  tone = "info",
  action,
  className,
  children,
}: {
  tone?: BannerTone;
  /** An optional `Button variant="link"`. */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const { box, icon: Icon, iconClass } = TONES[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-md border border-transparent px-4 py-3 text-callout text-ink",
        box,
        className,
      )}
    >
      <Icon
        aria-hidden
        size={16}
        strokeWidth={2}
        className={cn("mt-0.5 shrink-0", iconClass)}
      />
      <div className="flex flex-1 flex-wrap items-baseline gap-x-3">
        <div>{children}</div>
        {action}
      </div>
    </div>
  );
}
