import { NO_STORE, notFoundNoStore } from "@/server/http";
import { releaseCheckoutHold } from "@/server/licensing/checkout-hold";
import { openFakeCheckout } from "@/server/payments/fake-checkout";

// The beacon the fake checkout sends when its page closes (owner answer Q-175): behind openFakeCheckout's guard, with no
// key, since this dev page never holds one (owner answer Q-118 a). From P25 the real page and route take the buyer's key.

export async function POST(
  _request: Request,
  ctx: RouteContext<"/dev/fake-checkout/[requestId]/release">,
) {
  const checkout = await openFakeCheckout((await ctx.params).requestId);
  if (!checkout) return notFoundNoStore();
  await releaseCheckoutHold(checkout.id, "page_closed");
  return new Response(null, { status: 204, headers: NO_STORE });
}
