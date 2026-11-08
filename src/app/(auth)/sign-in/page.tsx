import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { READING_COLUMN } from "@/components/layout/gutter";
import { Banner } from "@/components/ui/banner";
import { validNextPath } from "@/lib/sign-in";
import {
  getSessionUser,
  hasStaleSessionCookie,
  resolveSignInLanding,
} from "@/server/auth/session";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

// S10 (05 §5.1). A signed-in visitor goes straight to a valid `next`, else to their landing page (07 D126): the form
// sends every sign-in back here, so the landing rule runs in this one place. A `next` under /licenses shows the buyer
// heading (P20b). The signed-out banner shows only when `next` is present and the request still carries a session
// cookie that no longer signs anyone in (owner answer, P04).
export default async function SignInPage({
  searchParams,
}: PageProps<"/sign-in">) {
  const { next: param } = await searchParams;
  const requested = typeof param === "string" ? param : undefined;
  const next = validNextPath(requested);
  const user = await getSessionUser();
  if (user) redirect(next ?? (await resolveSignInLanding(user)));
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
