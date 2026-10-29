import { describe, expect, it } from "vitest";
import {
  requestNewSubject,
  requestReceivedSubject,
} from "@/server/email/subjects";
import { renderEmail } from "./render";
import { RequestNew, type RequestNewProps } from "./request-new";
import { RequestReceived, type RequestReceivedProps } from "./request-received";

const TOKEN = "A".repeat(43);
const BUYER_URL = `http://localhost:3100/r/7d3c0a52-5b1e-4f7e-9f61-0d6f4a1b2c3d?t=${TOKEN}`;
const CREATOR_URL =
  "http://localhost:3100/dashboard/requests/7d3c0a52-5b1e-4f7e-9f61-0d6f4a1b2c3d";
// 17 Oct 2026 18:32 UTC: Sat 17 Oct 2026, 2:32 PM EDT in New York (07 D84).
const EXPIRES = new Date("2026-10-17T18:32:00Z");
const SCOPE = "Paid social ads · 1 year · Worldwide";
const BARE_DOLLAR = /(^|[^A-Z])\$\d/;

const received: RequestReceivedProps = {
  handle: "maya",
  title: "First snow",
  scope: SCOPE,
  amountTotalCents: 173250,
  currency: "cad",
  expiresAt: EXPIRES,
  timeZone: "America/New_York",
  url: BUYER_URL,
};
const requestNew: RequestNewProps = {
  licenseeName: "Daily Laughs Media LLC",
  title: "First snow",
  scope: SCOPE,
  licensePriceCents: 157500,
  currency: "cad",
  expiresAt: EXPIRES,
  timeZone: "America/New_York",
  payoutsActive: true,
  url: CREATOR_URL,
};

describe("request-received (05 §8, to the buyer)", () => {
  it("holds the subject's headline, the hold body with the deadline in the buyer's zone, the context and the link", async () => {
    const { html, text } = await renderEmail(<RequestReceived {...received} />);
    expect(text).toContain("Request sent to @maya");
    expect(text).toContain(
      "Your card has a hold of CA$1,732.50, not a charge. @maya has until Sat 17 Oct 2026, 2:32 PM EDT (18:32 UTC) to approve. We'll email you either way.",
    );
    expect(text).toContain("First snow");
    expect(text).toContain(SCOPE);
    expect(text).toContain("See request status");
    expect(text).toContain(`Or open: ${BUYER_URL}`);
    expect(text).toContain(
      "You got this email because you requested a license on ClipLease.",
    );
    expect(text).toContain("Questions? Reply to this email.");
    expect(text).toContain("Test mode. No real money moved.");
    expect(text).not.toMatch(BARE_DOLLAR);
    expect(html).not.toMatch(/<img/i);
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(new Set(hrefs)).toEqual(new Set([BUYER_URL]));
  });

  it("has a subject with no link and no key", () => {
    const subject = requestReceivedSubject("maya");
    expect(subject).toBe("Request sent to @maya");
    expect(subject).not.toMatch(/http|t=/);
    expect(subject).not.toContain(TOKEN);
  });
});

describe("request-new (05 §8, to the creator)", () => {
  it("holds the subject's headline, scope, price and the deadline in the creator's zone, and the creator's footer", async () => {
    const { html, text } = await renderEmail(<RequestNew {...requestNew} />);
    expect(text).toContain(
      "New request: Daily Laughs Media LLC wants to license “First snow”",
    );
    expect(text).toContain(
      "Paid social ads · 1 year · Worldwide. You get CA$1,575.00. Answer by Sat 17 Oct 2026, 2:32 PM EDT (18:32 UTC). If you don't answer, the hold is released.",
    );
    expect(text).not.toContain("Set up payouts");
    expect(text).toContain("Review request");
    expect(text).toContain(`Or open: ${CREATOR_URL}`);
    expect(text).toContain(
      "You got this email because you have a creator account on ClipLease.",
    );
    expect(text).not.toContain("requested a license");
    expect(text).toContain("Test mode. No real money moved.");
    expect(text).not.toMatch(BARE_DOLLAR);
    expect(html).not.toMatch(/<img/i);
  });

  it("asks to set up payouts while they aren't active (07 D74)", async () => {
    const { text } = await renderEmail(
      <RequestNew {...requestNew} payoutsActive={false} />,
    );
    expect(text).toContain(
      "Set up payouts to approve before Sat 17 Oct 2026, 2:32 PM EDT (18:32 UTC).",
    );
  });

  it("names the deadline in the zone it is given, with UTC", async () => {
    const { text } = await renderEmail(
      <RequestNew {...requestNew} timeZone="Asia/Kolkata" />,
    );
    expect(text).toContain(
      "Answer by Sun 18 Oct 2026, 12:02 AM GMT+5:30 (Sat 17 Oct, 18:32 UTC).",
    );
  });

  it("has a subject with curly quotes and no link", () => {
    const subject = requestNewSubject("Daily Laughs Media LLC", "First snow");
    expect(subject).toBe(
      "New request: Daily Laughs Media LLC wants to license “First snow”",
    );
    expect(subject).not.toMatch(/http|t=/);
  });
});
