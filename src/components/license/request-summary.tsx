import { FactList } from "@/components/ui/fact-list";
import { formatMoney } from "@/lib/format";
import type { BuyerStatus } from "@/lib/licensing/request-dto";
import { REQUEST_STATUS_COPY as COPY } from "@/lib/licensing/request-status";
import { PosterThumb } from "./poster-thumb";

/**
 * /r's summary card on every state (05 §4.3): the poster, the title and @handle, then Scope and Total (labels proposed,
 * owner answer Q-126 a). It fills the reading column; long titles and handles wrap.
 */
export function RequestSummary({ request }: { request: BuyerStatus }) {
  return (
    <section
      aria-label={request.title}
      className="flex w-full flex-col gap-4 rounded-lg border border-hairline bg-surface p-5"
    >
      <div className="flex items-start gap-3">
        <PosterThumb src={request.posterUrl} />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-body font-semibold text-ink wrap-anywhere">
            {request.title}
          </p>
          <p className="text-callout text-ink-2 wrap-anywhere">
            @{request.handle}
          </p>
        </div>
      </div>
      <FactList
        facts={[
          { label: COPY.scope, value: request.scope },
          {
            label: COPY.total,
            value: formatMoney(request.amountTotalCents, request.currency),
          },
        ]}
      />
    </section>
  );
}
