"use client";

import { type MouseEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { isPlainClick } from "@/components/ui/plain-click";
import { formatBytes } from "@/lib/format";
import {
  DOWNLOAD_COPY as COPY,
  DOWNLOAD_FAILED,
} from "@/lib/licensing/download-copy";

/**
 * How long a pressed download reads "Preparing…" (owner answer Q-185): a fixed time, since a download leaves the page as
 * it was and nothing tells it the file started; long enough for the signed URL or the PDF render to answer.
 */
export const PREPARING_MS = 3_000;

/**
 * A download (05 §4.4 callouts 5–6; owner answer Q-185): a plain link styled as a Button, never next/link, whose
 * prefetch would GET the route and log a download_event. One request per tap: pressed, it shows Button's loading layer
 * ("Preparing…", further presses ignored) for PREPARING_MS, or until the page comes back from the back-forward cache
 * (the PDF opens in place), and tells `onPress`. A new tab or window leaves it as it was. Full width, wrapping a long
 * label at 320 px.
 */
function DownloadLink({
  href,
  label,
  variant,
  onPress,
}: {
  href: string;
  label: string;
  variant: "primary" | "secondary";
  onPress: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  useEffect(() => {
    if (!pressed) return;
    const reset = () => setPressed(false);
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) reset();
    };
    window.addEventListener("pageshow", restore);
    const timer = setTimeout(reset, PREPARING_MS);
    return () => {
      window.removeEventListener("pageshow", restore);
      clearTimeout(timer);
    };
  }, [pressed]);
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainClick(event)) return;
    setPressed(true);
    onPress();
  };
  return (
    <Button
      asChild
      variant={variant}
      wrap
      loading={pressed}
      loadingLabel={COPY.preparing}
      className="w-full"
    >
      <a href={href} onClick={onClick}>
        {label}
      </a>
    </Button>
  );
}

/**
 * "Couldn't start the download. Try again." (05 §4.4; owner answer Q-185), where the page lands after a failed route:
 * scrolled to the middle of the view and focused, which reads it (content present at load, so no live role, as
 * AvailabilityNotice). `?download=failed` is a one-shot signal: right after the mount it leaves the address, so a reload
 * or a bookmark shows the page without the line. In a timeout, as StripConnectParams: Next 16 hooks
 * history.replaceState in the router's own mount effect, after a child's, and an earlier call is undone.
 */
function DownloadFailedLine() {
  const line = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    line.current?.scrollIntoView({ block: "center" });
    line.current?.focus({ preventScroll: true });
    const timer = setTimeout(() => {
      const url = new URL(window.location.href);
      if (!url.searchParams.has(DOWNLOAD_FAILED.param)) return;
      url.searchParams.delete(DOWNLOAD_FAILED.param);
      window.history.replaceState(
        null,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  return (
    <p
      ref={line}
      tabIndex={-1}
      className="rounded-xs text-footnote text-danger-text"
    >
      {COPY.downloadFailed}
    </p>
  );
}

/**
 * /l's downloads (04 §10.2 item 6; 05 §4.4): valid, **Download original · MP4 · 84 MB** (primary) then **Download license
 * PDF** (secondary); expired, "Expired. Only the license PDF stays available." and the PDF as the primary (07 D16). A
 * revoked license shows none: the page says why instead. `failed`: a route sent the buyer back (`?download=failed`),
 * so DownloadFailedLine sits under the buttons until a plain click on either starts the next try.
 */
export function LicenseDownloads({
  status,
  original,
  pdfHref,
  failed: sentBack,
}: {
  status: "valid" | "expired";
  /** The original's route, its type as the label names it ("MP4") and its size. */
  original: { href: string; type: string; bytes: number };
  pdfHref: string;
  failed: boolean;
}) {
  const [failed, setFailed] = useState(sentBack);
  const retry = () => setFailed(false);
  const valid = status === "valid";
  return (
    <div className="flex flex-col gap-3">
      {valid ? (
        <DownloadLink
          href={original.href}
          label={COPY.downloadOriginal(
            original.type,
            formatBytes(original.bytes),
          )}
          variant="primary"
          onPress={retry}
        />
      ) : (
        <p className="text-callout text-ink-2">{COPY.expired}</p>
      )}
      <DownloadLink
        href={pdfHref}
        label={COPY.downloadPdf}
        variant={valid ? "secondary" : "primary"}
        onPress={retry}
      />
      {failed ? <DownloadFailedLine /> : null}
    </div>
  );
}
