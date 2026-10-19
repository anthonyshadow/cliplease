import { ConnectionsHeader } from "@/components/connections/connections-header";
import { SETTINGS_COLUMN } from "@/components/layout/gutter";
import { Skeleton } from "@/components/ui/skeleton";

/** S13 loading (05 §6.2 States): the title and page line, then two card skeletons (avatar circle + three bars). */
export default function ConnectionsLoading() {
  return (
    <div className={SETTINGS_COLUMN}>
      <ConnectionsHeader />
      <div className="flex flex-col gap-4" aria-busy="true">
        {[0, 1].map((n) => (
          <div
            key={n}
            className="flex flex-col gap-3 rounded-lg bg-surface p-5"
          >
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}
