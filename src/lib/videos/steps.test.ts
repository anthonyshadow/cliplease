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
  postingsDone: boolean,
  rightsAnswered: boolean,
): VideoStepFacts => ({ originalReady, postingsDone, rightsAnswered });

// originalReady, postingsDone, rightsAnswered, the first incomplete step, the steps that render.
const FACTS: [boolean, boolean, boolean, VideoStep, VideoStep[]][] = [
  // The original not ready: the File step, whatever the rest.
  [false, false, false, "file", ["file"]],
  [false, false, true, "file", ["file"]],
  [false, true, false, "file", ["file"]],
  [false, true, true, "file", ["file"]],
  // Ready, Where posted not done: Rights and Review wait for it, even with the rights answered.
  [true, false, false, "postings", ["file", "postings"]],
  [true, false, true, "postings", ["file", "postings"]],
  [true, true, false, "rights", ["file", "postings", "rights"]],
  [true, true, true, "review", ["file", "postings", "rights", "review"]],
];

describe("resolveStep (07 D69)", () => {
  describe.each(FACTS)(
    "originalReady %s, postingsDone %s, rightsAnswered %s",
    (ready, postingsDone, rights, firstIncomplete, renders) => {
      it.each(REQUESTS)("?step=%j", (requested) => {
        const route = resolveStep(
          facts(ready, postingsDone, rights),
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

  it("sends ?step=rights back to ?step=postings until Where posted is done", () => {
    expect(resolveStep(facts(true, false, false), "rights")).toEqual({
      kind: "redirect",
      step: "postings",
    });
    expect(resolveStep(facts(true, true, false), "rights")).toEqual({
      kind: "render",
      step: "rights",
    });
  });

  it("sends ?step=postings back to ?step=file until the original is ready", () => {
    expect(resolveStep(facts(false, true, true), "postings")).toEqual({
      kind: "redirect",
      step: "file",
    });
    expect(resolveStep(facts(true, false, false), "postings")).toEqual({
      kind: "render",
      step: "postings",
    });
  });

  it.each(["nonsense", "", "Postings", "file ", undefined, null])(
    "redirects an invalid ?step=%j to the first incomplete step",
    (requested) => {
      expect(resolveStep(facts(true, false, false), requested)).toEqual({
        kind: "redirect",
        step: "postings",
      });
      expect(resolveStep(facts(true, true, false), requested)).toEqual({
        kind: "redirect",
        step: "rights",
      });
    },
  );
});

describe("videoStepFacts (07 D66, D69)", () => {
  const UPLOAD = {
    originalStatus: "ready",
    postingsConfirmedAt: null,
    hasVerifiedPosting: false,
    sameVideoConfirmed: false,
    rightsAnswered: false,
  } as const;
  const CONFIRMED = "2026-10-21T12:00:00.000Z";

  it("an upload without postingsConfirmedAt stops at Where posted", () => {
    expect(videoStepFacts(UPLOAD)).toEqual(facts(true, false, false));
    expect(resolveStep(videoStepFacts(UPLOAD), "rights")).toEqual({
      kind: "redirect",
      step: "postings",
    });
  });

  it("confirmed with nothing verified (also “I haven't posted it anywhere yet.”) → Rights, no tick asked", () => {
    const video = { ...UPLOAD, postingsConfirmedAt: CONFIRMED };
    expect(videoStepFacts(video)).toEqual(facts(true, true, false));
    expect(resolveStep(videoStepFacts(video), undefined)).toEqual({
      kind: "redirect",
      step: "rights",
    });
  });

  it("confirmed with a verified posting needs the tick: without it → Where posted; with it → Rights", () => {
    const video = {
      ...UPLOAD,
      postingsConfirmedAt: CONFIRMED,
      hasVerifiedPosting: true,
    };
    expect(videoStepFacts(video)).toEqual(facts(true, false, false));
    expect(resolveStep(videoStepFacts(video), "rights")).toEqual({
      kind: "redirect",
      step: "postings",
    });
    const ticked = { ...video, sameVideoConfirmed: true };
    expect(videoStepFacts(ticked)).toEqual(facts(true, true, false));
    expect(resolveStep(videoStepFacts(ticked), "rights")).toEqual({
      kind: "render",
      step: "rights",
    });
  });

  it("a stored tick without postingsConfirmedAt doesn't complete Where posted", () => {
    expect(
      videoStepFacts({
        ...UPLOAD,
        hasVerifiedPosting: true,
        sameVideoConfirmed: true,
      }).postingsDone,
    ).toBe(false);
  });

  it.each(["none", "uploading", "failed"] as const)(
    "the original %s → the File step, whatever the rest",
    (originalStatus) => {
      const video = {
        originalStatus,
        postingsConfirmedAt: CONFIRMED,
        hasVerifiedPosting: true,
        sameVideoConfirmed: true,
        rightsAnswered: true,
      };
      expect(videoStepFacts(video)).toEqual(facts(false, true, true));
      expect(resolveStep(videoStepFacts(video), "review")).toEqual({
        kind: "redirect",
        step: "file",
      });
    },
  );

  it("passes the rights answer through", () => {
    expect(
      videoStepFacts({ ...UPLOAD, rightsAnswered: true }).rightsAnswered,
    ).toBe(true);
  });
});

describe("VIDEO_STEPS (04 §9.28, 07 D69)", () => {
  it("lists the four steps and their Stepper labels in order", () => {
    expect(VIDEO_STEPS).toEqual(["file", "postings", "rights", "review"]);
    expect(VIDEO_STEP_LABELS).toEqual([
      "File",
      "Where posted",
      "Rights",
      "Review",
    ]);
  });
});

describe("hrefs", () => {
  it("videoStepHref is the draft's step page", () => {
    expect(videoStepHref("abc", "rights")).toBe(
      "/dashboard/videos/abc?step=rights",
    );
    expect(videoStepHref("abc", "postings")).toBe(
      "/dashboard/videos/abc?step=postings",
    );
  });

  it("videoHref is the video's page; sourcePageHref is the new-video page with ?post=", () => {
    expect(videoHref("abc")).toBe("/dashboard/videos/abc");
    expect(NEW_VIDEO_PATH).toBe("/dashboard/videos/new");
    expect(sourcePageHref("p1")).toBe("/dashboard/videos/new?post=p1");
  });
});
