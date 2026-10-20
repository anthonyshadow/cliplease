"use client";

import { cva } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import { Slot } from "radix-ui";
import {
  type ComponentProps,
  cloneElement,
  isValidElement,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
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

/** `wrap`: a long label wraps onto more lines instead of running past its column; the size keeps the minimum height. */
const WRAP_CLASSES = {
  lg: "h-auto min-h-11 whitespace-normal text-left",
  sm: "h-auto min-h-9 whitespace-normal text-left",
} as const;

type Variant = "primary" | "secondary" | "tertiary" | "link" | "destructive";

type BaseProps = Omit<ComponentProps<"button">, "aria-label"> & {
  /** Renders the single child (a `next/link` <Link>, an <a>) with the button's classes and loading layer. */
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
        /** A label long enough to wrap (a long tertiary link), see WRAP_CLASSES. */
        wrap?: boolean;
      } & ButtonLoadingProps)
    /** An icon-only button keeps its `aria-label` as its name, loading or not. */
    | {
        variant?: never;
        size: "icon";
        "aria-label": string;
        loading?: boolean;
        loadingLabel?: undefined;
        wrap?: never;
      }
  );

export function Button({
  variant = "primary",
  size = "lg",
  asChild = false,
  loading = false,
  loadingLabel,
  wrap = false,
  className,
  children,
  onClick,
  type = "button",
  ...props
}: ButtonProps) {
  const classes = cn(
    buttonVariants({ variant: size === "icon" ? null : variant, size }),
    wrap && size !== "icon" && WRAP_CLASSES[size],
    className,
  );
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  const shared = {
    "aria-busy": loading || undefined,
    "aria-disabled": loading || props["aria-disabled"] || undefined,
    // Which kind of button this is, for tests and styles that ask "the primary" (05 §6.2: one per view).
    "data-variant": size === "icon" ? undefined : variant,
    className: classes,
    onClick: handleClick,
  };
  const spinner = (
    <LoaderCircle
      aria-hidden
      size={16}
      strokeWidth={2}
      className={cn(loading && "animate-spin")}
    />
  );
  // The label and the loading layer (spinner + loadingLabel) share one grid cell, so the width never changes while
  // loading; the hidden layer is aria-hidden and never repeats the label. A link's text starts where its line does.
  const align = variant === "link" ? "justify-start" : "justify-center";
  const layered = (label: ReactNode) =>
    loadingLabel === undefined ? (
      label
    ) : (
      <span className="inline-grid">
        <span
          className={cn(
            "col-start-1 row-start-1 inline-flex items-center",
            align,
            size === "sm" ? "gap-1.5" : "gap-2",
            loading && "invisible",
          )}
        >
          {label}
        </span>
        <span
          className={cn(
            "col-start-1 row-start-1 inline-flex items-center gap-1.5",
            align,
            !loading && "invisible",
          )}
          aria-hidden={!loading}
        >
          {spinner}
          {loadingLabel}
        </span>
      </span>
    );
  if (asChild) {
    // The child (a <Link>, an <a>) keeps the click handler and the busy state; its own label gets the loading layer.
    const child = isValidElement<{ children?: ReactNode }>(children)
      ? cloneElement(
          children as ReactElement<{ children?: ReactNode }>,
          undefined,
          layered(children.props.children),
        )
      : children;
    return (
      <Slot.Root {...props} {...shared}>
        {child}
      </Slot.Root>
    );
  }
  // An icon button is a fixed 44 px circle: while loading the spinner takes the icon's place; `aria-label` stays its name.
  const content =
    loadingLabel === undefined && loading ? spinner : layered(children);
  return (
    <button {...props} type={type} {...shared}>
      {content}
    </button>
  );
}
