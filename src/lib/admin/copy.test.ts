import { describe, expect, it } from "vitest";
import { ADMIN_COPY, DISABLE_COPY, ENABLE_COPY } from "./copy";

const RELEASE =
  "Its verified posts are released, so the rightful owner can make them licensable.";

describe("DISABLE_COPY (05 §7 callout 6; owner answers Q-198 a, Q-199 a, Q-201–Q-203)", () => {
  it("words the body by the waiting requests it declines", () => {
    expect(DISABLE_COPY.body(0)).toBe(
      `The license page goes dark. Licenses already sold don't change. ${RELEASE}`,
    );
    expect(DISABLE_COPY.body(1)).toBe(
      `The license page goes dark and 1 waiting request is declined. The buyer isn't charged. Licenses already sold don't change. ${RELEASE}`,
    );
    expect(DISABLE_COPY.body(2)).toBe(
      `The license page goes dark and 2 waiting requests are declined. The buyers aren't charged. Licenses already sold don't change. ${RELEASE}`,
    );
  });

  it("warns about the requests the sweep left open", () => {
    expect(DISABLE_COPY.stillOpen(1)).toBe("1 waiting request is still open.");
    expect(DISABLE_COPY.stillOpen(3)).toBe(
      "3 waiting requests are still open.",
    );
  });

  it("words the still-open body for one request and for several (owner answers Q-201, Q-203)", () => {
    expect(DISABLE_COPY.stillOpenBody(1)).toBe(
      "The video is disabled and its posts are released. Try again to decline the request. If you close this, the request can't be charged and its hold is released at its deadline.",
    );
    for (const n of [2, 5]) {
      expect(DISABLE_COPY.stillOpenBody(n)).toBe(
        "The video is disabled and its posts are released. Try again to decline them. If you close this, they can't be charged and their holds are released at their deadlines.",
      );
    }
  });

  it("words the payments already going through apart (owner answer Q-202)", () => {
    expect(DISABLE_COPY.capturing(1)).toBe(
      "1 payment was already going through when the video was disabled, so its license may still be issued.",
    );
    expect(DISABLE_COPY.capturing(2)).toBe(
      "2 payments were already going through when the video was disabled, so their licenses may still be issued.",
    );
  });

  it("names the sheet and the row action by the video's title", () => {
    expect(DISABLE_COPY.title("First snow")).toBe("Disable First snow?");
    expect(DISABLE_COPY.actionLabel("First snow")).toBe("Disable First snow");
  });
});

describe("ENABLE_COPY (design §6.9)", () => {
  it("names the sheet by the video's title", () => {
    expect(ENABLE_COPY.title("Rooftop storm timelapse")).toBe(
      "Enable Rooftop storm timelapse?",
    );
    expect(ENABLE_COPY.actionLabel("Rooftop")).toBe("Enable Rooftop");
  });
});

describe("ADMIN_COPY (05 §7; design §6.4)", () => {
  it("words the Videos cells", () => {
    expect(ADMIN_COPY.postings(3, 2)).toBe("3 · 2 verified");
    expect(ADMIN_COPY.verifiedOn("Demo")).toBe("Verified · Demo");
    expect(ADMIN_COPY.note("ticket-4821")).toBe("Note: ticket-4821");
  });
});
