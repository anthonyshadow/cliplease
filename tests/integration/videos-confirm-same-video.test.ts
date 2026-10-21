import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmSameVideo } from "../../src/app/(dashboard)/dashboard/videos/[id]/actions";
import { GENERIC_ERROR_MESSAGE } from "../../src/lib/result";
import { signInPath } from "../../src/lib/sign-in";
import {
  resolveStep,
  videoStepFacts,
  videoStepHref,
} from "../../src/lib/videos/steps";
import { getVideoForCreator } from "../../src/server/videos/queries";
import { formOf, NOT_FOUND, redirectTo } from "../helpers/actions";
import { mockNextHeaders, signedInCreator } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { insertUploadVideo, markOriginalReady } from "../helpers/factories";
import { confirmedAt, libraryDraft } from "../helpers/library-videos";

// The Library File step's Continue (P11 Task 6; 07 D39; owner answer Q-64 a): the confirmSameVideo action's Zod input,
// its session gate, its refusals and its redirect to Rights. The domain function's own cases are in ownership.test.ts.
vi.mock("next/headers", () => import("../helpers/next-headers"));

afterAll(resetDb);
beforeEach(() => mockNextHeaders(null));

const TICK_TO_CONTINUE = "Tick the box to continue.";

const ticked = (videoId: string) => formOf({ videoId, sameVideo: "on" });

describe("confirmSameVideo (the File step's action)", () => {
  it("sends a signed-out visitor to sign-in, back to the File step", async () => {
    const id = randomUUID();
    await expect(confirmSameVideo(null, ticked(id))).rejects.toMatchObject(
      redirectTo(signInPath(videoStepHref(id, "file"))),
    );
  });

  it("stores the tick and goes to Rights; Continue again keeps the first time and goes there again", async () => {
    const me = await signedInCreator();
    const draft = await libraryDraft(me);

    await expect(
      confirmSameVideo(null, ticked(draft.id)),
    ).rejects.toMatchObject(redirectTo(videoStepHref(draft.id, "rights")));
    const first = await confirmedAt(draft.id);
    expect(first).toBeInstanceOf(Date);

    await expect(
      confirmSameVideo(null, ticked(draft.id)),
    ).rejects.toMatchObject(redirectTo(videoStepHref(draft.id, "rights")));
    expect(await confirmedAt(draft.id)).toEqual(first);
  });

  it("opens ?step=rights only after the tick (resolveStep on the stored facts)", async () => {
    const me = await signedInCreator();
    const draft = await libraryDraft(me);
    const route = async () => {
      const dto = await getVideoForCreator(me.actor, draft.id);
      if (!dto) throw new Error("draft not found");
      return resolveStep(videoStepFacts(dto), "rights");
    };

    expect(await route()).toEqual({ kind: "redirect", step: "file" });
    await confirmSameVideo(null, ticked(draft.id)).catch(() => undefined);
    expect(await route()).toEqual({ kind: "render", step: "rights" });
  });

  it.each([
    ["no box", {}],
    ["an empty value", { sameVideo: "" }],
    ["a value other than on", { sameVideo: "true" }],
  ])(
    "answers %s with “Tick the box to continue.” on the box and stores nothing",
    async (_, fields: Record<string, string>) => {
      const me = await signedInCreator();
      const draft = await libraryDraft(me);

      expect(
        await confirmSameVideo(null, formOf({ videoId: draft.id, ...fields })),
      ).toEqual({
        ok: false,
        error: {
          code: "invalid_input",
          message: TICK_TO_CONTINUE,
          fields: { sameVideo: [TICK_TO_CONTINUE] },
        },
      });
      expect(await confirmedAt(draft.id)).toBeNull();
    },
  );

  it("answers a bad id, an unknown video and another creator's video with the 404", async () => {
    const owner = await signedInCreator();
    const draft = await libraryDraft(owner);
    await signedInCreator();

    for (const form of [
      formOf({ videoId: "not-a-uuid", sameVideo: "on" }),
      formOf({ videoId: "not-a-uuid" }),
      formOf({ sameVideo: "on" }),
      ticked(randomUUID()),
      ticked(draft.id),
    ]) {
      await expect(confirmSameVideo(null, form)).rejects.toMatchObject(
        NOT_FOUND,
      );
    }
    expect(await confirmedAt(draft.id)).toBeNull();
  });

  it("asks for the original again when it isn't ready", async () => {
    const me = await signedInCreator();
    const draft = await libraryDraft(me, { ready: false });

    expect(await confirmSameVideo(null, ticked(draft.id))).toEqual({
      ok: false,
      error: {
        code: "original_not_ready",
        message: "Choose the original file to continue.",
      },
    });
    expect(await confirmedAt(draft.id)).toBeNull();
  });

  it("refuses a plain upload with the generic error (its File step has no tick)", async () => {
    const me = await signedInCreator();
    const upload = await insertUploadVideo({ id: me.creatorId });
    await markOriginalReady(upload);

    expect(await confirmSameVideo(null, ticked(upload.id))).toEqual({
      ok: false,
      error: { code: "not_from_library", message: GENERIC_ERROR_MESSAGE },
    });
    expect(await confirmedAt(upload.id)).toBeNull();
  });
});
