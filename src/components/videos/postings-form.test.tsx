// @vitest-environment jsdom
// First: its mocks must be in place before the form loads.
import "../../../tests/helpers/postings-fixtures";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveVideoPostings } from "@/app/(dashboard)/dashboard/videos/[id]/actions";
import { postingsFromFormData } from "@/lib/postings/form";
import { POSTINGS_MAX } from "@/lib/postings/limits";
import {
  ACCOUNT_ID,
  DEMO_01,
  SOURCE_POSTING,
  savedPosting,
  VIDEO,
  VIDEO_ID,
} from "../../../tests/helpers/postings-fixtures";
import { postingAccounts } from "./posting-picker-state";
import { PostingsForm } from "./postings-form";

const save = vi.mocked(saveVideoPostings);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ACCOUNTS = postingAccounts(
  ["mock"],
  [{ id: ACCOUNT_ID, platform: "mock", status: "connected" }],
);
const REEL = "https://www.instagram.com/reel/C0dEaBcDeF1/";
const SHORT = "https://vm.tiktok.com/ZMabc123/";

function renderForm(props: Partial<ComponentProps<typeof PostingsForm>> = {}) {
  return render(
    <PostingsForm
      video={VIDEO}
      postings={[]}
      notPostedSaved={false}
      allowMock
      accounts={ACCOUNTS}
      connected={null}
      {...props}
    />,
  );
}

const chipRow = () =>
  screen.getByRole("group", { name: "Where was it posted?" });
const chip = (name: string) => within(chipRow()).getByRole("button", { name });
const card = (platform: string) =>
  document.querySelector<HTMLElement>(`[data-posting-card="${platform}"]`);
const linkIn = (platform: string, n = 0) => {
  const el = card(platform);
  if (!el) throw new Error(`no ${platform} card`);
  return within(el).getAllByLabelText(/Link to the post/)[
    n
  ] as HTMLInputElement;
};
const form = () => {
  const el = document.querySelector("form");
  if (!el) throw new Error("no form");
  return el;
};
const continueButton = () => screen.getByRole("button", { name: "Continue" });

/** The FormData the form posts right now. */
const posted = () => new FormData(form());

/** Presses Continue and waits for the action's call; returns the FormData it got. */
async function submit(): Promise<FormData> {
  save.mockResolvedValueOnce({ ok: true, data: { sameVideoMissing: false } });
  fireEvent.click(continueButton());
  await waitFor(() => expect(save).toHaveBeenCalled());
  const call = save.mock.calls.at(-1);
  if (!call) throw new Error("not posted");
  return call[1];
}

/** Lets the focus requests (after a paint) run. */
const nextFrame = () =>
  act(() => new Promise((resolve) => requestAnimationFrame(resolve)));

