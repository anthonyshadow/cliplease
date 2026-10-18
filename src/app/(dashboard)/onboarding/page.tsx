import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { NavBar } from "@/components/layout/nav-bar";
import { SignOutMenuItem } from "@/components/layout/sign-out";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Welcome" };

// The onboarding placeholder: NavBar with the wordmark and avatar, no TabBar (05 §5.2). P05 builds the form.
export default async function OnboardingPage() {
  const user = await requireUser("/onboarding");
  return (
    <AppShell
      nav={
        <NavBar
          variant="creator"
          withoutProfile
          user={{ name: user.name || user.email }}
          signOut={<SignOutMenuItem />}
        />
      }
    >
      <div className="mx-auto max-w-reading py-6 lg:py-12">
        <h1 className="text-title-1 text-ink">
          Welcome. <span className="text-ink-2">Pick your handle.</span>
        </h1>
      </div>
    </AppShell>
  );
}
