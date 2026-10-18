import { PublicShell } from "@/components/layout/public-shell";

// Sign-in chrome: the public NavBar with the wordmark only (05 §5.1) and one <main>.
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return <PublicShell>{children}</PublicShell>;
}
