import Link from "next/link";
import { SETTINGS_COLUMN } from "@/components/layout/gutter";
import { Button } from "@/components/ui/button";
import { PRIMARY_WIDTH } from "@/components/ui/primary-width";
import { connectStartHref } from "./connect-messages";
import { StripConnectParams } from "./strip-connect-params";

/**
 * ?error=ig_personal on Connections (05 §6.2 callouts 14–18, 04 §11.7, 01 J2.4): one screen in place of the list.
 * Try again restarts the Instagram connect; the upload link and "Back to Connections" (owner answer Q-19) are tertiary.
 */
export function IgPersonalExplainer() {
  return (
    <div className={SETTINGS_COLUMN}>
      <h1 className="text-title-2 text-ink">
        Instagram needs a professional account.{" "}
        <span className="text-ink-2">Switching is free.</span>
      </h1>
      <p className="text-body text-ink">
        Instagram only lets apps read Creator and Business accounts. Switching
        is free: Instagram → Settings → Account type and tools → Switch to
        professional account.
      </p>
      <div className="flex flex-col items-start gap-2">
        <Button asChild className={PRIMARY_WIDTH}>
          <a href={connectStartHref("instagram", "/dashboard/connections")}>
            Try again
          </a>
        </Button>
        <Button asChild variant="tertiary" size="sm" wrap>
          <Link href="/dashboard/videos/new">
            Not ready to switch? Upload the video instead. It will be labeled
            Self-attested.
          </Link>
        </Button>
        <Button asChild variant="tertiary" size="sm">
          <Link href="/dashboard/connections">Back to Connections</Link>
        </Button>
      </div>
      <StripConnectParams />
    </div>
  );
}
