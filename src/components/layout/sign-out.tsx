"use client";

import { Button } from "@/components/ui/button";
import { MenuItem } from "@/components/ui/menu";

/**
 * Signs out, then a full navigation to /sign-in (a server render with no session). A network failure still navigates:
 * with the session intact, /sign-in sends the visitor back in. The auth client loads on the press, so the shell that
 * renders these doesn't carry it.
 */
async function signOutAndLeave() {
  await import("@/lib/auth-client")
    .then(({ authClient }) => authClient.signOut())
    .catch(() => null);
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

/** Settings' Account section: a secondary button (05 §6.11 callout 6). */
export function SignOutSettingsButton() {
  return (
    <Button
      variant="secondary"
      className="self-start"
      onClick={() => void signOutAndLeave()}
    >
      Sign out
    </Button>
  );
}
