import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { READING_COLUMN } from "@/components/layout/gutter";
import { Banner } from "@/components/ui/banner";
import { safeNextPath } from "@/lib/sign-in";
import { getSessionUser, hasStaleSessionCookie } from "@/server/auth/session";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

// S10 (05 §5.1). A signed-in visitor goes straight to `next`. The signed-out banner shows only when `next` is present
// and the request still carries a session cookie that no longer signs anyone in (owner answer, P04).
export default async function SignInPage({
  searchParams,
}: PageProps<"/sign-in">) {
  const { next: param } = await searchParams;
  const requested = typeof param === "string" ? param : undefined;
  const next = safeNextPath(requested);
  if (await getSessionUser()) redirect(next);
  const signedOut = requested !== undefined && (await hasStaleSessionCookie());
  return (
    <div className={READING_COLUMN}>
      {signedOut ? (
        <Banner>You've been signed out. Sign in again to continue.</Banner>
      ) : null}
      <SignInForm next={next} />
    </div>
  );
}
