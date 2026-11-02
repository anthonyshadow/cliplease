// @vitest-environment jsdom
import "../../../tests/helpers/postings-fixtures";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setVideoBasePrice,
  setVideoUseEnabled,
} from "@/app/(dashboard)/dashboard/videos/[id]/actions";
import { RIGHTS_COPY, RIGHTS_LOCK_COPY } from "@/lib/videos/rights";
import { VIDEO_PRICE_COPY } from "@/lib/videos/video-price";
import { RightsForm } from "./rights-form";

vi.mock("@/app/(dashboard)/dashboard/videos/[id]/review-actions", () => ({
  attestRights: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const VIDEO_ID = "00000000-0000-4000-8000-000000000002";
const UNANSWERED = {
  videoId: VIDEO_ID,
  containsMusic: null,
  identifiablePeople: null,
  lock: null,
  musicUses: [
    { key: "paid_social", on: false },
    { key: "broadcast", on: false },
  ],
} as const;

const continueButton = () => screen.getByRole("button", { name: "Continue" });
const radio = (question: string, answer: "Yes" | "No") =>
  screen
    .getByRole("group", { name: new RegExp(`^${question}`) })
    .querySelector<HTMLInputElement>(
      `input[value="${answer.toLowerCase()}"]`,
    ) as HTMLInputElement;

const PAID = VIDEO_PRICE_COPY.allowAnyway("paid_social");
const TV = VIDEO_PRICE_COPY.allowAnyway("broadcast");
const switchOf = (name: string) => screen.getByRole("switch", { name });
/** What Continue would post for the music Switches. */
const posted = () => {
  const form = new FormData(
    continueButton().closest("form") as HTMLFormElement,
  );
  return [form.get("allowPaidSocial"), form.get("allowBroadcast")];
};

describe("RightsForm (01 J5.13–J5.15; owner answers Q-96, Q-97, Q-99)", () => {
  it("keeps Continue off until both boxes are ticked and both questions answered", () => {
    render(<RightsForm {...UNANSWERED} />);
    // No default: every box and every answer starts empty.
    for (const input of screen.getAllByRole<HTMLInputElement>("radio")) {
      expect(input.checked).toBe(false);
    }
    for (const input of screen.getAllByRole<HTMLInputElement>("checkbox")) {
      expect(input.checked).toBe(false);
    }
    expect(continueButton().hasAttribute("disabled")).toBe(true);
    expect(continueButton().getAttribute("aria-describedby")).toBe(
      "rights-helper",
    );
    expect(screen.getByText(RIGHTS_COPY.answerAll)).toBeTruthy();

    fireEvent.click(screen.getByLabelText(RIGHTS_COPY.ownsRights));
    fireEvent.click(screen.getByLabelText(RIGHTS_COPY.notReupload));
    fireEvent.click(radio(RIGHTS_COPY.musicQuestion, "No"));
    expect(continueButton().hasAttribute("disabled")).toBe(true);
    fireEvent.click(radio(RIGHTS_COPY.peopleQuestion, "No"));
    expect(continueButton().hasAttribute("disabled")).toBe(false);
    expect(screen.queryByText(RIGHTS_COPY.answerAll)).toBeNull();
  });

  it("shows the music footnote and the people Notice only for Yes", () => {
    render(<RightsForm {...UNANSWERED} />);
    expect(screen.queryByText(RIGHTS_COPY.musicFootnote)).toBeNull();
    fireEvent.click(radio(RIGHTS_COPY.musicQuestion, "Yes"));
    expect(screen.getByText(RIGHTS_COPY.musicFootnote)).toBeTruthy();
    fireEvent.click(radio(RIGHTS_COPY.musicQuestion, "No"));
    expect(screen.queryByText(RIGHTS_COPY.musicFootnote)).toBeNull();

    expect(screen.queryByText(RIGHTS_COPY.peopleNotice)).toBeNull();
    fireEvent.click(radio(RIGHTS_COPY.peopleQuestion, "Yes"));
    expect(screen.getByText(RIGHTS_COPY.peopleNotice)).toBeTruthy();
  });

  it("prefills the saved answers and leaves both boxes unticked", () => {
    render(
      <RightsForm
        {...UNANSWERED}
        containsMusic={true}
        identifiablePeople={false}
      />,
    );
    expect(radio(RIGHTS_COPY.musicQuestion, "Yes").checked).toBe(true);
    expect(radio(RIGHTS_COPY.peopleQuestion, "No").checked).toBe(true);
    expect(
      (screen.getByLabelText(RIGHTS_COPY.ownsRights) as HTMLInputElement)
        .checked,
    ).toBe(false);
    expect(
      (screen.getByLabelText(RIGHTS_COPY.notReupload) as HTMLInputElement)
        .checked,
    ).toBe(false);
  });

  it.each(["license", "request"] as const)(
    "shows a %s lock read-only, with its line and no Continue",
    (lock) => {
      render(
        <RightsForm
          {...UNANSWERED}
          containsMusic={false}
          identifiablePeople={false}
          lock={lock}
        />,
      );
      expect(screen.getByText(RIGHTS_LOCK_COPY[lock])).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
      for (const input of screen.getAllByRole("checkbox")) {
        expect(input.hasAttribute("disabled")).toBe(true);
      }
      // Through the fieldset, as a browser does.
      expect(radio(RIGHTS_COPY.musicQuestion, "No").matches(":disabled")).toBe(
        true,
      );
    },
  );

  describe("the music Switches (07 D82; owner answer Q-158)", () => {
    it("shows both off with the footnote and the helper for music Yes, and posts each as it is", () => {
      render(<RightsForm {...UNANSWERED} />);
      fireEvent.click(radio(RIGHTS_COPY.musicQuestion, "Yes"));
      expect(
        [PAID, TV].map((name) => switchOf(name).getAttribute("aria-checked")),
      ).toEqual(["false", "false"]);
      expect(screen.getByText(RIGHTS_COPY.musicFootnote)).toBeTruthy();
      expect(screen.getAllByText(VIDEO_PRICE_COPY.musicHelper)).toHaveLength(1);
      expect(posted()).toEqual(["off", "off"]);

      fireEvent.click(switchOf(PAID));
      expect(switchOf(PAID).getAttribute("aria-checked")).toBe("true");
      expect(posted()).toEqual(["on", "off"]);
      expect(screen.queryByText(RIGHTS_COPY.musicFootnote)).toBeNull();
      // Saved with Continue only.
      expect(setVideoUseEnabled).not.toHaveBeenCalled();
      expect(setVideoBasePrice).not.toHaveBeenCalled();
    });

    it("shows no Switch and posts no field for music No", () => {
      render(<RightsForm {...UNANSWERED} />);
      fireEvent.click(radio(RIGHTS_COPY.musicQuestion, "No"));
      expect(screen.queryByRole("switch")).toBeNull();
      expect(posted()).toEqual([null, null]);
    });

    it("prefills a stored Yes's Switches, with no footnote while one is on", () => {
      render(
        <RightsForm
          {...UNANSWERED}
          containsMusic={true}
          musicUses={[
            { key: "paid_social", on: true },
            { key: "broadcast", on: false },
          ]}
        />,
      );
      expect(switchOf(PAID).getAttribute("aria-checked")).toBe("true");
      expect(switchOf(TV).getAttribute("aria-checked")).toBe("false");
      expect(screen.queryByText(RIGHTS_COPY.musicFootnote)).toBeNull();
    });

    it("starts both off when a stored No becomes Yes", () => {
      render(<RightsForm {...UNANSWERED} containsMusic={false} />);
      expect(screen.queryByRole("switch")).toBeNull();
      fireEvent.click(radio(RIGHTS_COPY.musicQuestion, "Yes"));
      expect(
        screen
          .getAllByRole("switch")
          .map((s) => s.getAttribute("aria-checked")),
      ).toEqual(["false", "false"]);
    });

    it("leaves out a use off on the rate card", () => {
      render(
        <RightsForm
          {...UNANSWERED}
          containsMusic={true}
          musicUses={[{ key: "paid_social", on: false }]}
        />,
      );
      expect(screen.getAllByRole("switch")).toHaveLength(1);
      expect(screen.queryByRole("switch", { name: TV })).toBeNull();
    });

    it("shows none while the answers are locked", () => {
      render(
        <RightsForm
          {...UNANSWERED}
          containsMusic={true}
          identifiablePeople={false}
          lock="request"
        />,
      );
      expect(screen.queryByRole("switch")).toBeNull();
    });
  });
});
