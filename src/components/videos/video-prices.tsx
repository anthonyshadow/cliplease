import type { VideoExclusiveColumns } from "@/lib/pricing/exclusive";
import type { EffectiveOptions, RateCardDTO } from "@/server/pricing/rate-card";
import { ExclusiveOfferEditor } from "./exclusive-offer-editor";
import { DraftPricePreview, PriceDraftProvider } from "./price-draft";
import { VideoPriceEditor } from "./video-price-editor";

/**
 * The editors and the read-only preview of Review's and the video page's Prices (04 §9.29, §9.39; owner answer Q-166): the
 * base price and the music Switches, the exclusive offer, then the preview at their unsaved drafts.
 */
export function VideoPrices({
  videoId,
  legend,
  containsMusic,
  publish,
  platformFeeBps,
}: {
  videoId: string;
  /** The base-price group's screen-reader name. */
  legend: string;
  containsMusic: boolean | null;
  publish: {
    options: EffectiveOptions;
    rateCard: RateCardDTO;
    videoExclusive: VideoExclusiveColumns;
  };
  platformFeeBps: number;
}) {
  return (
    <PriceDraftProvider>
      <div className="flex min-w-0 flex-col gap-4">
        <VideoPriceEditor
          videoId={videoId}
          legend={legend}
          options={publish.options}
          rateCard={publish.rateCard}
          containsMusic={containsMusic}
        />
        <ExclusiveOfferEditor
          videoId={videoId}
          options={publish.options}
          rateCard={publish.rateCard}
          videoExclusive={publish.videoExclusive}
        />
        <DraftPricePreview
          options={publish.options}
          platformFeeBps={platformFeeBps}
        />
      </div>
    </PriceDraftProvider>
  );
}
