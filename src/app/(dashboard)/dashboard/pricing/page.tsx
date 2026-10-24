import type { Metadata } from "next";
import { requireCreator } from "@/server/auth/session";
import { env } from "@/server/env";
import { getRateCard } from "@/server/pricing/rate-card";
import { RateCardEditor } from "./rate-card-editor";

export const metadata: Metadata = { title: "Pricing" };

/**
 * S21 (05 §6.9, J4): the creator's rate card in their payout_currency. PLATFORM_FEE_BPS is read here and passed down,
 * so the preview's fee is the server's; the fee floor comes from presets in the browser (07 D79, D97).
 */
export default async function PricingPage() {
  const { creator } = await requireCreator("/dashboard/pricing");
  const card = await getRateCard(creator.id);
  return <RateCardEditor card={card} platformFeeBps={env.PLATFORM_FEE_BPS} />;
}
