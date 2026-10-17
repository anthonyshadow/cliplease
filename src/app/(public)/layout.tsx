import { LandingSignInLink } from "@/components/layout/landing-sign-in-link";
import { Wordmark } from "@/components/layout/wordmark";

// Public chrome: a sticky frosted header with the wordmark (05 §1.3). P02 swaps it for NavBar.
export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <header className="sticky top-0 z-40 h-(--nav-h) frosted border-b border-hairline">
        <div className="mx-auto flex h-full max-w-app items-center justify-between px-(--gutter)">
          <Wordmark />
          <LandingSignInLink />
        </div>
      </header>
      <main className="mx-auto w-full max-w-app px-(--gutter)">{children}</main>
    </>
  );
}
