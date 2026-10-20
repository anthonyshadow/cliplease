import { describe, expect, it } from "vitest";
import { contentDisposition } from "./content-disposition";

describe("contentDisposition (research/infra.md §1)", () => {
  it("keeps a plain ASCII name as is in both parameters", () => {
    expect(
      contentDisposition("attachment", "ClipLease-ABC123-original.mp4"),
    ).toBe(
      `attachment; filename="ClipLease-ABC123-original.mp4"; filename*=UTF-8''ClipLease-ABC123-original.mp4`,
    );
  });

  it("uses the inline kind", () => {
    expect(contentDisposition("inline", "license.pdf")).toBe(
      `inline; filename="license.pdf"; filename*=UTF-8''license.pdf`,
    );
  });

  it("falls back to ASCII and encodes the UTF-8 name for Café clip.mov", () => {
    expect(contentDisposition("attachment", "Café clip.mov")).toBe(
      `attachment; filename="Caf_ clip.mov"; filename*=UTF-8''Caf%C3%A9%20clip.mov`,
    );
  });

  it("replaces quotes and backslashes in the fallback", () => {
    const header = contentDisposition("attachment", 'a"b\\c.mp4');
    expect(header).toContain(`filename="a_b_c.mp4"`);
    expect(header).toContain(`filename*=UTF-8''a%22b%5Cc.mp4`);
  });

  it("replaces every non-ASCII code unit, astral characters included", () => {
    const header = contentDisposition("attachment", "日本🎬.mov");
    // Two BMP characters plus one surrogate pair: four UTF-16 code units, four underscores.
    expect(header).toContain(`filename="____.mov"`);
    expect(header).toContain(
      `filename*=UTF-8''${encodeURIComponent("日本🎬.mov")}`,
    );
  });

  it("never lets a CR or LF into the header", () => {
    const header = contentDisposition("attachment", "a\r\nSet-Cookie: x.mp4");
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toContain(`filename="a__Set-Cookie: x.mp4"`);
    expect(header).toContain("a%0D%0ASet-Cookie");
  });
});
