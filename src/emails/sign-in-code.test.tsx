import { render, toPlainText } from "react-email";
import { describe, expect, it } from "vitest";
import { signInCodeSubject } from "@/server/email/subjects";
import { SignInCode } from "./sign-in-code";

describe("sign-in-code email (05 §8)", () => {
  it("shows the code grouped 3 + 3 in the HTML and the text, and the subject has no digits", async () => {
    const html = await render(<SignInCode code="482913" />);
    const text = toPlainText(html);
    for (const out of [html, text]) {
      expect(out).toContain("482 913");
      expect(out).not.toContain("482913");
    }
    expect(text).toContain("Enter this code to sign in:");
    expect(text).toContain(
      "It expires in 10 minutes. If you didn't ask for it, ignore this email.",
    );
    expect(text).toContain(
      "You got this email because someone asked to sign in to ClipLease with this address.",
    );
    expect(text).toContain("Questions? Reply to this email.");
    expect(signInCodeSubject()).toBe("Your ClipLease sign-in code");
    expect(signInCodeSubject()).not.toMatch(/\d/);
  });

  it("keeps a leading zero", async () => {
    const text = toPlainText(await render(<SignInCode code="012345" />));
    expect(text).toContain("012 345");
  });

  it("has no images and no buttons", async () => {
    const html = await render(<SignInCode code="482913" />);
    expect(html).not.toMatch(/<img|<button|href=/i);
  });
});
