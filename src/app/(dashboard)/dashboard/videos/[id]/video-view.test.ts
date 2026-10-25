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

  it("a draft: Rights before Where posted is complete goes back to it; Review before Rights is answered goes to Rights", () => {
    expect(view("draft", READY, "rights")).toEqual({
      kind: "redirect",
      step: "postings",
    });
    expect(view("draft", READY, undefined)).toEqual({
      kind: "redirect",
      step: "postings",
    });
    expect(view("draft", DONE, "rights")).toEqual({ kind: "rights" });
    expect(view("draft", DONE, "review")).toEqual({
      kind: "redirect",
      step: "rights",
    });
    expect(view("draft", { ...DONE, rightsAnswered: true }, "review")).toEqual({
      kind: "review",
    });
    expect(view("draft", { ...DONE, rightsAnswered: true }, "rights")).toEqual({
      kind: "rights",
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

  it("past the draft: a published video's Review is the success view", () => {
    expect(view("published", DONE, "review")).toEqual({ kind: "published" });
    expect(view("unpublished", DONE, "review")).toEqual({ kind: "video" });
    expect(view("disabled", DONE, "review")).toEqual({ kind: "video" });
  });

  it("past the draft: any other request, and a disabled video, show the video's header", () => {
    expect(view("published", DONE, undefined)).toEqual({
      kind: "video",
    });
    expect(view("unpublished", DONE, "rights")).toEqual({
      kind: "video",
    });
    expect(view("disabled", DONE, "postings")).toEqual({
      kind: "video",
    });
  });
});
