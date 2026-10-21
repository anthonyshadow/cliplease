import { describe, expect, it } from "vitest";
import {
  NEW_VIDEO_PATH,
  resolveStep,
  sourcePageHref,
  VIDEO_STEP_LABELS,
  VIDEO_STEPS,
  type VideoStep,
  type VideoStepFacts,
  videoHref,
  videoStepFacts,
  videoStepHref,
} from "./steps";

const REQUESTS = [
  "file",
  "rights",
  "review",
  undefined,
  "",
  "postings",
  "nonsense",
  null,
];

const facts = (
  originalReady: boolean,
  sameVideoDone: boolean,
  rightsAnswered: boolean,
): VideoStepFacts => ({ originalReady, sameVideoDone, rightsAnswered });

// originalReady, sameVideoDone, rightsAnswered, the first incomplete step, the steps that render.
const FACTS: [boolean, boolean, boolean, VideoStep, VideoStep[]][] = [
  // The tick done (a plain upload needs none): the File step waits only for the original.
  [false, true, false, "file", ["file"]],
  [false, true, true, "file", ["file"]],
  [true, true, false, "rights", ["file", "rights"]],
  [true, true, true, "review", ["file", "rights", "review"]],
  // A Library video without the tick (P11): the File step stays incomplete, even with the original ready and the
  // rights answered.
  [false, false, false, "file", ["file"]],
  [false, false, true, "file", ["file"]],
  [true, false, false, "file", ["file"]],
  [true, false, true, "file", ["file"]],
];

describe("resolveStep (07 D39, D69)", () => {
  describe.each(FACTS)(
    "originalReady %s, sameVideoDone %s, rightsAnswered %s",
    (ready, sameVideoDone, rights, firstIncomplete, renders) => {
      it.each(REQUESTS)("?step=%j", (requested) => {
        const route = resolveStep(
          facts(ready, sameVideoDone, rights),
          requested,
        );
        const step = renders.find((s) => s === requested);
        expect(route).toEqual(
          step === undefined
            ? { kind: "redirect", step: firstIncomplete }
            : { kind: "render", step },
        );
      });
    },
  );

  it("sends a Library draft's ?step=rights back to ?step=file until the tick is given", () => {
    expect(resolveStep(facts(true, false, false), "rights")).toEqual({
      kind: "redirect",
      step: "file",
    });
    expect(resolveStep(facts(true, true, false), "rights")).toEqual({
      kind: "render",
      step: "rights",
    });
  });
});

describe("videoStepFacts", () => {
  it("reads a Library video's facts: the tick is needed", () => {
    const library = {
      originalStatus: "ready",
      source: "library",
      sameVideoConfirmed: false,
      rightsAnswered: false,
    } as const;
    expect(videoStepFacts(library)).toEqual(facts(true, false, false));
    expect(videoStepFacts({ ...library, sameVideoConfirmed: true })).toEqual(
      facts(true, true, false),
    );
  });

  it.each([false, true])(
    "reads a plain upload's facts: no tick needed (stored tick %s)",
    (sameVideoConfirmed) => {
      expect(
        videoStepFacts({
          originalStatus: "ready",
          source: "upload",
          sameVideoConfirmed,
          rightsAnswered: true,
        }),
      ).toEqual(facts(true, true, true));
    },
  );

  it.each(["none", "uploading", "failed"] as const)(
    "is not ready while the original is %s",
    (originalStatus) => {
      expect(
        videoStepFacts({
          originalStatus,
          source: "library",
          sameVideoConfirmed: true,
          rightsAnswered: false,
        }).originalReady,
      ).toBe(false);
    },
  );
});

describe("VIDEO_STEPS (04 §9.28)", () => {
  it("lists the steps and their Stepper labels in order", () => {
    expect(VIDEO_STEPS).toEqual(["file", "rights", "review"]);
    expect(VIDEO_STEP_LABELS).toEqual(["File", "Rights", "Review"]);
  });
});

describe("hrefs", () => {
  it("videoStepHref is the draft's step page", () => {
    expect(videoStepHref("abc", "rights")).toBe(
      "/dashboard/videos/abc?step=rights",
    );
  });

  it("videoHref is the video's page; sourcePageHref is the new-video page with ?post=", () => {
    expect(videoHref("abc")).toBe("/dashboard/videos/abc");
    expect(NEW_VIDEO_PATH).toBe("/dashboard/videos/new");
    expect(sourcePageHref("p1")).toBe("/dashboard/videos/new?post=p1");
  });
});
