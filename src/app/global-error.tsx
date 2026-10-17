"use client";

import { ErrorBody } from "@/components/layout/error-body";
import { SHELL_MAIN } from "@/components/layout/gutter";
import { inter } from "./fonts";
import "./globals.css";

// Replaces the root layout when it fails itself, so it brings its own <html> and <body> (05 §10).
export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <main className={SHELL_MAIN}>
          <ErrorBody retry={retry} />
        </main>
      </body>
    </html>
  );
}
