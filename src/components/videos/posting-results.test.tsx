// @vitest-environment jsdom
// First: its mocks must be in place before the form loads.
import "./postings-fixtures";
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
import { syncAccount } from "@/app/(dashboard)/dashboard/_actions/social";
import {
  recheckPosting,
  saveVideoPostings,
} from "@/app/(dashboard)/dashboard/videos/[id]/actions";
import { verifiedPostingsKey } from "@/lib/postings/form";
import type { OwnerPostingDTO } from "@/lib/postings/types";
import { postingAccounts } from "./posting-picker-state";
import {
  ACCOUNT_ID,
  DEMO_01,
  LINK_DEMO_HREF,
  SOURCE_POSTING,
  savedPosting,
  unverified,
  VIDEO,
} from "./postings-fixtures";
import { PostingsForm } from "./postings-form";
import { PostingsReadOnly } from "./postings-read-only";

const save = vi.mocked(saveVideoPostings);
const recheck = vi.mocked(recheckPosting);
const sync = vi.mocked(syncAccount);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

const SECOND_ACCOUNT = "00000000-0000-4000-8000-0000000000a2";
const CONNECTED = postingAccounts(
  ["mock"],
  [
    { id: ACCOUNT_ID, platform: "mock", status: "connected" },
    { id: SECOND_ACCOUNT, platform: "mock", status: "connected" },
  ],
);
const NOTHING_LINKED = postingAccounts(["mock"], []);
const SIGNED_OUT = postingAccounts(
  ["mock"],
  [{ id: ACCOUNT_ID, platform: "mock", status: "needs_reconnect" }],
);

function renderForm(props: Partial<ComponentProps<typeof PostingsForm>> = {}) {
  return render(
    <PostingsForm
      video={VIDEO}
      postings={[]}
      notPostedSaved={false}
      allowMock
      accounts={CONNECTED}
      connected={null}
      {...props}
    />,
  );
}

const rowOf = (posting: OwnerPostingDTO) => {
  const el = document.querySelector<HTMLElement>(
    `[data-row-key="${posting.id}"]`,
  );
  if (!el) throw new Error(`no row ${posting.id}`);
  return el;
};
const resultIn = (row: HTMLElement) =>
  row.querySelector("[data-posting-result]")?.textContent;
const nextFrame = () =>
  act(() => new Promise((resolve) => requestAnimationFrame(resolve)));

