import { type ComponentProps, type ReactNode, useId } from "react";
import { cn } from "@/lib/utils";

/**
 * 04 §9.3 OptionGroup: a `<fieldset>` whose `<legend>` is `title-2`, an optional `help` line under it (05 §6.5 draws
 * the music question's on its own line; `callout` ink-2, the group's description), then its OptionTiles. The tiles hold
 * native radios, so arrow keys, form posting and no-JS work for free; no Radix RadioGroup. The Rights step's two
 * questions are its first use (owner answer Q-97 a); the license page reuses it (P15).
 */
export function OptionGroup({
  legend,
  help,
  className,
  children,
  "aria-describedby": describedBy,
  ...props
}: Omit<ComponentProps<"fieldset">, "children"> & {
  legend: ReactNode;
  help?: ReactNode;
  children: ReactNode;
}) {
  const helpId = useId();
  return (
    <fieldset
      {...props}
      aria-describedby={
        [help ? helpId : null, describedBy].filter(Boolean).join(" ") ||
        undefined
      }
      className={cn("flex min-w-0 flex-col", className)}
    >
      <legend className={cn("text-title-2 text-ink", help ? "mb-1" : "mb-3")}>
        {legend}
      </legend>
      {help ? (
        <p id={helpId} className="mb-3 text-callout text-ink-2">
          {help}
        </p>
      ) : null}
      {children}
    </fieldset>
  );
}

/**
 * 04 §9.3 OptionTile: a `<label data-focus-within>` (the focus ring sits on the label) around a visually hidden native
 * radio and the title, `body` semibold (the license page adds the description and delta, P15). Selected: the ink
 * border and a 1 px inset ring, no layout shift; forced colors drop the ring (a box-shadow), so there it is a 4 px
 * `Highlight` border (04 §7). Disabled: `fill`, no border, the title `ink-3`.
 */
export function OptionTile({
  title,
  className,
  ...input
}: Omit<ComponentProps<"input">, "type" | "title"> & { title: ReactNode }) {
  return (
    <label
      data-focus-within
      className={cn(
        "group flex min-h-16 cursor-pointer items-center rounded-md border border-hairline-strong bg-surface px-4 py-3.5 hover:border-ink-2 has-checked:border-ink has-checked:ring-1 has-checked:ring-ink has-checked:ring-inset forced-colors:has-checked:border-4 forced-colors:has-checked:border-[Highlight] has-disabled:cursor-not-allowed has-disabled:border-transparent has-disabled:bg-fill",
        className,
      )}
    >
      <input type="radio" className="sr-only" {...input} />
      <span className="min-w-0 text-body font-semibold text-ink group-has-disabled:text-ink-3">
        {title}
      </span>
    </label>
  );
}
