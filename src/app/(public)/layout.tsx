import { LandingSignInLink } from "@/components/layout/landing-sign-in-link";
import { PublicShell } from "@/components/layout/public-shell";

// Public chrome: the public NavBar (wordmark only; "Sign in" on / alone, 05 §1.3, §4.7) and one <main>.
export default function PublicLayout({ children }: LayoutProps<"/">) {
  return <PublicShell right={<LandingSignInLink />}>{children}</PublicShell>;
}
