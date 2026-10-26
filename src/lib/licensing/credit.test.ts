import { describe, expect, it } from "vitest";
import { creditLine } from "./credit";

const LINKED = "2026-10-01T09:00:00.000Z";

describe("creditLine (01 §4.4; 07 D43, D71)", () => {
  it("names the primary verified posting's account as stored, never adding @", () => {
    expect(
      creditLine({
        handle: "maya",
        primary: {
          label: "Instagram",
          verifiedUsername: "@maya.films",
          linkedAt: LINKED,
        },
      }),
    ).toBe("Video: @maya.films on Instagram");
    expect(
      creditLine({
        handle: "maya",
        primary: {
          label: "YouTube",
          verifiedUsername: "Maya Films",
          linkedAt: LINKED,
        },
      }),
    ).toBe("Video: Maya Films on YouTube");
    expect(
      creditLine({
        handle: "maya",
        primary: {
          label: "Demo",
          verifiedUsername: "@demo.creator",
          linkedAt: LINKED,
        },
      }),
    ).toBe("Video: @demo.creator on Demo");
  });

  it("credits the creator's handle on a self-attested video", () => {
    expect(creditLine({ handle: "maya", primary: null })).toBe("Video: @maya");
  });
});
