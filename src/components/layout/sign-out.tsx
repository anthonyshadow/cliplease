"use client";

import { MenuItem } from "@/components/ui/menu";
import { authClient } from "@/lib/auth-client";

/**
 * Signs out, then a full navigation to /sign-in (a server render with no session). A network failure still navigates:
 * with the session intact, /sign-in sends the visitor back in.
 */
async function signOutAndLeave() {
  await authClient.signOut().catch(() => null);
  window.location.assign("/sign-in");
}

/** The avatar Menu's last item (04 §9.30). */
export function SignOutMenuItem() {
  return <MenuItem onSelect={() => void signOutAndLeave()}>Sign out</MenuItem>;
}

/** The MoreSheet's Sign out row (04 §9.30): fills its 52 px row. */
export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => void signOutAndLeave()}
      className="flex h-full w-full items-center text-body text-ink"
    >
      Sign out
    </button>
  );
}
