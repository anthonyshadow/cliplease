"use client";

import { Button } from "@/components/ui/button";
import { inter } from "./fonts";
import "./globals.css";

// Replaces the root layout when it fails itself, so it brings its own <html> and <body> (05 §10).
export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <main className="mx-auto flex max-w-reading flex-col items-start gap-4 px-(--gutter) py-12">
          <h1 className="text-title-1 text-ink">
            Something went wrong. Try again.
          </h1>
          <Button onClick={() => retry()}>Try again</Button>
        </main>
      </body>
    </html>
  );
}
