import { SHELL_GUTTER } from "@/components/layout/gutter";
import { LandingSignInLink } from "@/components/layout/landing-sign-in-link";
import { NavBar } from "@/components/layout/nav-bar";
import { cn } from "@/lib/utils";

// Public chrome: the public NavBar (wordmark only; "Sign in" on / alone, 05 §1.3, §4.7) and one <main>.
export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <NavBar variant="public" right={<LandingSignInLink />} />
      <main className={cn("mx-auto w-full max-w-app", SHELL_GUTTER)}>
        {children}
      </main>
    </>
  );
}
