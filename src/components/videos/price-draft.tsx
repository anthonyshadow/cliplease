"use client";

import { createContext, type ReactNode, useContext, useState } from "react";
import { PricePreview } from "@/components/pricing/price-preview";
import type { ExclusiveLine } from "@/lib/pricing/exclusive";
import type { EffectiveOptions } from "@/server/pricing/rate-card";

// The Prices section's unsaved base price and exclusive offer (04 §9.29, §9.39; 07 D82, D109), shared by the editors and
// the read-only preview under them: client state only, the server recomputes every quote.

type PriceDraft = {
  /** The editor's unsaved base, or null while the stored one stands. */
  baseCents: number | null;
  setBaseCents: (cents: number | null) => void;
  /** The exclusive editor's unsaved offer, or null while the stored one stands. */
  exclusive: ExclusiveLine | null;
  setExclusive: (exclusive: ExclusiveLine | null) => void;
};

const PriceDraftContext = createContext<PriceDraft>({
  baseCents: null,
  setBaseCents: () => {},
  exclusive: null,
  setExclusive: () => {},
});

export function PriceDraftProvider({ children }: { children: ReactNode }) {
  const [baseCents, setBaseCents] = useState<number | null>(null);
  const [exclusive, setExclusive] = useState<ExclusiveLine | null>(null);
  return (
    <PriceDraftContext.Provider
      value={{ baseCents, setBaseCents, exclusive, setExclusive }}
    >
      {children}
    </PriceDraftContext.Provider>
  );
}

/** The draft, or a no-op one outside a provider. */
export const usePriceDraft = () => useContext(PriceDraftContext);

/** The read-only PricePreview of the video's options, at the editors' unsaved base and exclusive offer while they have one. */
export function DraftPricePreview({
  options,
  platformFeeBps,
}: {
  options: EffectiveOptions;
  platformFeeBps: number;
}) {
  const { baseCents, exclusive } = usePriceDraft();
  return (
    <PricePreview
      options={{
        ...options,
        basePriceCents: baseCents ?? options.basePriceCents,
      }}
      platformFeeBps={platformFeeBps}
      exclusive={exclusive ?? options.exclusive}
      readOnly
    />
  );
}
