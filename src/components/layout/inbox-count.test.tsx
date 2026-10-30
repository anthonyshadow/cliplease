// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  InboxCountProvider,
  SyncInboxCount,
  useInboxCount,
} from "./inbox-count";

afterEach(cleanup);

function Badge() {
  return <output>{useInboxCount()}</output>;
}

/** The layout's tree: the provider with its count, the badge, and the Inbox page's push when it renders. */
const tree = (layout: { count: number; readId: string }, pushed?: number) => (
  <InboxCountProvider count={layout.count} readId={layout.readId}>
    <Badge />
    {pushed === undefined ? null : <SyncInboxCount count={pushed} />}
  </InboxCountProvider>
);

describe("InboxCountProvider (05 §6.3 callout 1)", () => {
  it("shows the Inbox page's count after a client navigation, then the layout's again on its next render, even one equal to its last", () => {
    const { rerender } = render(tree({ count: 2, readId: "first" }, 3));
    expect(screen.getByRole("status").textContent).toBe("3");

    // A client navigation away: the layout doesn't render again, so the page's count stays.
    rerender(tree({ count: 2, readId: "first" }));
    expect(screen.getByRole("status").textContent).toBe("3");

    // A refresh renders the layout again with a fresh read that happens to equal its last one: it wins.
    rerender(tree({ count: 2, readId: "second" }));
    expect(screen.getByRole("status").textContent).toBe("2");
  });
});
