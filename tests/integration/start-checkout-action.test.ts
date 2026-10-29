import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startCheckout } from "../../src/app/(public)/u/[handle]/[slug]/actions";
import { db } from "../../src/db/client";
import { licenseRequest } from "../../src/db/schema";
import { formOf } from "../helpers/actions";
import { mockNextHeaders } from "../helpers/auth";
import { DEMO_REQUEST } from "../helpers/checkout-fixtures";
import { publishVideo } from "../helpers/factories";
import { captureLogEvents } from "../helpers/logs";
import { pgError, wrapped } from "../helpers/pg-errors";
import { pricedCreator, readyUpload } from "../helpers/ready-videos";

// The license page's startCheckout action around a database failure (02 §9.9, 07 D47): Next logs an action's uncaught
// error with its message, and a failed insert's message holds the buyer's details, so the action logs the failure
// without them and throws a plain error instead. The domain half is tests/integration/start-checkout.test.ts's.
vi.mock("next/headers", () => import("../helpers/next-headers"));

beforeEach(() => mockNextHeaders(null));
afterEach(() => {
  vi.restoreAllMocks();
});

/** The demo request for `videoId`, as the license page's form posts it. */
const demoForm = (videoId: string): FormData =>
  formOf({
    ...DEMO_REQUEST,
    videoId,
    territoryCode: "",
    acceptTerms: "on",
    submissionId: randomUUID(),
    expectedTotalCents: String(DEMO_REQUEST.expectedTotalCents),
  });

async function liveVideoId(): Promise<string> {
  const { creator } = await pricedCreator([]);
  return (await publishVideo(await readyUpload(creator.id))).id;
}

describe("startCheckout: a database failure (02 §9.9, 07 D47)", () => {
  it("goes to Checkout when nothing fails", async () => {
    const videoId = await liveVideoId();
    await expect(startCheckout(demoForm(videoId))).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*\/dev\/fake-checkout\//),
    });
  });

  it("logs the failure without the buyer's details and throws an error that carries none of them", async () => {
    const videoId = await liveVideoId();
    const failed = wrapped(
      pgError("57P01"),
      "insert into license_request (buyer_email, licensee_name) values ($1, $2)",
      [DEMO_REQUEST.buyerEmail, DEMO_REQUEST.licenseeName],
    );
    vi.spyOn(db, "transaction").mockRejectedValueOnce(failed);
    const logs = captureLogEvents("license_request.start_failed");
    const error = await startCheckout(demoForm(videoId)).catch(
      (e: unknown) => e,
    );
    const { written, events } = logs();
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBe(failed);
    expect(String(error)).not.toContain(DEMO_REQUEST.buyerEmail);
    expect((error as Error).cause).toBeUndefined();
    expect(events).toEqual([
      expect.objectContaining({
        level: "error",
        error: expect.objectContaining({ name: "QueryError", pgCode: "57P01" }),
      }),
    ]);
    expect(written).not.toContain(DEMO_REQUEST.buyerEmail);
    expect(written).not.toContain(DEMO_REQUEST.licenseeName);
    expect(
      await db
        .select()
        .from(licenseRequest)
        .where(eq(licenseRequest.videoId, videoId)),
    ).toEqual([]);
  });
});
