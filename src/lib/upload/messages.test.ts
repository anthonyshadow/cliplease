import { describe, expect, it } from "vitest";
import { ORIGINAL_MAX_BYTES } from "./limits";
import {
  attachedLine,
  COVER_COPY,
  checkOriginalFile,
  DROPZONE_COPY,
  INDICATOR_COPY,
  milestoneAnnouncement,
  progressLabel,
  splitFileName,
  storedFailureLine,
  tooLargeMessage,
  type UploadErrorCode,
  type UploadErrorLine,
  uploadErrorLine,
  uploadPercent,
} from "./messages";

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

const BAD_FILE =
  "We couldn't read this file as a video. Export it again as MP4 and retry.";
const BAD_TYPE = "Upload an MP4 or MOV video.";
const EXPIRED = "This upload expired. Start again.";

describe("tooLargeMessage (07 D80)", () => {
  it.each([
    [Math.round(2.4 * GIB), "This file is 2.4 GB. The limit is 2 GB."],
    [3 * GIB, "This file is 3 GB. The limit is 2 GB."],
    // Just over the limit never reads as the limit itself.
    [ORIGINAL_MAX_BYTES + 1, "This file is 2.1 GB. The limit is 2 GB."],
    [Math.round(2.04 * GIB), "This file is 2.1 GB. The limit is 2 GB."],
  ])("%i bytes → %s", (size, message) => {
    expect(tooLargeMessage(size)).toBe(message);
  });
});

describe("checkOriginalFile (07 D80)", () => {
  it.each([
    ["clip.mp4", "video/mp4", "video/mp4"],
    ["IMG_0001.MOV", "video/quicktime", "video/quicktime"],
    ["IMG_0001.MOV", "", "video/quicktime"],
    ["clip.MP4", "", "video/mp4"],
    ["notes.txt", "video/mp4", "video/mp4"],
  ])("%s (type %j) is a %s", (name, type, contentType) => {
    expect(checkOriginalFile({ name, type, size: 1024 })).toEqual({
      ok: true,
      contentType,
    });
  });

  it.each([
    ["notes.txt", ""],
    ["noext", ""],
    ["cover.png", "image/png"],
    ["clip.mp4", "image/png"],
    ["clip.webm", "video/webm"],
  ])("refuses %s (type %j) as the wrong type", (name, type) => {
    expect(checkOriginalFile({ name, type, size: 1024 })).toEqual({
      ok: false,
      message: BAD_TYPE,
    });
  });

  it("refuses an empty file as unreadable", () => {
    expect(
      checkOriginalFile({ name: "clip.mp4", type: "video/mp4", size: 0 }),
    ).toEqual({ ok: false, message: BAD_FILE });
  });

  it("allows exactly 2 GB and refuses one byte more", () => {
    const file = { name: "clip.mov", type: "video/quicktime" };
    expect(checkOriginalFile({ ...file, size: ORIGINAL_MAX_BYTES })).toEqual({
      ok: true,
      contentType: "video/quicktime",
    });
    expect(
      checkOriginalFile({ ...file, size: ORIGINAL_MAX_BYTES + 1 }),
    ).toEqual({
      ok: false,
      message: "This file is 2.1 GB. The limit is 2 GB.",
    });
  });

  it("checks the type before the size", () => {
    expect(
      checkOriginalFile({ name: "a.webm", type: "", size: 3 * GIB }),
    ).toEqual({ ok: false, message: BAD_TYPE });
  });
});

describe("uploadPercent", () => {
  it.each([
    [0, 1000, 0],
    [379, 1000, 37],
    [999, 1000, 99],
    [ORIGINAL_MAX_BYTES - 1, ORIGINAL_MAX_BYTES, 99],
    [1000, 1000, 100],
    [1200, 1000, 100],
    [0, 0, 0],
    [5, 0, 0],
  ])("%i of %i → %i", (sent, total, percent) => {
    expect(uploadPercent(sent, total)).toBe(percent);
  });
});

describe("progressLabel (04 §9.26)", () => {
  it.each([
    [312 * MIB, 840 * MIB, "37% · 312 of 840 MB"],
    [0, 840 * MIB, "0% · 0 of 840 MB"],
    [Math.round(1.2 * GIB), 2 * GIB, "60% · 1.2 of 2 GB"],
    [2 * GIB - 1, 2 * GIB, "99% · 2 of 2 GB"],
    [2 * GIB, 2 * GIB, "100% · 2 of 2 GB"],
    [900 * MIB, 840 * MIB, "100% · 840 of 840 MB"],
  ])("%i of %i → %s", (sent, total, label) => {
    expect(progressLabel(sent, total)).toBe(label);
  });
});

describe("milestoneAnnouncement", () => {
  it.each([
    [24, 25, "25% uploaded"],
    [49, 50, "50% uploaded"],
    [74, 75, "75% uploaded"],
    [20, 30, "25% uploaded"],
    [10, 80, "75% uploaded"],
    [0, 100, "75% uploaded"],
    [0, 24, null],
    [25, 49, null],
    [75, 100, null],
    [30, 30, null],
  ])("%i → %i: %j", (before, after, words) => {
    expect(milestoneAnnouncement(before, after)).toBe(words);
  });

  it("announces each milestone once over a whole upload", () => {
    const said: string[] = [];
    for (let percent = 1; percent <= 100; percent += 1) {
      const words = milestoneAnnouncement(percent - 1, percent);
      if (words) said.push(words);
    }
    expect(said).toEqual(["25% uploaded", "50% uploaded", "75% uploaded"]);
  });
});

