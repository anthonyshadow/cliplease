import { describe, expect, it } from "vitest";
import type { VideoStatus } from "@/lib/domain/values";
import type { VideoStepFacts } from "@/lib/videos/steps";
import { videoView } from "./video-view";

const READY: VideoStepFacts = {
  originalReady: true,
  postingsDone: false,
  rightsAnswered: false,
};
const DONE: VideoStepFacts = { ...READY, postingsDone: true };
const view = (
  status: VideoStatus,
  facts: VideoStepFacts,
  step: string | undefined,
) => videoView({ status, facts }, step);

describe("videoView", () => {
  it("a draft: Where posted once the file is ready, editable; before that back to File", () => {
    expect(view("draft", READY, "postings")).toEqual({
      kind: "postings",
      mode: "edit",
    });
    expect(
      view("draft", { ...READY, originalReady: false }, "postings"),
    ).toEqual({
      kind: "redirect",
      step: "file",
    });
    expect(view("draft", READY, "file")).toEqual({ kind: "file" });
  });

  it("a draft: Rights before Where posted is complete goes back to it; after, Rights and Review are placeholders", () => {
    expect(view("draft", READY, "rights")).toEqual({
      kind: "redirect",
      step: "postings",
    });
    expect(view("draft", READY, undefined)).toEqual({
      kind: "redirect",
      step: "postings",
    });
    expect(view("draft", DONE, "rights")).toEqual({
      kind: "step_placeholder",
      step: "rights",
    });
  });

  it("past the draft: ?step=postings is editable while unpublished and read-only once published", () => {
    expect(view("unpublished", DONE, "postings")).toEqual({
      kind: "postings",
      mode: "edit",
    });
    expect(view("published", DONE, "postings")).toEqual({
      kind: "postings",
      mode: "read_only",
    });
  });

  it("past the draft: any other request, and a disabled video, keep the placeholder", () => {
    expect(view("published", DONE, undefined)).toEqual({
      kind: "video_placeholder",
    });
    expect(view("unpublished", DONE, "rights")).toEqual({
      kind: "video_placeholder",
    });
    expect(view("disabled", DONE, "postings")).toEqual({
      kind: "video_placeholder",
    });
  });
});
