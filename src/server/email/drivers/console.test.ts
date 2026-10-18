import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConsoleDriver } from "./console";

const message = {
  template: "sign-in-code" as const,
  from: "ClipLease <onboarding@resend.dev>",
  to: "maya@example.com",
  subject: "Your ClipLease sign-in code",
  html: "<p>Enter this code to sign in: 482 913</p>",
  text: "Enter this code to sign in: 482 913",
};

let dir: string | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("console email driver (07 D51)", () => {
  it("prints with process.stdout.write, never console.*, and writes one JSON file", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "emails-"));
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const consoleCalls = (
      ["log", "info", "warn", "error", "debug"] as const
    ).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    await createConsoleDriver({
      appEnv: "test",
      dir: path.join(dir, "emails"),
    }).send(message);

    const printed = write.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(printed).toContain("To: maya@example.com");
    expect(printed).toContain("482 913");
    for (const spy of consoleCalls) expect(spy).not.toHaveBeenCalled();

    const files = await readdir(path.join(dir, "emails"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(
      /^\d{4}-\d{2}-\d{2}T[\d:.]+Z-[0-9a-f]{6}-sign-in-code\.json$/,
    );
    const saved = JSON.parse(
      await readFile(path.join(dir, "emails", files[0] ?? ""), "utf8"),
    );
    expect(saved).toMatchObject({
      template: "sign-in-code",
      to: "maya@example.com",
      subject: "Your ClipLease sign-in code",
      text: message.text,
      html: message.html,
    });
    expect(Date.parse(saved.createdAt)).not.toBeNaN();
  });

  it.each(["production", "preview"] as const)(
    "refuses APP_ENV=%s",
    (appEnv) => {
      expect(() => createConsoleDriver({ appEnv })).toThrow(
        "The console email driver runs only when APP_ENV is development or test",
      );
    },
  );
});
