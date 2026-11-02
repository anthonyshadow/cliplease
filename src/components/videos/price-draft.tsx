"use client";

import { createContext, type ReactNode, useContext, useState } from "react";
import { PricePreview } from "@/components/pricing/price-preview";
import type { EffectiveOptions } from "@/server/pricing/rate-card";

// The Prices section's unsaved base price (04 §9.29; 07 D82), shared by VideoPriceEditor and the read-only preview under
// it: client state only, the server recomputes every quote. P19e adds the exclusive draft here.

type PriceDraft = {
  /** The editor's unsaved base, or null while the stored one stands. */
  baseCents: number | null;
  setBaseCents: (cents: number | null) => void;
};

const PriceDraftContext = createContext<PriceDraft>({
  baseCents: null,
  setBaseCents: () => {},
});

export function PriceDraftProvider({ children }: { children: ReactNode }) {
  const [baseCents, setBaseCents] = useState<number | null>(null);
  return (
    <PriceDraftContext.Provider value={{ baseCents, setBaseCents }}>
      {children}
    </PriceDraftContext.Provider>
  );
}

/** The draft, or a no-op one outside a provider. */
export const usePriceDraft = () => useContext(PriceDraftContext);

/** The read-only PricePreview of the video's options, at the editor's unsaved base while there is one. */
export function DraftPricePreview({
  options,
  platformFeeBps,
}: {
  options: EffectiveOptions;
  platformFeeBps: number;
}) {
  const { baseCents } = usePriceDraft();
  return (
    <PricePreview
      options={{
        ...options,
        basePriceCents: baseCents ?? options.basePriceCents,
      }}
      platformFeeBps={platformFeeBps}
      readOnly
    />
  );
}
