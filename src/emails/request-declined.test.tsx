import { describe, expect, it } from "vitest";
import { type DeclinedView, VIEW_COPY } from "@/lib/licensing/request-status";
import { requestDeclinedSubject } from "@/server/email/subjects";
import { BARE_DOLLAR } from "../../tests/helpers/money";
import { renderEmail } from "./render";
import { REQUEST_EMAIL_COPY as COPY } from "./request-copy";
import { RequestDeclined, type RequestDeclinedProps } from "./request-declined";

const TOKEN = "A".repeat(43);
const BUYER_URL = `http://localhost:3100/r/7d3c0a52-5b1e-4f7e-9f61-0d6f4a1b2c3d?t=${TOKEN}`;
const SCOPE = "Paid social ads · 1 year · Worldwide";

const declined: RequestDeclinedProps = {
  handle: "maya",
  title: "First snow",
  scope: SCOPE,
  statusReason: "creator",
  url: BUYER_URL,
};

const BODY =
  "@maya didn't approve this request. You haven't been charged, and the hold on your card has been released.";
const VIDEO_DISABLED_BODY =
  "This video is no longer available. You haven't been charged, and the hold on your card has been released.";

describe("request-declined (05 §8, to the buyer; 01 §4.8; 07 D28)", () => {
  it("reads in 05 §8's order: headline, body, context, button, link, footer", async () => {
    const { text } = await renderEmail(<RequestDeclined {...declined} />);
    const order = [
      "Not approved: you weren't charged",
      BODY,
      "First snow",
      SCOPE,
      "See request status",
      `Or open: ${BUYER_URL}`,
      "You got this email because you requested a license on ClipLease.",
      "Questions? Reply to this email.",
      "Test mode. No real money moved.",
    ];
    const at = order.map((part) => text.indexOf(part));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(text).not.toContain("creator account");
  });

  it.each([null, "something_new"])(
    "reads as the creator's decline for the reason %s",
    async (statusReason) => {
      const { text } = await renderEmail(
        <RequestDeclined {...declined} statusReason={statusReason} />,
      );
      expect(text).toContain(BODY);
    },
  );

  it("says a disabled video is gone, not that the creator didn't approve (07 D28)", async () => {
    const { text } = await renderEmail(
      <RequestDeclined {...declined} statusReason="video_disabled" />,
    );
    expect(text).toContain(VIDEO_DISABLED_BODY);
    expect(text).not.toContain("didn't approve");
    expect(text).toContain("Not approved: you weren't charged");
  });

  it("opens with /r's Not approved body for every reason, word for word (05 §8 callout 3)", () => {
    const facts = { handle: "maya", total: "CA$1,732.50", deadline: null };
    for (const view of Object.keys(COPY.declinedBody) as DeclinedView[]) {
      expect(COPY.declinedBody[view]("maya")).toBe(VIEW_COPY[view].body(facts));
    }
  });

  it("prints no amount and no date, and none of request-received's hold sentence", async () => {
    const { html, text } = await renderEmail(<RequestDeclined {...declined} />);
    expect(text).not.toMatch(BARE_DOLLAR);
    expect(html).not.toMatch(BARE_DOLLAR);
    expect(text).not.toContain("hold of");
    expect(text).not.toContain("Amounts in");
    expect(text).not.toContain("UTC");
  });

  it("has one button and links only to the buyer's /r", async () => {
    const { html } = await renderEmail(<RequestDeclined {...declined} />);
    expect(html).not.toMatch(/<img/i);
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    // The button and its "Or open:" line.
    expect(hrefs).toEqual([BUYER_URL, BUYER_URL]);
    expect(html.match(/See request status/g)).toHaveLength(1);
  });

  it("has 05 §8's subject, with no link and no key (07 D34)", () => {
    const subject = requestDeclinedSubject();
    expect(subject).toBe("Not approved: you weren't charged");
    expect(subject).not.toMatch(/http|t=|\/r\//);
    expect(subject).not.toContain(TOKEN);
  });
});
