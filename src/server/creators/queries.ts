import "server-only";
import { eq, inArray } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db/client";
import { creatorProfile } from "@/db/schema";
import {
  type HandleProblem,
  handleProblem,
  normalizeHandleInput,
  suggestHandleCandidates,
} from "@/lib/validation/handle";

export type HandleAvailability = {
  handle: string;
  state: "available" | "taken" | "reserved" | "invalid";
  problem?: HandleProblem;
  suggestions: string[];
};

/** Whether `raw` (normalized first) can be claimed; when taken, up to 3 free alternatives (01 J1.5), from one query. */
export async function checkHandleAvailability(
  raw: string,
): Promise<HandleAvailability> {
  const handle = normalizeHandleInput(raw);
  const problem = handleProblem(handle);
  if (problem === "reserved") {
    return { handle, state: "reserved", problem, suggestions: [] };
  }
  if (problem !== null) {
    return { handle, state: "invalid", problem, suggestions: [] };
  }
  const candidates = suggestHandleCandidates(handle);
  const rows = await db
    .select({ handle: creatorProfile.handle })
    .from(creatorProfile)
    .where(inArray(creatorProfile.handle, [handle, ...candidates]));
  const taken = new Set(rows.map((r) => r.handle));
  if (!taken.has(handle))
    return { handle, state: "available", suggestions: [] };
  return {
    handle,
    state: "taken",
    suggestions: candidates.filter((c) => !taken.has(c)).slice(0, 3),
  };
}

/** The public face of a creator (/@handle): public fields only. Once per request (the page and its metadata). */
export const getPublicCreator = cache(
  async (
    handle: string,
  ): Promise<{ handle: string; displayName: string } | null> => {
    const [row] = await db
      .select({
        handle: creatorProfile.handle,
        displayName: creatorProfile.displayName,
      })
      .from(creatorProfile)
      .where(eq(creatorProfile.handle, handle))
      .limit(1);
    return row ?? null;
  },
);
