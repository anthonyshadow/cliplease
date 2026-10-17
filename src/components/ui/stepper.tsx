import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 04 §9.28, generic over its steps: P10b passes File · Rights · Review, P11c File · Where posted · Rights · Review,
 * P05 Profile · Connect · Payouts. `current` is 0-based. Below md: "Step n of N · {label}" over an N-segment bar;
 * from md: an <ol> with `aria-current="step"`.
 */
export function Stepper({
  steps,
  current,
  className,
}: {
  /** At least one step. */
  steps: readonly [string, ...string[]];
  current: number;
  className?: string;
}) {
  const index = Math.min(Math.max(current, 0), steps.length - 1);
  return (
    <div className={className}>
      <div className="flex flex-col gap-2 md:hidden">
        <p className="text-caption text-ink-2">
          {`Step ${index + 1} of ${steps.length} · ${steps[index]}`}
        </p>
        <div aria-hidden className="flex gap-1">
          {steps.map((step, i) => (
            <span
              key={step}
              className={cn(
                "h-1 flex-1 rounded-full",
                i <= index ? "bg-action" : "bg-fill",
              )}
            />
          ))}
        </div>
      </div>
      <ol className="hidden items-center gap-6 md:flex">
        {steps.map((step, i) => (
          <li
            key={step}
            aria-current={i === index ? "step" : undefined}
            className={cn(
              "flex items-center gap-1.5 text-callout",
              i < index && "text-ink",
              i === index &&
                "font-semibold text-ink underline decoration-2 underline-offset-6",
              i > index && "text-ink-2",
            )}
          >
            {i < index ? <Check aria-hidden size={16} strokeWidth={2} /> : null}
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}
