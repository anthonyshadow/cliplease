// Tabs tell each other which videos they are uploading (owner answer Q-49): a second tab on the same video shows "This
// video is uploading in another tab." instead of offering to pick, resume or cancel it. BroadcastChannel where the
// browser has it; without it, every tab acts alone. Browser only.
import { useSyncExternalStore } from "react";

const CHANNEL = "cliplease.uploads";
const HEARTBEAT_MS = 2000;
// A tab that stops answering (crashed, or frozen by the browser) stops counting after this. A background tab's timers
// slow to once a minute, so the watching tab asks every second and the uploading tab answers from its message handler,
// which isn't throttled; a closing tab says so itself (pagehide).
const STALE_MS = 6000;
const ASK_MS = 1000;

type Message =
  | { type: "live"; tab: string; videoIds: string[] }
  | { type: "ask" };

const tab = Math.random().toString(36).slice(2);
let channel: BroadcastChannel | null = null;
let mine: string[] = [];
let heartbeat: ReturnType<typeof setInterval> | null = null;
let sweep: ReturnType<typeof setInterval> | null = null;
const others = new Map<string, { videoIds: string[]; at: number }>();
const listeners = new Set<() => void>();
const observers = new Set<(videoIds: string[]) => void>();
let busy = "";

function recompute() {
  const now = Date.now();
  const ids = new Set<string>();
  for (const [id, seen] of others) {
    if (now - seen.at > STALE_MS) others.delete(id);
    else for (const videoId of seen.videoIds) ids.add(videoId);
  }
  const next = [...ids].sort().join(" ");
  if (next !== busy) {
    busy = next;
    for (const listener of listeners) listener();
  }
  // Asking every tab every second costs them all, so only while a File step watches another tab's uploads.
  if (listeners.size > 0 && others.size > 0) {
    sweep ??= setInterval(() => {
      post({ type: "ask" });
      recompute();
    }, ASK_MS);
  } else if (sweep) {
    clearInterval(sweep);
    sweep = null;
  }
}

function post(message: Message) {
  try {
    channel?.postMessage(message);
  } catch {
    // A closed channel: this tab just stops telling.
  }
}

function open(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === "undefined") return channel;
  channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event: MessageEvent<Message>) => {
    const message = event.data;
    if (message?.type === "ask") {
      if (mine.length > 0) post({ type: "live", tab, videoIds: mine });
      return;
    }
    if (message?.type !== "live" || message.tab === tab) return;
    if (message.videoIds.length === 0) {
      others.delete(message.tab);
      recompute();
      return;
    }
    others.set(message.tab, { videoIds: message.videoIds, at: Date.now() });
    recompute();
    for (const observer of observers) observer(message.videoIds);
  };
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => {
      if (mine.length > 0) post({ type: "live", tab, videoIds: [] });
    });
    window.addEventListener("pageshow", (event) => {
      if (event.persisted && mine.length > 0) {
        post({ type: "live", tab, videoIds: mine });
      }
    });
  }
  return channel;
}

/** This tab's running uploads, told to the others now and every HEARTBEAT_MS while there are any. */
export function announceUploads(videoIds: string[]) {
  const next = [...videoIds].sort();
  if (next.join(" ") === mine.join(" ")) return;
  const had = mine.length > 0;
  mine = next;
  if (!open()) return;
  // An empty list is told once, so the others stop waiting at once.
  if (mine.length > 0 || had) post({ type: "live", tab, videoIds: mine });
  if (mine.length > 0 && !heartbeat) {
    heartbeat = setInterval(
      () => post({ type: "live", tab, videoIds: mine }),
      HEARTBEAT_MS,
    );
  } else if (mine.length === 0 && heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
}

/** Every non-empty list another tab tells (its beats, its answers to any tab's ask), heard without asking. */
export function onOtherTabUploads(
  listener: (videoIds: string[]) => void,
): () => void {
  if (typeof window === "undefined" || !open()) return () => {};
  observers.add(listener);
  return () => {
    observers.delete(listener);
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Nothing swept while nobody watched: drop the tabs that went quiet, and ask every second while one is left.
  recompute();
  // Ask the tabs already uploading, so this one knows without waiting for a heartbeat.
  if (open()) post({ type: "ask" });
  return () => {
    listeners.delete(listener);
    recompute();
  };
}

// A File step renders before it subscribes: with nobody watching yet, drop the tabs that went quiet first.
function snapshot() {
  if (listeners.size === 0) recompute();
  return busy;
}

/** Another tab of this browser is uploading `videoId`'s original right now. False on the server. */
export function useUploadElsewhere(videoId: string): boolean {
  const ids = useSyncExternalStore(subscribe, snapshot, () => "");
  return ids.split(" ").includes(videoId);
}