describe("uploadErrorLine (04 §11.10)", () => {
  const size = Math.round(2.4 * GIB);
  const retry = { kind: "retry", label: "Try again" } as const;
  const generic = {
    message: "Something went wrong. Try again.",
    action: retry,
  };
  const offline = {
    message: "You're offline. Check your connection and try again.",
    action: retry,
  };

  // Every code, so a new one doesn't compile until it has a line here.
  const ONLINE: Record<UploadErrorCode, UploadErrorLine | null> = {
    canceled: null,
    size_mismatch: {
      message: BAD_FILE,
      action: { kind: "pick", label: "Try again" },
    },
    bad_signature_bytes: {
      message: BAD_FILE,
      action: { kind: "pick", label: "Try again" },
    },
    too_large: {
      message: "This file is 2.4 GB. The limit is 2 GB.",
      action: null,
    },
    bad_type: { message: BAD_TYPE, action: null },
    upload_expired: {
      message: EXPIRED,
      action: { kind: "retry", label: "Start again" },
    },
    unauthorized: {
      message: "You've been signed out. Sign in again to continue.",
      action: { kind: "sign_in", label: "Sign in" },
    },
    network: generic,
    invalid: generic,
    too_many: generic,
    bad_part: generic,
    not_found: generic,
    original_locked: generic,
    not_same_file: generic,
    parts_incomplete: generic,
    internal: generic,
  };
  const CODES = Object.keys(ONLINE) as UploadErrorCode[];

  it.each(CODES)("%s online", (code) => {
    expect(uploadErrorLine(code, { size, online: true })).toEqual(ONLINE[code]);
  });

  it.each(CODES)("%s offline", (code) => {
    expect(uploadErrorLine(code, { size, online: false })).toEqual(
      ONLINE[code] === generic ? offline : ONLINE[code],
    );
  });
});

describe("storedFailureLine", () => {
  it("offers a new pick for an expired upload", () => {
    expect(storedFailureLine("upload_expired")).toEqual({
      message: EXPIRED,
      action: { kind: "pick", label: "Start again" },
    });
  });

  it.each([null, "size_mismatch", "bad_signature_bytes", "internal"])(
    "%j → the unreadable-file line",
    (originalError) => {
      expect(storedFailureLine(originalError)).toEqual({
        message: BAD_FILE,
        action: { kind: "pick", label: "Try again" },
      });
    },
  );
});

describe("splitFileName (04 §9.26)", () => {
  it.each(["IMG_0001.MOV", "a.mp4", "", "sixteen_chars.mp"])(
    "keeps %j whole",
    (name) => {
      expect(splitFileName(name)).toEqual([name, ""]);
    },
  );

  it.each([
    ["summer_trip_final_cut.mp4", "summer_trip_final", "_cut.mp4"],
    ["seventeen_chars.m", "seventeen", "_chars.m"],
  ])("splits %j", (name, head, tail) => {
    expect(splitFileName(name)).toEqual([head, tail]);
  });

  it("always keeps the extension in the tail", () => {
    const name = `${"long name ".repeat(10)}take 3.mov`;
    const [head, tail] = splitFileName(name);
    expect(tail).toHaveLength(8);
    expect(tail.endsWith(".mov")).toBe(true);
    expect(head + tail).toBe(name);
    expect(splitFileName(name, 4)).toEqual([name.slice(0, -4), ".mov"]);
  });
});

describe("attachedLine", () => {
  it.each([
    [
      { duration: "0:14", width: 720, height: 1280 },
      "Original attached · 0:14 · 720 × 1280",
    ],
    [
      { duration: null, width: 720, height: 1280 },
      "Original attached · 720 × 1280",
    ],
    [
      { duration: "0:14", width: null, height: 1280 },
      "Original attached · 0:14",
    ],
    [
      { duration: "0:14", width: 720, height: null },
      "Original attached · 0:14",
    ],
    [{ duration: null, width: null, height: null }, "Original attached"],
  ])("%j → %s", (hints, line) => {
    expect(attachedLine(hints)).toBe(line);
  });
});

describe("File step copy (owner answers Q-40, Q-41, Q-42)", () => {
  it("keeps the dropzone strings", () => {
    expect(DROPZONE_COPY.interrupted).toBe(
      "Upload didn't finish. Choose the file again.",
    );
    expect(DROPZONE_COPY.keepOpen).toBe(
      "Keep this tab open until the upload finishes. You can use other pages meanwhile.",
    );
    expect(DROPZONE_COPY.attached).toBe("Original attached");
    expect(DROPZONE_COPY.checking).toBe("Checking the file…");
    expect(DROPZONE_COPY.continueHelper).toBe(
      "Choose the original file to continue.",
    );
  });

  it("keeps the cover strings", () => {
    expect(COVER_COPY).toEqual({
      label: "Cover image",
      change: "Use a different image",
      choose: "Choose an image",
      cantPreview:
        "We can't preview this format in your browser. Your file is fine. Add a cover image for buyers.",
      missing: "Add a cover image for buyers.",
      badType: "Choose a JPEG, PNG or WebP image.",
      tooLarge: "This image is too large. Choose a smaller one.",
    });
  });

  it("keeps the upload indicator strings", () => {
    expect(INDICATOR_COPY.uploading("First snow")).toBe("Uploading First snow");
    expect(INDICATOR_COPY.done).toBe("Upload complete");
    expect(INDICATOR_COPY.stopped).toBe("Upload didn't finish");
    expect(INDICATOR_COPY.open).toBe("Open");
    expect(INDICATOR_COPY.dismiss).toBe("Dismiss");
  });
});
