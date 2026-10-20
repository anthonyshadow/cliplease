"use client";

import { Ellipsis, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useRef, useState, useTransition } from "react";
import { disconnectAccount } from "@/app/(dashboard)/dashboard/_actions/social";
import { SyncButton } from "@/components/library/sync-button";
import { SyncStatus } from "@/components/library/sync-status";
import { PlatformMark } from "@/components/platform/platform-mark";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { StatusPill } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/toast";
import { PLATFORM_LABELS } from "@/lib/brand";
import type { SocialProviderId } from "@/lib/domain/values";
import { ConnectLink } from "./connect-link";
import {
  type CardState,
  disconnectedToast,
  disconnectTitle,
  GOOGLE_PERMISSIONS_URL,
  INSTAGRAM_DISCONNECT_NOTE,
  liveVideosSentence,
  rateLimitMessage,
  reconnectMessage,
  SYNC_PROBLEM_MESSAGE,
} from "./connect-messages";

/** What one card shows, formatted on the server (times, counts, the cap note) so the client never formats a clock. */
export type AccountCardView = {
  id: string;
  platform: SocialProviderId;
  /** "@demo.creator", or the display name / channel title. */
  name: string;
  /** For the avatar's initials and alt text. */
  avatarName: string;
  avatarSrc: string | null;
  /** "Demo", "Instagram · Creator account", "YouTube channel". */
  platformLine: string;
  hasMark: boolean;
  /** Row 3's message and action (cardState). */
  state: CardState;
  /** 07 D02's derived label, which the pill shows even while a new sync runs. */
  syncProblem: boolean;
  /** "Synced just now · 24 videos"; null before the first sync. */
  syncText: string | null;
  capNote: string | null;
  /** The Reconnect link (the start route coming back here). */
  reconnectHref: string;
  /** Published videos with a verified posting from this account (the Disconnect sheet). */
  liveVideoCount: number;
  /** The element that takes the focus once a disconnected card leaves the page (the page title). */
  focusAfterRemove: string;
};

const PILLS = {
  needs_reconnect: <StatusPill tone="awaiting">Needs reconnect</StatusPill>,
  sync_problem: <StatusPill tone="awaiting">Sync problem</StatusPill>,
  connected: (
    <StatusPill tone="neutral" dot="solid">
      Connected
    </StatusPill>
  ),
};

/**
 * 04 §9.18 / 05 §6.2: avatar, name, platform and status; the sync line; then the state's message and actions with the
 * overflow menu. `compact` (onboarding step 2, 05 §5.2) shows rows 1–2 only. `primary` makes Reconnect the page's one
 * primary.
 */
export function ConnectedAccountCard({
  account,
  compact = false,
  primary = false,
}: {
  account: AccountCardView;
  compact?: boolean;
  primary?: boolean;
}) {
  const pill =
    account.state.kind === "needs_reconnect"
      ? PILLS.needs_reconnect
      : account.syncProblem
        ? PILLS.sync_problem
        : PILLS.connected;
  return (
    <article className="flex flex-col gap-3 rounded-lg bg-surface p-5">
      <div className="flex items-start gap-3">
        <Avatar name={account.avatarName} src={account.avatarSrc} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="text-body font-semibold text-ink">{account.name}</h2>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-footnote text-ink-2">
            {account.hasMark ? (
              <PlatformMark platform={account.platform} hasFile />
            ) : null}
            <span>{account.platformLine}</span>
            {account.platform === "mock" ? (
              <StatusPill tone="neutral">Demo account</StatusPill>
            ) : null}
          </p>
        </div>
        {pill}
      </div>
      {account.syncText ? (
        <div className="flex flex-col gap-0.5">
          <SyncStatus>{account.syncText}</SyncStatus>
          {account.capNote ? (
            <p className="text-footnote text-ink-2">{account.capNote}</p>
          ) : null}
        </div>
      ) : null}
      {compact ? null : <CardActions account={account} primary={primary} />}
    </article>
  );
}

/**
 * Row 3: the state's message and action. Every state renders the same two parts, so a re-render after Sync now keeps
 * the button (and the keyboard focus on it), and a new message is read out politely.
 */
