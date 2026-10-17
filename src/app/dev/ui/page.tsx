import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { env, isDevAppEnv } from "@/server/env";
import { Gallery } from "./gallery";
import { ThemeAttribute } from "./theme-attribute";

export const metadata: Metadata = {
  title: "UI gallery",
  robots: { index: false, follow: false },
};

// Dev-only review page (owner answer 1a): 404 unless APP_ENV is development or test. connection() makes it
// render per request, so the gate runs at request time, not only at build.
export default async function DevUiPage({
  searchParams,
}: PageProps<"/dev/ui">) {
  await connection();
  if (!isDevAppEnv(env.APP_ENV)) notFound();
  const { theme, view } = await searchParams;
  return (
    <>
      <ThemeAttribute
        theme={theme === "light" || theme === "dark" ? theme : undefined}
      />
      <Gallery view={view === "history" ? "history" : "waiting"} />
    </>
  );
}
