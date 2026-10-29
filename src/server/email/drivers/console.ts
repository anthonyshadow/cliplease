import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { type AppEnv, env, isDevAppEnv } from "@/server/env";
import type { EmailDriver } from "../types";

/**
 * Where the console driver keeps sent emails (git-ignored). Tests and e2e read them back. The turbopackIgnore comment
 * keeps the build from tracing the project, .data included, into the server output: this driver runs only in development
 * and test (07 D51).
 */
export const EMAIL_SINK_DIR = path.join(
  /*turbopackIgnore: true*/ process.cwd(),
  ".data",
  "emails",
);

/**
 * The dev and test transport (07 D51): prints a plain block (to, subject, text) with process.stdout.write, so the dev
 * terminal shows a sign-in code without it ever passing through console.* or the logger, and writes
 * `<iso>-<6 hex>-<template>.json` atomically (a temp file, then a rename). Refuses to exist outside development and test.
 */
export function createConsoleDriver({
  appEnv = env.APP_ENV,
  dir = EMAIL_SINK_DIR,
}: {
  appEnv?: AppEnv;
  dir?: string;
} = {}): EmailDriver {
  if (!isDevAppEnv(appEnv)) {
    throw new Error(
      "The console email driver runs only when APP_ENV is development or test",
    );
  }
  return {
    provider: "console",
    async send({ template, to, subject, html, text }) {
      process.stdout.write(
        `\n--- email (${template}) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n---\n`,
      );
      const createdAt = new Date().toISOString();
      const name = `${createdAt}-${randomBytes(3).toString("hex")}-${template}.json`;
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, name);
      const temp = path.join(dir, `.${name}.tmp`);
      await writeFile(
        temp,
        JSON.stringify(
          { template, to, subject, text, html, createdAt },
          null,
          2,
        ),
        { flag: "wx" },
      );
      await rename(temp, file);
      return { providerMessageId: null };
    },
  };
}
