// Make licensable videos with every step done, for the Review and publish [int] tests (P13, P14a), built by the
// factories (no upload, sync or live check).
import type { NewVideo } from "../../src/db/schema/types";
import { bareCreator } from "./auth";
import {
  completeSteps,
  insertRateCard,
  insertUploadVideo,
  publishVideo,
} from "./factories";
import { libraryDraft } from "./library-videos";

/** A creator with onboarding's rate card (with `off` options switched off) and its actor. */
export async function pricedCreator(
  off: Parameters<typeof insertRateCard>[1] = [],
) {
  const owner = await bareCreator();
  await insertRateCard(owner.creator, off);
  return owner;
}

/** An upload with every step done ("I haven't posted it anywhere yet." saved), plus `extra`. */
export const readyUpload = async (
  creatorId: string,
  extra: Partial<NewVideo> = {},
) => completeSteps(await insertUploadVideo({ id: creatorId }), extra);

/** pricedCreator (`off` switched off) and their published upload (no postings), `extra` on top; no payment runs. */
export async function pricedLiveVideo(
  off: Parameters<typeof insertRateCard>[1] = [],
  extra: Partial<NewVideo> = {},
) {
  const owner = await pricedCreator(off);
  const live = await publishVideo(await readyUpload(owner.creator.id), extra);
  return { ...owner, live };
}

/** A Library draft with every step done and its tick saved, on its Demo account in `accountStatus`. */
export const readyLibraryVideo = async (
  creatorId: string,
  accountStatus: "connected" | "needs_reconnect" = "connected",
) =>
  completeSteps(
    await libraryDraft({ creatorId }, { account: { status: accountStatus } }),
    { sameVideoConfirmedAt: new Date() },
  );
