// Payout setup [int] helpers (P05, P13): "Set up payouts" as a browser requests it.

export const ONBOARDING_URL = "http://localhost:3000/api/stripe/onboarding";

/** A GET of the setup route from `fetchSite` (its Sec-Fetch-Site header), coming back to `returnTo` when given. */
export function onboardingRequest(
  fetchSite: string,
  returnTo?: string,
): Request {
  const url = new URL(ONBOARDING_URL);
  if (returnTo !== undefined) url.searchParams.set("returnTo", returnTo);
  return new Request(url, { headers: { "sec-fetch-site": fetchSite } });
}
