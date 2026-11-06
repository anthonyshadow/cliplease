"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { PRIMARY_WIDTH } from "@/components/ui/primary-width";
import { useFocusAfterRender } from "@/components/ui/use-focus-after-render";
import { useFocusOnRemove } from "@/components/ui/use-focus-on-remove";
import { usePendingAction } from "@/components/ui/use-pending-action";
import { formatDuration } from "@/lib/format";
import { CHECKOUT_COPY } from "@/lib/licensing/checkout-copy";
import {
  type CheckoutHoldTimes,
  checkoutHoldPhase,
  type ExtendHoldResult,
} from "@/lib/licensing/checkout-hold";
import { REQUEST_STATUS_COPY } from "@/lib/licensing/request-status";
import { type ActionResult, GENERIC_ERROR_MESSAGE } from "@/lib/result";

const COPY = CHECKOUT_COPY;

const TICK_MS = 1000;

/** How long a release still on its way gets before the row is read again. */
const LATE_RELEASE_MS = 5000;

/** The line under each phase's clock. */
const PHASE_LINE = {
  ending: COPY.holdEnding,
  lapsed: COPY.holdEnded,
  ended: COPY.sessionEnded,
} as const;

/** Extend's refusals that end this page: the line that replaces the clock. */
const REFUSAL_LINE = {
  taken: COPY.holdTaken,
  session_ended: COPY.sessionEnded,
  video_unavailable: REQUEST_STATUS_COPY.unavailableBody,
} as const;

/**
 * Every `now` a clock has received, adopted or not. The router restores a cached page on Back and Forward with an old
 * `now`, so a mount with one it has seen isn't fresh (AD-74 b).
 */
const seenNows = new Set<string>();

const phaseAt = (times: CheckoutHoldTimes, nowMs: number) =>
  checkoutHoldPhase(
    {
      holdUntil: new Date(times.holdUntil),
      sessionEndsAt: new Date(times.sessionEndsAt),
    },
    new Date(nowMs),
  );

/** `use` on this tab's storage, or `blocked` when the browser refuses it. Reading the storage can itself throw. */
function withSession<T>(use: (storage: Storage) => T, blocked: T): T {
  try {
    return use(window.sessionStorage);
  } catch {
    return blocked;
  }
}

/** Remembers that the page let go on leaving. With storage blocked it can't: the buyer returns to the lapsed state, whose Extend covers it. */
const markLeft = (flag: string) =>
  withSession((storage) => storage.setItem(flag, "1"), undefined);

/** Whether markLeft can work here. */
const canMarkLeft = (flag: string) =>
  withSession((storage) => {
    storage.setItem(flag, "1");
    storage.removeItem(flag);
    return true;
  }, false);

/** Whether the page let go on leaving. */
const hasLeft = (flag: string) =>
  withSession((storage) => storage.getItem(flag) !== null, false);

/** Whether the page let go on leaving; clears the mark. */
const takeLeft = (flag: string) =>
  withSession((storage) => {
    if (storage.getItem(flag) === null) return false;
    storage.removeItem(flag);
    return true;
  }, false);

/** Pay, while the hold runs. Taken away with the focus on it, the focus stays at the clock: from there Tab reaches Extend. */
function PayWhileHeld({
  clockId,
  children,
}: {
  clockId: string;
  children: ReactNode;
}) {
  const box = useFocusOnRemove<HTMLDivElement>(clockId);
  return <div ref={box}>{children}</div>;
}

/**
 * The payment page's unpaid hold (owner answers Q-170, Q-175, Q-176; AD-74): a sticky clock that stays in view, the warning
 * and Extend in the last minute and after zero, and Pay (`children`) only while the hold runs. Ticks from the server's
 * `now`, so a wrong device clock doesn't matter and the first render matches the server's. Leaving a running hold (closing,
 * reloading, Back) lets it go and marks it; coming back to the mark extends it, under the video's lock, if the video is
 * still free. A lapsed page, or a restored one with no mark, holds nothing until Extend is pressed or a newer read says it
 * does. Built for P25's Embedded page to reuse.
 */
