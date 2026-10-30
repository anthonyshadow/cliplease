import { describe, expect, it } from "vitest";
import { licenseApprovedSubject } from "@/server/email/subjects";
import { BARE_DOLLAR } from "../../tests/helpers/money";
import { LicenseApproved, type LicenseApprovedProps } from "./license-approved";
import { renderEmail } from "./render";

const TOKEN = "A".repeat(43);
const LICENSE_URL = `http://localhost:3100/l/${TOKEN}`;
const VERIFY_URL = "http://localhost:3100/verify/CL-7K3M-9QXA";
const SCOPE = "Paid social ads · 1 year · Worldwide";

const approved: LicenseApprovedProps = {
  handle: "maya",
  title: "First snow",
  scope: SCOPE,
  code: "CL-7K3M-9QXA",
  amountTotalCents: 173250,
  currency: "cad",
  url: LICENSE_URL,
  verifyUrl: VERIFY_URL,
};

const BODY =
  "@maya approved. You were charged CA$1,732.50. Your file and license are ready.";
const VERIFY = `Anyone can check this license at ${VERIFY_URL}.`;

describe("license-approved (05 §8, to the buyer; 01 J9.3; 07 D98)", () => {
  it("reads in 05 §8's order: headline, body, amounts, context, button, link, the public record, footer", async () => {
    const { text } = await renderEmail(<LicenseApproved {...approved} />);
    const order = [
      "Approved: your license CL-7K3M-9QXA is ready",
      BODY,
      "Amounts in Canadian dollars (CAD).",
      "First snow",
      SCOPE,
      "License CL-7K3M-9QXA",
      "Get file and license",
      `Or open: ${LICENSE_URL}`,
      VERIFY,
      "You got this email because you requested a license on ClipLease.",
      "Questions? Reply to this email.",
      "Test mode. No real money moved.",
    ];
    const at = order.map((part) => text.indexOf(part));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("prints every amount with its currency and no date", async () => {
    const { html, text } = await renderEmail(<LicenseApproved {...approved} />);
    expect(text).not.toMatch(BARE_DOLLAR);
    expect(html).not.toMatch(BARE_DOLLAR);
    expect(text).not.toContain("UTC");
  });

  it("has one button and links only to the license and its public record", async () => {
    const { html } = await renderEmail(<LicenseApproved {...approved} />);
    expect(html).not.toMatch(/<img/i);
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(new Set(hrefs)).toEqual(new Set([LICENSE_URL, VERIFY_URL]));
    // The button and its "Or open:" line, then the record's link.
    expect(hrefs.filter((href) => href === LICENSE_URL)).toHaveLength(2);
    expect(hrefs.filter((href) => href === VERIFY_URL)).toHaveLength(1);
    expect(html.match(/Get file and license/g)).toHaveLength(1);
    // The period stays outside the record's link, so a copied URL normalizes.
    expect(html).not.toContain(`href="${VERIFY_URL}."`);
  });

  it("names a USD license's currency (07 D98)", async () => {
    const { text } = await renderEmail(
      <LicenseApproved {...approved} currency="usd" />,
    );
    expect(text).toContain("You were charged US$1,732.50.");
    expect(text).toContain("Amounts in US dollars (USD).");
    expect(text).not.toMatch(BARE_DOLLAR);
  });

  it("has a subject naming the code, with no link and no key (07 D34)", () => {
    const subject = licenseApprovedSubject("CL-7K3M-9QXA");
    expect(subject).toBe("Approved: your license CL-7K3M-9QXA is ready");
    expect(subject).not.toMatch(/http|t=|\/l\//);
    expect(subject).not.toContain(TOKEN);
  });
});
