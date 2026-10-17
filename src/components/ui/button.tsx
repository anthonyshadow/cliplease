"use client";

import { cva } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import { Slot } from "radix-ui";
import type { ComponentProps, MouseEvent } from "react";
import { cn } from "@/lib/utils";

// 04 §9.2. `border` is always present (transparent when unused) so forced-colors mode keeps the shape. Press feedback
// runs at --dur-press (100 ms, 04 §6); hover and color changes at 200 ms.
const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-full border font-semibold transition-[background-color,border-color,color,opacity,scale,filter] duration-200 ease-standard active:duration-100 disabled:cursor-not-allowed aria-disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        primary:
          "border-transparent bg-action text-action-ink hover:bg-action-hover active:scale-98 active:bg-action-pressed disabled:bg-fill disabled:text-ink-3",
        secondary:
          "border-hairline-strong bg-transparent text-ink hover:border-ink active:bg-fill disabled:border-hairline disabled:text-ink-3",
        tertiary:
          "border-transparent bg-transparent text-ink underline-offset-4 hover:underline active:opacity-70 disabled:text-ink-3 disabled:no-underline",
        link: "border-transparent bg-transparent font-normal text-link underline-offset-4 hover:underline active:opacity-70",
        destructive:
          "border-transparent bg-danger text-danger-ink hover:brightness-95 active:scale-98 disabled:bg-fill disabled:text-ink-3",
      },
      size: {
        lg: "h-11 min-w-22 gap-2 px-5 text-body",
        sm: "hit-44 h-9 gap-1.5 px-4 text-callout",
        // The icon button has one look of its own (no variant): a 44 px `fill` circle with an `ink` icon.
        icon: "size-11 border-transparent bg-fill text-ink hover:brightness-95 active:scale-98 disabled:text-ink-3 disabled:brightness-100",
      },
    },
    compoundVariants: [
      // A link has no pill box: it keeps its 44 px height (lg) or hit area (sm) but no padding or minimum width,
      // and its text wraps like any link.
      {
        variant: "link",
        size: "lg",
        className: "h-auto min-h-11 min-w-0 whitespace-normal px-0 text-left",
      },
      {
        variant: "link",
        size: "sm",
        className: "h-auto min-h-9 whitespace-normal px-0 text-left",
      },
    ],
    defaultVariants: { variant: "primary", size: "lg" },
  },
);

type Variant = "primary" | "secondary" | "tertiary" | "link" | "destructive";

type BaseProps = Omit<ComponentProps<"button">, "aria-label"> & {
  /** Renders the single child (a `next/link` <Link>, an <a>) with the button's classes. */
  asChild?: boolean;
};

/**
 * Loading locks the width, shows a spinner and `loadingLabel`, and ignores clicks (04 §9.2). The present-participle
 * label ("Approving…") is required whenever `loading` is passed: it is the button's name while loading.
 */
export type ButtonLoadingProps =
  | { loading?: false; loadingLabel?: undefined }
  | { loading: boolean; loadingLabel: string };

export type ButtonProps = BaseProps &
  (
    | ({
        variant?: Variant;
        size?: "lg" | "sm";
        "aria-label"?: string;
      } & ButtonLoadingProps)
    /** An icon-only button keeps its `aria-label` as its name, loading or not. */
    | {
        variant?: never;
        size: "icon";
        "aria-label": string;
        loading?: boolean;
        loadingLabel?: undefined;
      }
  );

export function Button({
  variant = "primary",
  size = "lg",
  asChild = false,
  loading = false,
  loadingLabel,
  className,
  children,
  onClick,
  type = "button",
  ...props
}: ButtonProps) {
  const classes = cn(
    buttonVariants({ variant: size === "icon" ? null : variant, size }),
    className,
  );
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  const busy = {
    "aria-busy": loading || undefined,
    "aria-disabled": loading || props["aria-disabled"] || undefined,
  };
  if (asChild) {
    // The child (a <Link>, an <a>) keeps the click handler and the busy state; it has no spinner layer.
    return (
      <Slot.Root {...props} {...busy} className={classes} onClick={handleClick}>
        {children}
      </Slot.Root>
    );
  }
  const spinner = (
    <LoaderCircle
      aria-hidden
      size={16}
      strokeWidth={2}
      className={cn(loading && "animate-spin")}
    />
  );
  let content = children;
  if (loadingLabel !== undefined) {
    // The label and the loading layer (spinner + loadingLabel) share one grid cell, so the width never changes
    // while loading; the hidden layer is aria-hidden and never repeats the children.
    content = (
      <span className="inline-grid">
        <span
          className={cn(
            "col-start-1 row-start-1 inline-flex items-center justify-center",
            size === "sm" ? "gap-1.5" : "gap-2",
            loading && "invisible",
          )}
        >
          {children}
        </span>
        <span
          className={cn(
            "col-start-1 row-start-1 inline-flex items-center justify-center gap-1.5",
            !loading && "invisible",
          )}
          aria-hidden={!loading}
        >
          {spinner}
          {loadingLabel}
        </span>
      </span>
    );
  } else if (loading) {
    // An icon button is a fixed 44 px circle: the spinner takes the icon's place; `aria-label` stays its name.
    content = spinner;
  }
  return (
    <button
      {...props}
      type={type}
      {...busy}
      className={classes}
      onClick={handleClick}
    >
      {content}
    </button>
  );
}
