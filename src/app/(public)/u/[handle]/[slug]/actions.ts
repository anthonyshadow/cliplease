"use server";

import { redirect } from "next/navigation";
import { StartCheckoutSchema } from "@/lib/validation/checkout";
import { createLicenseRequest } from "@/server/licensing/requests";
import {
  type StartCheckoutRefusal,
  startCheckoutFieldErrors,
  startCheckoutFields,
  startCheckoutRefusal,
} from "@/server/licensing/start-checkout-form";
import { requestContext } from "@/server/request-context";
import { rethrowRedacted } from "@/server/rethrow-redacted";

/**
 * The license page's Request license (02 §6.1; 07 D31): the server prices and saves the request, then the buyer goes to
 * Checkout (a client navigation; a 303 only for a form posted without JS). Otherwise the reason, for the page's banner.
 */
export async function startCheckout(
  formData: FormData,
): Promise<StartCheckoutRefusal> {
  const parsed = StartCheckoutSchema.safeParse(startCheckoutFields(formData));
  if (!parsed.success) return startCheckoutFieldErrors(parsed.error);
  // The insert's bound values are the buyer's details: never let Next log them.
  const result = await createLicenseRequest(
    parsed.data,
    await requestContext(),
  ).catch((error: unknown) =>
    rethrowRedacted(error, "license_request.start_failed"),
  );
  if (result.ok) redirect(result.checkoutUrl);
  return startCheckoutRefusal(result);
}
