// Reads the emails the console driver writes (src/server/email/drivers/console.ts). Plain Node only: the Playwright
// runner imports this file and has no app environment.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export type SentEmail = {
  template: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  createdAt: string;
};

// The console driver's EMAIL_SINK_DIR; the dev server, Vitest and Playwright all run from the repo root.
const EMAIL_SINK_DIR = path.join(process.cwd(), ".data", "emails");
const POLL_MS = 100;
const TIMEOUT_MS = 5_000;

/**
 * The newest `template` email to `to` sent at or after `since` (epoch ms), polling for up to 5 s. The driver names
 * files `<iso>-<hex>-<template>.json`, so the name alone filters by time and template; a file that doesn't parse yet
 * counts as not there.
 */
export async function readLatestEmail({
  to,
  template,
  since,
}: {
  to: string;
  template: string;
  since: number;
}): Promise<SentEmail> {
  const want = to.toLowerCase();
  const sinceIso = new Date(since).toISOString();
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const names = (await listFiles())
      .filter((name) => name >= sinceIso && name.endsWith(`-${template}.json`))
      .sort()
      .reverse();
    for (const name of names) {
      const email = await readEmail(path.join(EMAIL_SINK_DIR, name));
      if (email?.to.toLowerCase() === want) return email;
    }
    if (Date.now() > deadline) {
      throw new Error(`No ${template} email to ${to} since ${sinceIso}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

async function listFiles(): Promise<string[]> {
  try {
    return await readdir(EMAIL_SINK_DIR);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readEmail(file: string): Promise<SentEmail | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as SentEmail;
  } catch {
    return null;
  }
}

/** The 6 digits of a sign-in code email ("Enter this code to sign in: 482 913"). */
export function extractSignInCode(email: Pick<SentEmail, "text">): string {
  const match = /sign in:\s*(\d{3}) ?(\d{3})(?!\d)/i.exec(email.text);
  if (!match) throw new Error("No sign-in code in the email text");
  return match[1] + match[2];
}

/** The newest sign-in code sent to `to` at or after `since` (epoch ms). */
export async function readSignInCode(to: string, since: number) {
  return extractSignInCode(
    await readLatestEmail({ to, template: "sign-in-code", since }),
  );
}

/** `code` with its first digit changed: always a wrong code. */
export function wrongCode(code: string): string {
  return `${(Number(code[0]) + 1) % 10}${code.slice(1)}`;
}