function CardActions({
  account,
  primary,
}: {
  account: AccountCardView;
  primary: boolean;
}) {
  const messageId = `account-${account.id}-message`;
  const { state } = account;
  let message: ReactNode = null;
  switch (state.kind) {
    case "needs_reconnect":
      message = (
        <p className="flex gap-2 text-callout text-awaiting-text">
          <TriangleAlert aria-hidden size={16} className="mt-0.5 shrink-0" />
          {reconnectMessage(account.platform)}
        </p>
      );
      break;
    case "syncing":
      message = (
        <SyncStatus id={messageId} live={false}>
          Syncing…
        </SyncStatus>
      );
      break;
    case "rate_limited":
    case "sync_problem":
      message = (
        <p id={messageId} className="text-callout text-ink">
          {state.kind === "rate_limited"
            ? rateLimitMessage(PLATFORM_LABELS[account.platform], state.minutes)
            : SYNC_PROBLEM_MESSAGE}
        </p>
      );
      break;
  }
  return (
    <>
      <div aria-live="polite" className="empty:hidden">
        {message}
      </div>
      <ActionRow account={account}>
        {state.kind === "needs_reconnect" ? (
          <ConnectLink
            href={account.reconnectHref}
            label="Reconnect"
            ariaLabel={`Reconnect ${account.name}`}
            variant={primary ? "primary" : "secondary"}
          />
        ) : (
          <SyncButton
            socialAccountId={account.id}
            label={state.kind === "sync_problem" ? "Try again" : "Sync now"}
            disabled={state.kind === "syncing" || state.kind === "rate_limited"}
            describedBy={message ? messageId : undefined}
          />
        )}
      </ActionRow>
    </>
  );
}

/** The state's action on the left, the overflow menu and its Disconnect sheet on the right. */
function ActionRow({
  account,
  children,
}: {
  account: AccountCardView;
  children: ReactNode;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const opening = useRef(false);
  const disconnected = useRef(false);

  const disconnect = () =>
    startTransition(async () => {
      setError(null);
      const result = await disconnectAccount({ socialAccountId: account.id });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      disconnected.current = true;
      toast(disconnectedToast(account.name));
      setSheetOpen(false);
    });

  const sentence = liveVideosSentence(account.liveVideoCount, account.name);
  const instagram = account.platform === "instagram";
  return (
    <div className="flex items-center justify-between gap-3">
      {children}
      <Menu>
        <MenuTrigger asChild>
          <Button
            ref={menuTrigger}
            size="icon"
            aria-label={`More for ${account.name}`}
          >
            <Ellipsis aria-hidden />
          </Button>
        </MenuTrigger>
        <MenuContent
          onCloseAutoFocus={(event) => {
            // The sheet takes the focus it opens with.
            if (opening.current) event.preventDefault();
            opening.current = false;
          }}
        >
          <MenuItem asChild>
            <Link href={`/dashboard/library?account=${account.id}`}>
              Open in Library
            </Link>
          </MenuItem>
          <MenuItem
            onSelect={() => {
              opening.current = true;
              setError(null);
              setSheetOpen(true);
            }}
          >
            Disconnect…
          </MenuItem>
        </MenuContent>
      </Menu>
      <ConfirmSheet
        open={sheetOpen}
        onOpenChange={(open) => {
          if (!pending) setSheetOpen(open);
        }}
        title={disconnectTitle(account.name)}
        description={
          sentence ?? (instagram ? INSTAGRAM_DISCONNECT_NOTE : undefined)
        }
        confirmLabel="Disconnect"
        confirmLoading={pending}
        confirmLoadingLabel="Disconnecting…"
        onConfirm={(event) => {
          event.preventDefault();
          disconnect();
        }}
        cancelLabel="Keep connected"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          // The card is gone after a disconnect: the page title takes the focus; otherwise the menu button gets it back.
          const target = disconnected.current
            ? document.getElementById(account.focusAfterRemove)
            : menuTrigger.current;
          target?.focus();
        }}
      >
        {sentence && instagram ? (
          <p className="mt-3 text-body text-ink">{INSTAGRAM_DISCONNECT_NOTE}</p>
        ) : null}
        {account.platform === "youtube" ? (
          <Button asChild variant="link" size="sm" className="mt-3">
            <a
              href={GOOGLE_PERMISSIONS_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Manage access in your Google account (opens in a new tab)"
            >
              Manage access in your Google account ↗
            </a>
          </Button>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 text-callout text-danger-text">
            {error}
          </p>
        ) : null}
      </ConfirmSheet>
    </div>
  );
}