export function CheckoutHoldClock({
  holdUntil,
  sessionEndsAt,
  now,
  extend,
  releaseUrl,
  licensePath,
  children,
}: {
  holdUntil: string;
  sessionEndsAt: string;
  now: string;
  extend: () => Promise<ActionResult<ExtendHoldResult>>;
  releaseUrl: string;
  licensePath: string;
  /** Pay. */
  children: ReactNode;
}) {
  const router = useRouter();
  const flag = `cliplease.checkout-hold.released.${releaseUrl}`;
  const [times, setTimes] = useState<CheckoutHoldTimes>({
    holdUntil,
    sessionEndsAt,
    now,
  });
  const [nowMs, setNowMs] = useState(() => Date.parse(now));
  const [refusal, setRefusal] = useState<keyof typeof REFUSAL_LINE | null>(
    null,
  );
  const [live, setLive] = useState("");
  const [failed, setFailed] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [ready, setReady] = useState(false);
  // A page the router restored with nothing to come back to: its times are old, so it holds nothing until a newer read or
  // Extend's answer replaces them (AD-74 b). The Set is empty at hydration, so the server's render and the first match.
  const [restoredNow] = useState(() =>
    seenNows.has(now) && !hasLeft(flag) ? now : null,
  );
  const [pending, run] = usePendingAction();
  const clockId = useId();
  const block = useRef<HTMLDivElement>(null);
  const lateRelease = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The pressed button may be gone: Extend if it stays, the back link on a refusal, else Pay.
  const focusAfterPress = useFocusAfterRender(
    () =>
      block.current?.querySelector<HTMLElement>("button, a") ??
      block.current?.nextElementSibling?.querySelector<HTMLElement>("button"),
  );
  const { phase, secondsLeft, canExtend } = phaseAt(times, nowMs);
  const holding =
    !refusal &&
    times.now !== restoredNow &&
    (phase === "held" || phase === "ending");

  /** `pressed` false is a return to a page that let go: it takes the times silently, and speaks only a refusal. */
  async function callExtend(pressed: boolean) {
    setFailed(false);
    const result = await run(extend);
    setResuming(false);
    if (!result) return;
    if (!result.ok) {
      setFailed(pressed);
      return;
    }
    const answer = result.data;
    if ("now" in answer) {
      setTimes(answer);
      setNowMs(Date.parse(answer.now));
      if (pressed) {
        const left = phaseAt(answer, Date.parse(answer.now)).secondsLeft;
        setLive(COPY.holdClock(formatDuration(left)));
      } else if (!answer.ok) {
        // The hold hadn't gone, so this page's release is still on its way and will cut these times: read the row after.
        clearTimeout(lateRelease.current);
        lateRelease.current = setTimeout(
          () => router.refresh(),
          LATE_RELEASE_MS,
        );
      }
    } else if (answer.reason === "not_pending") {
      // Paid or ended meanwhile: the page redirects to /r.
      router.refresh();
      return;
    } else {
      setRefusal(answer.reason);
      setLive(REFUSAL_LINE[answer.reason]);
    }
    if (pressed) focusAfterPress();
  }

  // What the listeners read when they fire: they attach once.
  const latest = useRef({ holding, callExtend, router });
  latest.current = { holding, callExtend, router };

  // A read from before Extend's update has an earlier `now`, so a refresh can't overwrite its answer; and while the call
  // runs the read waits, so a return to a page that let go doesn't flash the old hold and take Pay away.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current && seenNows.has(now)) router.refresh();
    mounted.current = true;
    seenNows.add(now);
    if (!pending && Date.parse(now) > Date.parse(times.now)) {
      setTimes({ holdUntil, sessionEndsAt, now });
      setNowMs(Date.parse(now));
    }
  }, [holdUntil, sessionEndsAt, now, times.now, pending, router]);

  const offset = useRef(0);
  const tick = useCallback(() => setNowMs(Date.now() + offset.current), []);
  useEffect(() => {
    offset.current = Date.parse(times.now) - Date.now();
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [times.now, tick]);

  // The live region speaks only on a move: nothing at load, the warning once on the way into the last minute.
  const lastPhase = useRef(phase);
  useEffect(() => {
    const from = lastPhase.current;
    lastPhase.current = phase;
    if (from === phase) return;
    if (phase === "held") setFailed(false);
    if (refusal || resuming) return;
    if (
      phase === "lapsed" ||
      phase === "ended" ||
      (phase === "ending" && from === "held")
    ) {
      setLive(PHASE_LINE[phase]);
    }
  }, [phase, refusal, resuming]);

  useEffect(() => {
    const resume = () => {
      if (!takeLeft(flag)) return false;
      setResuming(true);
      latest.current.callExtend(false);
      return true;
    };
    // Only while the hold runs (AD-74 h). Never on visibilitychange, so switching to a banking app doesn't release.
    const leave = () => {
      if (!latest.current.holding) return;
      markLeft(flag);
      navigator.sendBeacon(releaseUrl);
    };
    // A client traversal fires no pagehide (AD-74 a). If Back's page has to be fetched the router still shows this one,
    // and Forward can land in that wait: that's a return, not another leave.
    const ownPath = window.location.pathname;
    const traversal = () => {
      if (window.location.pathname === ownPath) resume();
      else leave();
    };
    const sync = () => {
      tick();
      latest.current.router.refresh();
    };
    // A page restored from the back/forward cache doesn't remount.
    const show = (event: PageTransitionEvent) => {
      if (!resume() && event.persisted) sync();
    };
    const visible = () => {
      if (document.visibilityState === "visible") sync();
    };
    window.addEventListener("pagehide", leave);
    window.addEventListener("popstate", traversal);
    window.addEventListener("pageshow", show);
    document.addEventListener("visibilitychange", visible);
    resume();
    // No mark can tell a reload that its read came before the old page's release, so read the row again after it.
    if (!canMarkLeft(flag)) {
      lateRelease.current = setTimeout(
        () => latest.current.router.refresh(),
        LATE_RELEASE_MS,
      );
    }
    setReady(true);
    return () => {
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("pageshow", show);
      document.removeEventListener("visibilitychange", visible);
      clearTimeout(lateRelease.current);
      // Next task, not now: React renders the router's popstate transition in the microtask after the router's listener,
      // so this cleanup can run in the middle of the very event `traversal` is waiting for.
      setTimeout(() => window.removeEventListener("popstate", traversal));
    };
  }, [flag, releaseUrl, tick]);

  // A released row's first paint is the clock alone, so a reload doesn't flash the ended line (AD-74 f).
  const line =
    resuming || phase === "held" || (phase === "lapsed" && !ready)
      ? null
      : PHASE_LINE[phase];

  return (
    <>
      <div
        ref={block}
        id={clockId}
        tabIndex={-1}
        data-hold-ready={ready || undefined}
        className="sticky top-2 bottom-2 z-10 flex flex-col gap-3 rounded-md border border-hairline bg-surface p-4"
      >
        {refusal ? (
          <p className="text-callout text-ink">{REFUSAL_LINE[refusal]}</p>
        ) : (
          <>
            {phase === "ended" ? null : (
              <p
                role="timer"
                className="text-callout font-semibold text-ink tabular-nums"
              >
                {COPY.holdClock(formatDuration(secondsLeft))}
              </p>
            )}
            {line ? <p className="text-callout text-ink">{line}</p> : null}
            {canExtend && ready ? (
              <Button
                variant="secondary"
                className={PRIMARY_WIDTH}
                loading={pending}
                loadingLabel={COPY.holdExtending}
                onClick={() => callExtend(true)}
              >
                {COPY.holdExtend}
              </Button>
            ) : null}
            {failed && canExtend ? (
              <p role="alert" className="text-footnote text-danger-text">
                {GENERIC_ERROR_MESSAGE}
              </p>
            ) : null}
          </>
        )}
        {refusal || phase === "ended" ? (
          <Button asChild variant="secondary" className={PRIMARY_WIDTH}>
            <Link href={licensePath}>{REQUEST_STATUS_COPY.backToLicense}</Link>
          </Button>
        ) : null}
        <p aria-live="polite" data-hold-live className="sr-only">
          {live}
        </p>
      </div>
      {holding ? (
        <PayWhileHeld clockId={clockId}>{children}</PayWhileHeld>
      ) : null}
    </>
  );
}