describe("PostingsForm: chips and cards", () => {
  it("names the chip row by the header and lists the platforms in order, Demo last only while mock is enabled", () => {
    renderForm();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "Where was it posted?",
    );
    expect(
      within(chipRow())
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual([
      "Instagram",
      "TikTok",
      "YouTube",
      "Facebook",
      "X",
      "Snapchat",
      "Other",
      "Demo",
    ]);
    cleanup();
    renderForm({ allowMock: false });
    expect(
      within(chipRow()).queryByRole("button", { name: "Demo" }),
    ).toBeNull();
  });

  it("a chip on adds its card in chip order with the platform's placeholder; off removes it and what was typed", () => {
    renderForm();
    fireEvent.click(chip("Other"));
    fireEvent.click(chip("Instagram"));
    expect(chip("Instagram").getAttribute("aria-pressed")).toBe("true");
    const cards = [...document.querySelectorAll("[data-posting-card]")].map(
      (el) => el.getAttribute("data-posting-card"),
    );
    expect(cards).toEqual(["instagram", "other"]);
    expect(linkIn("instagram").placeholder).toBe("instagram.com/reel/…");
    expect(linkIn("other").placeholder).toBe("");
    expect(
      within(card("other") as HTMLElement).getByLabelText(
        "Where? (for example, Vimeo)",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Optional. Without a link, buyers see “Also posted on Instagram”.",
      ),
    ).toBeTruthy();
    fireEvent.change(linkIn("instagram"), { target: { value: REEL } });
    fireEvent.click(chip("Instagram"));
    expect(card("instagram")).toBeNull();
    fireEvent.click(chip("Instagram"));
    expect(linkIn("instagram").value).toBe("");
  });

  it("the link field takes a URL without autocorrect and has no maxLength (a too-long paste reads its error)", () => {
    renderForm();
    fireEvent.click(chip("TikTok"));
    const link = linkIn("tiktok");
    expect(link.type).toBe("url");
    expect(link.inputMode).toBe("url");
    expect(link.getAttribute("autocomplete")).toBe("off");
    expect(link.getAttribute("spellcheck")).toBe("false");
    expect(link.hasAttribute("maxlength")).toBe(false);
  });

  it("Add another link adds a field with Remove, focused; the first field has none", async () => {
    renderForm();
    fireEvent.click(chip("Facebook"));
    const facebook = card("facebook") as HTMLElement;
    expect(
      within(facebook).queryByRole("button", { name: "Remove" }),
    ).toBeNull();
    fireEvent.click(
      within(facebook).getByRole("button", { name: "Add another link" }),
    );
    expect(within(facebook).getAllByLabelText(/Link to the post/)).toHaveLength(
      2,
    );
    await nextFrame();
    expect(document.activeElement).toBe(linkIn("facebook", 1));
    fireEvent.click(within(facebook).getByRole("button", { name: "Remove" }));
    expect(within(facebook).getAllByLabelText(/Link to the post/)).toHaveLength(
      1,
    );
  });

  it("Other's Add another link adds a name and link pair (owner answer Q-79 a)", () => {
    renderForm();
    fireEvent.click(chip("Other"));
    const other = card("other") as HTMLElement;
    fireEvent.click(
      within(other).getByRole("button", { name: "Add another link" }),
    );
    expect(
      within(other).getAllByLabelText("Where? (for example, Vimeo)"),
    ).toHaveLength(2);
  });

  it("at 12 places disables adding, an off chip, and says so", () => {
    renderForm();
    fireEvent.click(chip("Facebook"));
    const facebook = card("facebook") as HTMLElement;
    const add = within(facebook).getByRole("button", {
      name: "Add another link",
    });
    for (let i = 1; i < POSTINGS_MAX; i += 1) fireEvent.click(add);
    expect(within(facebook).getAllByLabelText(/Link to the post/)).toHaveLength(
      POSTINGS_MAX,
    );
    expect((add as HTMLButtonElement).disabled).toBe(true);
    const note = screen.getByText("You can add up to 12 places.");
    expect(add.getAttribute("aria-describedby")).toBe(note.id);
    expect(chip("X").getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(chip("X"));
    expect(card("x")).toBeNull();
  });
});

describe("PostingsForm: not posted and the upload note", () => {
  it("ticking turns every chip off and aria-disabled and removes the cards; unticking brings the chips back empty", () => {
    renderForm();
    fireEvent.click(chip("Instagram"));
    fireEvent.click(screen.getByLabelText("I haven't posted it anywhere yet."));
    expect(card("instagram")).toBeNull();
    for (const button of within(chipRow()).getAllByRole("button")) {
      expect(button.getAttribute("aria-pressed")).toBe("false");
      expect(button.getAttribute("aria-disabled")).toBe("true");
    }
    const fd = posted();
    expect(fd.get("notPosted")).toBe("on");
    expect([...fd.keys()].some((k) => k.startsWith("postings."))).toBe(false);
    expect(fd.getAll("platform")).toEqual([]);
    fireEvent.click(screen.getByLabelText("I haven't posted it anywhere yet."));
    expect(chip("Instagram").getAttribute("aria-disabled")).toBeNull();
    expect(chip("Instagram").getAttribute("aria-pressed")).toBe("false");
  });

  it("comes back ticked for a draft saved as not posted", () => {
    renderForm({ notPostedSaved: true });
    expect(
      (
        screen.getByLabelText(
          "I haven't posted it anywhere yet.",
        ) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(chip("TikTok").getAttribute("aria-disabled")).toBe("true");
  });

  it("an upload shows the moved note after the not-posted row and before Continue", () => {
    renderForm();
    const note = screen.getByText(
      "Is this video on Instagram, TikTok or YouTube? Connect the account to get a Verified label.",
    );
    const connect = screen.getByRole("link", { name: "Connect an account" });
    expect(connect.getAttribute("href")).toBe("/dashboard/connections");
    const notPosted = screen.getByLabelText(
      "I haven't posted it anywhere yet.",
    );
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(notPosted, note)).toBe(true);
    expect(follows(note, continueButton())).toBe(true);
  });
});

describe("PostingsForm: the Library source row", () => {
  it("is first and locked: '@demo.creator on Demo', Verified, From your Library; its chip on and aria-disabled; no not-posted row", () => {
    renderForm({ postings: [SOURCE_POSTING] });
    const demo = chip("Demo");
    expect(demo.getAttribute("aria-pressed")).toBe("true");
    expect(demo.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(demo);
    const source = document.querySelector<HTMLElement>("[data-posting-source]");
    if (!source) throw new Error("no source row");
    expect(
      source.closest("[data-posting-card]")?.getAttribute("data-posting-card"),
    ).toBe("mock");
    expect(within(source).getByText("@demo.creator on Demo")).toBeTruthy();
    expect(within(source).getByText("Verified")).toBeTruthy();
    expect(source.textContent).toContain("From your Library");
    expect(within(source).queryByRole("textbox")).toBeNull();
    expect(within(source).queryByRole("button", { name: "Remove" })).toBeNull();
    expect(
      screen.queryByLabelText("I haven't posted it anywhere yet."),
    ).toBeNull();
    expect(
      screen.queryByText(/Connect the account to get a Verified label/),
    ).toBeNull();
    // The locked chip posts no mirror: no link-less copy of the source.
    expect(posted().getAll("platform")).toEqual([]);
  });

  it("posts its Switch as sourceShowLink true/false once the creator turns it, and nothing before (owner answer Q-73 a)", () => {
    renderForm({ postings: [SOURCE_POSTING] });
    const source = document.querySelector<HTMLElement>(
      "[data-posting-source]",
    ) as HTMLElement;
    const toggle = within(source).getByRole("switch", {
      name: "Show buyers this link",
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(posted().has("sourceShowLink")).toBe(false);
    expect(toggle.getAttribute("name")).toBeNull();
    fireEvent.click(toggle);
    expect(posted().get("sourceShowLink")).toBe("false");
    fireEvent.click(toggle);
    expect(posted().get("sourceShowLink")).toBe("true");
  });

  it("follows the stored value until the creator turns it: a Check again that hid the link isn't undone by the next Continue", () => {
    const props = {
      video: VIDEO,
      notPostedSaved: false,
      allowMock: true,
      accounts: ACCOUNTS,
      connected: null,
    };
    const { rerender } = render(
      <PostingsForm {...props} postings={[SOURCE_POSTING]} />,
    );
    const toggle = () => screen.getByRole("switch");
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    // The same posting (same id) after refresh(): Check again verified it as unlisted and hid its link (07 D18).
    rerender(
      <PostingsForm
        {...props}
        postings={[
          { ...SOURCE_POSTING, showLink: false, visibility: "unlisted" },
        ]}
      />,
    );
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    expect(posted().has("sourceShowLink")).toBe(false);
    expect(
      screen.getByText(
        "This video is unlisted. Buyers won't see the link unless you turn it on.",
      ),
    ).toBeTruthy();
  });

  it("shows D18's note while an unlisted source's link is off", () => {
    renderForm({
      postings: [
        { ...SOURCE_POSTING, visibility: "unlisted", showLink: false },
      ],
    });
    const note = screen.getByText(
      "This video is unlisted. Buyers won't see the link unless you turn it on.",
    );
    expect(screen.getByRole("switch").getAttribute("aria-describedby")).toBe(
      note.id,
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.queryByText(/This video is unlisted/)).toBeNull();
  });

  it("Add another link on the source card adds a removable Demo field; Remove gives focus back to Add", async () => {
    renderForm({ postings: [SOURCE_POSTING] });
    const demo = card("mock") as HTMLElement;
    const add = within(demo).getByRole("button", { name: "Add another link" });
    fireEvent.click(add);
    expect(within(demo).getAllByLabelText(/Link to the post/)).toHaveLength(1);
    fireEvent.click(within(demo).getByRole("button", { name: "Remove" }));
    expect(within(demo).queryAllByLabelText(/Link to the post/)).toHaveLength(
      0,
    );
    await nextFrame();
    expect(document.activeElement).toBe(add);
  });
});

describe("PostingsForm: link errors and Move", () => {
  it("shows a parse error on blur, never while typing", () => {
    renderForm();
    fireEvent.click(chip("TikTok"));
    const link = linkIn("tiktok");
    fireEvent.change(link, { target: { value: SHORT } });
    expect(screen.queryByText(/That's a short link/)).toBeNull();
    fireEvent.blur(link);
    const error = screen.getByText(
      "That's a short link. Open it in your browser, then copy the full address from the address bar.",
    );
    expect(link.getAttribute("aria-invalid")).toBe("true");
    expect(link.getAttribute("aria-describedby")).toContain(
      error.closest("p")?.id,
    );
    fireEvent.change(link, { target: { value: `${SHORT}x` } });
    expect(screen.queryByText(/That's a short link/)).toBeNull();
  });

  it("wrong_platform names the platform with Q-76's article and Move puts the link in that card, focused", async () => {
    renderForm();
    fireEvent.click(chip("TikTok"));
    fireEvent.change(linkIn("tiktok"), { target: { value: REEL } });
    fireEvent.blur(linkIn("tiktok"));
    expect(
      screen.getByText("This is an Instagram link. Move it there?"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(chip("Instagram").getAttribute("aria-pressed")).toBe("true");
    expect(chip("TikTok").getAttribute("aria-pressed")).toBe("true");
    expect(linkIn("instagram").value).toBe(REEL);
    expect(linkIn("tiktok").value).toBe("");
    expect(screen.queryByText(/Move it there/)).toBeNull();
    await nextFrame();
    expect(document.activeElement).toBe(linkIn("instagram"));
  });

  it("Continue with a link that doesn't parse posts nothing: the error shows and takes focus", async () => {
    renderForm();
    fireEvent.click(chip("TikTok"));
    fireEvent.change(linkIn("tiktok"), { target: { value: SHORT } });
    fireEvent.click(continueButton());
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText(/That's a short link/)).toBeTruthy();
    await nextFrame();
    expect(document.activeElement).toBe(linkIn("tiktok"));
  });

  it("Continue with an Other without its name posts nothing: 'Add the name of the site.'", async () => {
    renderForm();
    fireEvent.click(chip("Other"));
    fireEvent.click(continueButton());
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText("Add the name of the site.")).toBeTruthy();
    await nextFrame();
    expect(document.activeElement).toBe(
      screen.getByLabelText("Where? (for example, Vimeo)"),
    );
  });

  it("an upload's Continue with nothing chosen says where to answer and focuses the first chip (05 §6.5 States)", async () => {
    renderForm();
    fireEvent.click(continueButton());
    expect(save).not.toHaveBeenCalled();
    expect(
      screen.getAllByText("Say where it was posted").length,
    ).toBeGreaterThan(0);
    await nextFrame();
    expect(document.activeElement).toBe(chip("Instagram"));
    // The focused chip is described by the error: read once, on focus.
    const describedBy = chip("Instagram").getAttribute("aria-describedby");
    expect(
      describedBy && document.getElementById(describedBy)?.textContent,
    ).toBe("Say where it was posted");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(chip("Facebook"));
    expect(screen.queryAllByText("Say where it was posted")).toEqual([]);
    expect(chip("Instagram").getAttribute("aria-describedby")).toBeNull();
  });
});

describe("PostingsForm: what Continue posts", () => {
  it("names every row for postingsFromFormData, card by card, with the video id", async () => {
    renderForm();
    fireEvent.click(chip("Other"));
    fireEvent.click(chip("Facebook"));
    fireEvent.change(screen.getByLabelText("Where? (for example, Vimeo)"), {
      target: { value: "Vimeo" },
    });
    fireEvent.change(linkIn("other"), {
      target: { value: "https://vimeo.com/123456789" },
    });
    fireEvent.change(linkIn("facebook"), {
      target: { value: "https://www.facebook.com/reel/1234567890123" },
    });
    const fd = await submit();
    const read = postingsFromFormData(fd);
    expect(read.videoId).toBe(VIDEO_ID);
    expect(read.notPosted).toBe(false);
    expect(read.postings).toEqual([
      {
        platform: "facebook",
        link: "https://www.facebook.com/reel/1234567890123",
      },
      {
        platform: "other",
        otherLabel: "Vimeo",
        link: "https://vimeo.com/123456789",
      },
    ]);
  });

  it("posts no showLink for a new link until the creator toggles its Switch (07 D18: the server's unlisted default applies)", () => {
    renderForm();
    fireEvent.click(chip("Demo"));
    expect(screen.queryByRole("switch")).toBeNull();
    fireEvent.change(linkIn("mock"), { target: { value: DEMO_01 } });
    const toggle = screen.getByRole("switch", {
      name: "Show buyers this link",
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(posted().has("postings.0.showLink")).toBe(false);
    fireEvent.click(toggle);
    expect(posted().get("postings.0.showLink")).toBe("false");
    fireEvent.click(toggle);
    expect(posted().get("postings.0.showLink")).toBe("true");
  });

  it("posts a saved link's Switch only once the creator turns it: a saved off shows off and posts nothing (owner answer Q-86 a)", () => {
    const off = savedPosting({
      id: "00000000-0000-4000-8000-0000000000d1",
      showLink: false,
    });
    const on = savedPosting({
      id: "00000000-0000-4000-8000-0000000000d2",
      url: DEMO_01,
      position: 2,
    });
    renderForm({ postings: [off, on] });
    const fd = posted();
    expect(fd.has("postings.0.showLink")).toBe(false);
    expect(fd.has("postings.1.showLink")).toBe(false);
    expect(fd.get("postings.0.link")).toBe(off.url);
    const [offSwitch, onSwitch] = screen.getAllByRole("switch", {
      name: "Show buyers this link",
    });
    expect(offSwitch.getAttribute("aria-checked")).toBe("false");
    expect(onSwitch.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(offSwitch);
    expect(posted().get("postings.0.showLink")).toBe("true");
    fireEvent.click(offSwitch);
    expect(posted().get("postings.0.showLink")).toBe("false");
    expect(posted().has("postings.1.showLink")).toBe(false);
  });

  it("keeps what was typed after a refusal and puts each error under its field, focused", async () => {
    renderForm();
    fireEvent.click(chip("Facebook"));
    fireEvent.click(chip("Demo"));
    fireEvent.change(linkIn("mock"), { target: { value: DEMO_01 } });
    save.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "already_on_your_video",
        message: "This post is already on your video “Beach day”.",
        fields: {
          "postings.1.link": [
            "This post is already on your video “Beach day”.",
          ],
        },
      },
    });
    fireEvent.click(continueButton());
    await waitFor(() =>
      expect(
        screen.getByText("This post is already on your video “Beach day”."),
      ).toBeTruthy(),
    );
    expect(linkIn("mock").value).toBe(DEMO_01);
    expect(linkIn("mock").getAttribute("aria-invalid")).toBe("true");
    expect(linkIn("facebook").getAttribute("aria-invalid")).toBeNull();
    await nextFrame();
    expect(document.activeElement).toBe(linkIn("mock"));
    fireEvent.change(linkIn("mock"), { target: { value: "" } });
    expect(screen.queryByText(/already on your video/)).toBeNull();
  });

  it("puts a refusal without a field in an error Banner above the cards, focused (read once, from the Banner)", async () => {
    renderForm();
    fireEvent.click(chip("Facebook"));
    save.mockResolvedValueOnce({
      ok: false,
      error: { code: "too_many", message: "You can add up to 12 places." },
    });
    fireEvent.click(continueButton());
    const box = await waitFor(() => {
      const el = document.querySelector<HTMLElement>("[data-form-error]");
      if (!el) throw new Error("no banner");
      return el;
    });
    expect(box.textContent).toContain("You can add up to 12 places.");
    expect(screen.queryByRole("alert")).toBeNull();
    await nextFrame();
    expect(document.activeElement).toBe(box);
  });
});

describe("PostingsForm: after a staying Continue", () => {
  it("reads the rows again from the saved postings (new ids), announces each result and focuses the first that needs action", async () => {
    const { rerender } = renderForm();
    fireEvent.click(chip("Demo"));
    fireEvent.change(linkIn("mock"), { target: { value: DEMO_01 } });
    save.mockResolvedValueOnce({ ok: true, data: { sameVideoMissing: false } });
    fireEvent.click(continueButton());
    await waitFor(() => expect(save).toHaveBeenCalled());
    const saved = savedPosting({
      id: "00000000-0000-4000-8000-0000000000e1",
      url: DEMO_01,
      verification: "unverified",
      unverifiedReason: "not_found",
      verifiedUsername: null,
      position: 1,
    });
    rerender(
      <PostingsForm
        video={VIDEO}
        postings={[saved]}
        notPostedSaved={false}
        allowMock
        accounts={ACCOUNTS}
        connected={null}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByText(
          "Not verified. This post isn't on any Demo account you've linked.",
        ),
      ).toBeTruthy(),
    );
    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe("Demo link not verified");
    await nextFrame();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Sync and check again" }),
    );
  });

  it("hides a saved result once its link is edited (Check again would check the stored one)", () => {
    const saved = savedPosting({
      id: "00000000-0000-4000-8000-0000000000e2",
      verification: "unverified",
      unverifiedReason: "check_failed",
      verifiedUsername: null,
    });
    renderForm({ postings: [saved] });
    expect(screen.getByText("We couldn't check this right now.")).toBeTruthy();
    fireEvent.change(linkIn("mock"), { target: { value: DEMO_01 } });
    expect(screen.queryByText("We couldn't check this right now.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
  });
});
