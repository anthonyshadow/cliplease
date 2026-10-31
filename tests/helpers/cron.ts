// GET /api/cron/expire-requests for [int] tests (P19; P19b): its URL, Vercel Cron's call and a run's counts.
import { expect } from "vitest";
import { z } from "zod";
import { GET } from "../../src/app/api/cron/expire-requests/route";
import { env } from "../../src/server/env";

export const CRON_URL = `${env.APP_URL}/api/cron/expire-requests`;

/** Vercel Cron's call (02 §9.7): `Authorization: Bearer <CRON_SECRET>`, never printed. */
export const cron = () =>
  GET(
    new Request(CRON_URL, {
      headers: { authorization: `Bearer ${env.CRON_SECRET}` },
    }),
  );

/** A run's counts by step: every value a count. */
const COUNTS = z.record(z.string(), z.number().int().nonnegative());

/** A run's answer: 200, never cached, and its counts. */
export async function countsOf(
  response: Response,
): Promise<Record<string, number>> {
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return COUNTS.parse(await response.json());
}
