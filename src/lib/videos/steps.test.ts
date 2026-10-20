import { describe, expect, it } from "vitest";
import {
  resolveStep,
  VIDEO_STEP_LABELS,
  VIDEO_STEPS,
  type VideoStep,
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

// originalReady, rightsAnswered, the first incomplete step, the steps that render.
const FACTS: [boolean, boolean, VideoStep, VideoStep[]][] = [
  [false, false, "file", ["file"]],
  [false, true, "file", ["file"]],
  [true, false, "rights", ["file", "rights"]],
  [true, true, "review", ["file", "rights", "review"]],
];

describe("resolveStep (07 D39, D69)", () => {
  describe.each(FACTS)(
    "originalReady %s, rightsAnswered %s",
    (originalReady, rightsAnswered, firstIncomplete, renders) => {
      it.each(REQUESTS)("?step=%j", (requested) => {
        const route = resolveStep({ originalReady, rightsAnswered }, requested);
        const step = renders.find((s) => s === requested);
        expect(route).toEqual(
          step === undefined
            ? { kind: "redirect", step: firstIncomplete }
            : { kind: "render", step },
        );
      });
    },
  );
});

describe("VIDEO_STEPS (04 §9.28)", () => {
  it("lists the steps and their Stepper labels in order", () => {
    expect(VIDEO_STEPS).toEqual(["file", "rights", "review"]);
    expect(VIDEO_STEP_LABELS).toEqual(["File", "Rights", "Review"]);
  });
});

describe("videoStepHref", () => {
  it("is the draft's step page", () => {
    expect(videoStepHref("abc", "rights")).toBe(
      "/dashboard/videos/abc?step=rights",
    );
  });
});