describe("saved results in place (04 §9.33 Link field states)", () => {
  it("Verified: ShieldCheck and the pill, 'Verified · on @demo.creator'; no action", () => {
    const posting = savedPosting({});
    renderForm({ postings: [posting] });
    const row = rowOf(posting);
    expect(resultIn(row)).toBe("Verified · on @demo.creator");
    expect(row.querySelector("svg.lucide-shield-check")).not.toBeNull();
    expect(row.querySelector("[data-row-action]")).toBeNull();
  });

  it("a verified post whose account is disconnected is 'no longer linked' (07 D72)", () => {
    const posting = savedPosting({ accountStatus: "disconnected" });
    renderForm({ postings: [posting] });
    expect(resultIn(rowOf(posting))).toBe(
      "Verified · on @demo.creator · no longer linked",
    );
  });

  it("the Library source row whose account is disconnected is 'no longer linked' too, editable and read-only (07 D72)", () => {
    const source = {
      ...SOURCE_POSTING,
      accountStatus: "disconnected" as const,
    };
    const line = "Verified · From your Library · no longer linked";
    renderForm({ postings: [source] });
    expect(
      document.querySelector("[data-posting-source]")?.textContent,
    ).toContain(line);
    cleanup();
    render(<PostingsReadOnly postings={[source]} />);
    expect(
      document.querySelector("[data-posting-source]")?.textContent,
    ).toContain(line);
  });

  it("not_found: the reason and Sync and check again", () => {
    const posting = unverified({ unverifiedReason: "not_found" });
    renderForm({ postings: [posting] });
    const row = rowOf(posting);
    expect(resultIn(row)).toBe(
      "Not verified Not verified. This post isn't on any Demo account you've linked.",
    );
    expect(
      within(row).getByRole("button", { name: "Sync and check again" }),
    ).toBeTruthy();
    expect(row.hasAttribute("data-needs-action")).toBe(true);
  });

  it("no_account: Link {Platform} to the start route coming back here, only for an enabled provider with nothing connected", () => {
    const posting = unverified({ unverifiedReason: "no_account" });
    renderForm({ postings: [posting], accounts: NOTHING_LINKED });
    const link = within(rowOf(posting)).getByRole("link", {
      name: "Link Demo",
    });
    expect(link.getAttribute("href")).toBe(LINK_DEMO_HREF);
    cleanup();
    renderForm({ postings: [posting], accounts: CONNECTED });
    expect(
      within(rowOf(posting)).getByRole("button", { name: "Check again" }),
    ).toBeTruthy();
    cleanup();
    const instagram = unverified({
      platform: "instagram",
      label: "Instagram",
      url: "https://www.instagram.com/reel/C0dEaBcDeF1/",
      unverifiedReason: "no_account",
    });
    renderForm({ postings: [instagram] });
    const row = rowOf(instagram);
    expect(row.textContent).toContain(
      "Not verified. Link your Instagram account to verify it.",
    );
    expect(
      within(row).queryByRole("link", { name: "Link Instagram" }),
    ).toBeNull();
    expect(row.querySelector("[data-row-action]")).toBeNull();
  });

  it("check_failed: TriangleAlert and Check again, or Reconnect {Platform} when every account needs it", () => {
    const posting = unverified({ unverifiedReason: "check_failed" });
    renderForm({ postings: [posting] });
    const row = rowOf(posting);
    expect(resultIn(row)).toBe("We couldn't check this right now.");
    expect(
      row.querySelector("svg.lucide-triangle-alert")?.getAttribute("class"),
    ).toContain("text-awaiting-text");
    expect(
      within(row).getByRole("button", { name: "Check again" }),
    ).toBeTruthy();
    cleanup();
    renderForm({ postings: [posting], accounts: SIGNED_OUT });
    expect(
      within(rowOf(posting))
        .getByRole("link", { name: "Reconnect Demo" })
        .getAttribute("href"),
    ).toBe(LINK_DEMO_HREF);
  });

  it("unverifiable: Facebook, X and Snapchat's line and Other's line, with no action", () => {
    const facebook = unverified({
      id: "00000000-0000-4000-8000-0000000000f1",
      platform: "facebook",
      label: "Facebook",
      url: "https://www.facebook.com/reel/1234567890123",
      unverifiedReason: "unverifiable",
    });
    const other = unverified({
      id: "00000000-0000-4000-8000-0000000000f2",
      platform: "other",
      label: "Vimeo",
      url: "https://vimeo.com/123456789",
      unverifiedReason: "unverifiable",
      position: 2,
    });
    renderForm({ postings: [facebook, other] });
    expect(rowOf(facebook).textContent).toContain(
      "Links from Facebook, X and Snapchat can't be verified yet. Buyers will see “Not verified”.",
    );
    expect(rowOf(other).textContent).toContain(
      "Links from other sites can't be verified. Buyers will see the site name, for example vimeo.com.",
    );
    expect(document.querySelector("[data-row-action]")).toBeNull();
  });

  it("released: the reason and Check again", () => {
    const posting = unverified({ unverifiedReason: "released" });
    renderForm({ postings: [posting] });
    const row = rowOf(posting);
    expect(row.textContent).toContain(
      "Not verified. This post was released when ClipLease turned the video off.",
    );
    expect(
      within(row).getByRole("button", { name: "Check again" }),
    ).toBeTruthy();
  });

  it("a saved row with no link shows only the empty helper", () => {
    const posting = unverified({
      platform: "snapchat",
      label: "Snapchat",
      url: null,
      unverifiedReason: "no_link",
    });
    renderForm({ postings: [posting] });
    const row = rowOf(posting);
    expect(row.querySelector("[data-posting-result]")).toBeNull();
    expect(row.textContent).toContain(
      "Optional. Without a link, buyers see “Also posted on Snapchat”.",
    );
  });

  it("a verified unlisted post starts with its Switch off and D18's note", () => {
    const posting = savedPosting({ visibility: "unlisted", showLink: false });
    renderForm({ postings: [posting] });
    const row = rowOf(posting);
    expect(within(row).getByRole("switch").getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(row.textContent).toContain(
      "This video is unlisted. Buyers won't see the link unless you turn it on.",
    );
  });
});

describe("row actions", () => {
  it("Check again checks the posting, announces its result once and keeps focus in the row", async () => {
    const posting = unverified({ unverifiedReason: "check_failed" });
    recheck.mockResolvedValueOnce({
      ok: true,
      data: { posting: { ...posting, verification: "verified" } },
    });
    renderForm({ postings: [posting] });
    const button = within(rowOf(posting)).getByRole("button", {
      name: "Check again",
    });
    button.focus();
    fireEvent.click(button);
    expect(within(rowOf(posting)).getByText("Checking the link…")).toBeTruthy();
    await waitFor(() =>
      expect(recheck).toHaveBeenCalledWith({ postingId: posting.id }),
    );
    await waitFor(() =>
      expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe(
        "Demo link verified",
      ),
    );
    await nextFrame();
    expect(rowOf(posting).contains(document.activeElement)).toBe(true);
  });

  it("Sync and check again syncs each connected account of the platform in turn, then checks; a slowed sync says so", async () => {
    const posting = unverified({ unverifiedReason: "not_found" });
    sync
      .mockResolvedValueOnce({
        ok: true,
        data: { ok: false, reason: "already_syncing" },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { ok: false, reason: "rate_limited", retryAfterSec: 900 },
      });
    recheck.mockResolvedValueOnce({ ok: true, data: { posting } });
    renderForm({ postings: [posting] });
    fireEvent.click(
      within(rowOf(posting)).getByRole("button", {
        name: "Sync and check again",
      }),
    );
    await waitFor(() =>
      expect(recheck).toHaveBeenCalledWith({ postingId: posting.id }),
    );
    expect(sync.mock.calls.map(([input]) => input)).toEqual([
      { socialAccountId: ACCOUNT_ID, mode: "recent" },
      { socialAccountId: SECOND_ACCOUNT, mode: "recent" },
    ]);
    await waitFor(() =>
      expect(rowOf(posting).textContent).toContain(
        "Demo asked us to slow down. Try again in 15 min.",
      ),
    );
  });

  it("a refused check shows its words under the row", async () => {
    const posting = unverified({ unverifiedReason: "released" });
    recheck.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "already_licensable_elsewhere",
        message:
          "This post is already licensable from another ClipLease account.",
      },
    });
    renderForm({ postings: [posting] });
    fireEvent.click(
      within(rowOf(posting)).getByRole("button", { name: "Check again" }),
    );
    await waitFor(() =>
      expect(rowOf(posting).textContent).toContain(
        "This post is already licensable from another ClipLease account.",
      ),
    );
  });

  it("back from a connect (?connected=mock) checks that platform's no_account and check_failed links once (Q-74 a)", async () => {
    vi.useFakeTimers();
    const noAccount = unverified({ unverifiedReason: "no_account" });
    const failed = unverified({
      id: "00000000-0000-4000-8000-0000000000b3",
      url: DEMO_01,
      unverifiedReason: "check_failed",
      position: 2,
    });
    const notFound = unverified({
      id: "00000000-0000-4000-8000-0000000000b4",
      url: "https://example.com/mock/mock_post_abc12345_03",
      unverifiedReason: "not_found",
      position: 3,
    });
    recheck.mockImplementation(async ({ postingId }) => ({
      ok: true,
      data: { posting: { ...noAccount, id: postingId } },
    }));
    renderForm({ postings: [noAccount, failed, notFound], connected: "mock" });
    expect(recheck).not.toHaveBeenCalled();
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(recheck.mock.calls.map(([input]) => input.postingId)).toEqual([
      noAccount.id,
      failed.id,
    ]);
  });
});

