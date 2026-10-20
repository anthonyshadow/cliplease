import { LIBRARY_GRID, WIDE_COLUMN } from "@/components/layout/gutter";
import { Skeleton } from "@/components/ui/skeleton";

/** S12 loading (05 §6.1 States): 3 strip circles, 3 chip pills and 6 tiles (a well and two bars); static, no text. */
export default function LibraryLoading() {
  return (
    <div className={WIDE_COLUMN} aria-busy="true">
      <Skeleton className="h-8 w-3/5 max-w-md" />
      <div className="flex gap-4 py-1">
        {[0, 1, 2].map((n) => (
          <Skeleton key={n} className="size-10 rounded-full" />
        ))}
      </div>
      <div className="flex gap-2 py-1">
        {[0, 1, 2].map((n) => (
          <Skeleton key={n} className="h-9 w-24 rounded-full" />
        ))}
      </div>
      <ul className={LIBRARY_GRID}>
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <li key={n} className="flex flex-col gap-2">
            <Skeleton className="aspect-post" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-3/5" />
          </li>
        ))}
      </ul>
    </div>
  );
}
