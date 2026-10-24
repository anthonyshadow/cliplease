import { TWO_COLUMN } from "@/components/layout/gutter";
import { PricesTitle } from "@/components/pricing/prices-title";
import { Skeleton } from "@/components/ui/skeleton";
import { FIELD_HEIGHT } from "@/components/ui/text-field";
import { RATE_DIMENSION_KEYS, RATE_DIMENSIONS } from "@/lib/domain/values";
import { cn } from "@/lib/utils";

/** S21 loading (05 §6.9 States): the title, then the base field and rows as skeletons, the preview card beside them. */
export default function PricingLoading() {
  return (
    <div className={TWO_COLUMN.page} aria-busy="true">
      <div className={cn(TWO_COLUMN.span, "flex flex-col gap-2")}>
        <PricesTitle />
        <Skeleton className="h-4 w-3/5" />
      </div>
      <div className={cn(TWO_COLUMN.main, "flex flex-col gap-8")}>
        <Skeleton className={cn("w-full", FIELD_HEIGHT)} />
        {RATE_DIMENSIONS.map((dimension) => (
          <div key={dimension} className="flex flex-col gap-4">
            <Skeleton className="h-6 w-1/4" />
            {RATE_DIMENSION_KEYS[dimension].map((key) => (
              <div key={key} className="flex flex-col gap-2">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className={cn("w-full", FIELD_HEIGHT)} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className={TWO_COLUMN.side}>
        <Skeleton className="h-72 w-full rounded-lg" />
      </div>
    </div>
  );
}