describe("the same-video block (07 D69; Q-75, Q-76 a)", () => {
  it("shows the cover first, then the verified post, 64 px pictures through the thumbnail proxy and the poster route", () => {
    renderForm({ postings: [SOURCE_POSTING] });
    const block = document.querySelector<HTMLElement>("[data-same-video]");
    if (!block) throw new Error("no block");
    expect(
      [...block.querySelectorAll("figcaption")].map((c) => c.textContent),
    ).toEqual(["Cover image", "Post"]);
    const images = [...block.querySelectorAll("img")].map((img) =>
      img.getAttribute("src"),
    );
    expect(images).toEqual([VIDEO.posterSrc, SOURCE_POSTING.thumbnailSrc]);
    expect(block.querySelector('img[src*="example.com"]')).toBeNull();
    expect(block.textContent).not.toContain("Make sure it's the same video");
    expect(block.querySelector("iframe")).toBeNull();
  });

  it("names each post and warns per post when there are several", () => {
    const post02 = savedPosting({});
    renderForm({ postings: [SOURCE_POSTING, post02] });
    const block = document.querySelector<HTMLElement>(
      "[data-same-video]",
    ) as HTMLElement;
    expect(
      [...block.querySelectorAll("figcaption")].map((c) => c.textContent),
    ).toEqual(["Cover image", "Demo post", "Demo post"]);
    expect(within(block).getByRole("status").textContent).toBe(
      "This file is 0:14 but the Demo post is 0:38. Make sure it's the same video.",
    );
  });

  it("warns with 04's words when the one verified post is more than 1 s off, above the tick", () => {
    renderForm({ postings: [savedPosting({})] });
    const block = document.querySelector<HTMLElement>(
      "[data-same-video]",
    ) as HTMLElement;
    const warning = within(block).getByText(
      "This file is 0:14 but the post is 0:38. Make sure it's the same video.",
    );
    const tick = within(block).getByLabelText(
      "These posts show this same video",
    );
    expect(
      warning.compareDocumentPosition(tick) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("posts the tick with the posts it confirms, and renders it ticked once confirmed", () => {
    const post02 = savedPosting({});
    renderForm({ postings: [post02] });
    const form = document.querySelector("form") as HTMLFormElement;
    const tick = screen.getByLabelText("These posts show this same video");
    expect(new FormData(form).get("sameVideo")).toBeNull();
    fireEvent.click(tick);
    const fd = new FormData(form);
    expect(fd.get("sameVideo")).toBe("on");
    expect(fd.get("videoId")).toBe(VIDEO.id);
    expect(fd.get("verifiedKey")).toBe(verifiedPostingsKey([post02]));
    cleanup();
    renderForm({
      postings: [post02],
      video: { ...VIDEO, sameVideoConfirmed: true },
    });
    expect(
      (
        screen.getByLabelText(
          "These posts show this same video",
        ) as HTMLInputElement
      ).checked,
    ).toBe(true);
  });

  it("is absent while nothing is verified", () => {
    renderForm({ postings: [unverified({ unverifiedReason: "not_found" })] });
    expect(document.querySelector("[data-same-video]")).toBeNull();
    expect(document.querySelector('[name="verifiedKey"]')).toBeNull();
  });

  it("a Continue that needed the tick: 'Confirm these posts show this same video' on the box, focused", async () => {
    save.mockResolvedValueOnce({ ok: true, data: { sameVideoMissing: true } });
    renderForm({ postings: [SOURCE_POSTING] });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const tick = screen.getByLabelText("These posts show this same video");
    await waitFor(() => expect(tick.getAttribute("aria-invalid")).toBe("true"));
    expect(
      screen.getByText("Confirm these posts show this same video"),
    ).toBeTruthy();
    await nextFrame();
    expect(document.activeElement).toBe(tick);
    fireEvent.click(tick);
    expect(
      screen.queryByText("Confirm these posts show this same video"),
    ).toBeNull();
  });
});

describe("PostingsReadOnly (published, 05 frame 35)", () => {
  it("shows the Notice first, then each posting's result, with no input, Switch, action or link element", () => {
    const facebook = unverified({
      id: "00000000-0000-4000-8000-0000000000f1",
      platform: "facebook",
      label: "Facebook",
      url: "https://www.facebook.com/reel/1234567890123",
      unverifiedReason: "unverifiable",
      position: 2,
    });
    const { container } = render(
      <PostingsReadOnly
        postings={[SOURCE_POSTING, savedPosting({}), facebook]}
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.firstElementChild?.textContent).toBe(
      "Turn off to edit where it was posted.",
    );
    expect(
      container.querySelectorAll(
        "input, button, a, iframe, img, [role=switch]",
      ),
    ).toHaveLength(0);
    const source = container.querySelector(
      "[data-posting-source]",
    ) as HTMLElement;
    expect(source.textContent).toBe(
      "@demo.creator on DemoVerified · From your Library",
    );
    expect(container.textContent).toContain("Verified · on @demo.creator");
    expect(container.textContent).toContain(
      "https://www.facebook.com/reel/1234567890123",
    );
    expect(container.textContent).not.toContain("Check again");
    expect(
      [...container.querySelectorAll("[data-posting-card]")].map((c) =>
        c.getAttribute("data-posting-card"),
      ),
    ).toEqual(["mock", "mock", "facebook"]);
  });
});
