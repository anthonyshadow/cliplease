import type { Metadata } from "next";
import { SHELL_GUTTER } from "@/components/layout/gutter";
import { NavBar } from "@/components/layout/nav-bar";
import { NotFoundBody } from "@/components/layout/not-found-body";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false },
};

// Unmatched URLs render inside the root layout only, so this page brings its own public NavBar.
export default function NotFound() {
  return (
    <>
      <NavBar variant="public" />
      <main className={cn("mx-auto w-full max-w-app", SHELL_GUTTER)}>
        <NotFoundBody />
      </main>
    </>
  );
}
