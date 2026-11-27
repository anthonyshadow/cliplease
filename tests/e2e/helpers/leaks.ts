import type {
  BrowserContext,
  CDPSession,
  Page,
  Request,
} from "@playwright/test";

// What a browser context was sent, for the safety checks (P22: S5 no mock social token, S7 no storage key or signed
// URL in a buyer's pages): the text of every page, JSON and RSC body. A leak names its URL and pattern, never the text.
//
// Chromium keeps a page's response bodies in its renderer: none for a load that failed, and none of a document's once
// the next one commits. Playwright's response.text() there misses every fetch Next's router cancels once it has what it
// needs (a prefetch cut at its static stage, an RSC navigation superseded by the next keystroke or click, a server
// action's redirect) and any body read after the page moved on (the OTP sign-in's JSON, by the time /onboarding has
// committed). So on Chromium each watched page gets a CDP session of its own whose bodies are kept in the browser
// process (Network.configureDurableMessages: they survive the navigation, and a cancelled load keeps what it received),
// each read with Network.getResponseBody when its load ends. Observation only: the page loads and streams as it would.
// WebKit keeps them, so there it stays response.text().

/** A body the context received: its URL and its text (the part received, for a load that was cancelled). */
export type RecordedBody = { url: string; text: string };

/** What a context received, once every load has ended (watchBodies). */
export type WatchedBodies = {
  /** Every body read, a cancelled load's received part included. */
  bodies: RecordedBody[];
  /** The URL of each load that failed or was cancelled after its response began. */
  failed: string[];
  /** The URL of each response whose body couldn't be read although its load didn't fail. */
  unread: string[];
};

/** A context's bodies, read as they arrive (watchBodies). */
export type BodyWatch = {
  /** A new page of the context, watched from before its first request: open every watched page through this. */
  newPage(): Promise<Page>;
  /** What the context received. A load the page left open ends only when its context closes: close it first. */
  settled(): Promise<WatchedBodies>;
};

/** A mock social token's prefix (S5): no page body or server log line may hold one. */
export const MOCK_TOKEN = /mock_access_|mock_refresh_/;

/** text/html, application/json and text/x-component (React Server Components payloads), any parameters after. */
const RECORDED_TYPE = /^(text\/html|application\/json|text\/x-component)\b/i;

/** The browser-side body store of a Chromium page (bytes): ample for a demo's pages, chunks, posters and files. */
const DURABLE_BUFFERS = {
  maxTotalBufferSize: 256 * 1024 * 1024,
  maxResourceBufferSize: 32 * 1024 * 1024,
};

/** A RECORDED_TYPE body that isn't a redirect's (a 3xx's Location is no page body: the download route's 302). */
function isRecorded(status: number, contentType: string | undefined): boolean {
  return (
    (status < 300 || status >= 400) && RECORDED_TYPE.test(contentType ?? "")
  );
}

/** A header's value by its name in any case (CDP keeps the server's case). */
function header(headers: Record<string, string>, name: string) {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key === undefined ? undefined : headers[key];
}

/** One recorded response: its URL, its text once its load ended (null: unreadable), and whether the load failed. */
type Capture = { url: string; text: Promise<string | null>; failed(): boolean };

/**
 * Chromium: records into `captures` every RECORDED_TYPE response `session`'s page gets from now on, its body read from
 * the durable store when its load finishes or fails. A load still open when the page closes counts as failed.
 */
async function recordDurably(session: CDPSession, captures: Capture[]) {
  const open = new Map<string, (failed: boolean) => void>();
  session.on("Network.responseReceived", ({ requestId, response }) => {
    if (!isRecorded(response.status, header(response.headers, "content-type")))
      return;
    let failed = false;
    let resolve: (text: Promise<string | null>) => void = () => {};
    const text = new Promise<string | null>((r) => {
      resolve = r;
    });
    captures.push({ url: response.url, text, failed: () => failed });
    open.set(requestId, (loadFailed) => {
      open.delete(requestId);
      failed = loadFailed;
      resolve(
        session.send("Network.getResponseBody", { requestId }).then(
          ({ body, base64Encoded }) =>
            base64Encoded ? Buffer.from(body, "base64").toString("utf8") : body,
          () => null,
        ),
      );
    });
  });
  session.on("Network.loadingFinished", ({ requestId }) => {
    open.get(requestId)?.(false);
  });
  session.on("Network.loadingFailed", ({ requestId }) => {
    open.get(requestId)?.(true);
  });
  session.on("close", () => {
    for (const end of open.values()) end(true);
  });
  await session.send("Network.configureDurableMessages", DURABLE_BUFFERS);
  await session.send("Network.enable");
}

/**
 * Records the text of every RECORDED_TYPE response `context` gets from now on that isn't a redirect. On Chromium a
 * response Playwright saw that no page's session did (a page not opened through newPage) counts as unread.
 */
export function watchBodies(context: BrowserContext): BodyWatch {
  const captures: Capture[] = [];
  const chromium = context.browser()?.browserType().name() === "chromium";
  /** Chromium: each page's session, once recording. */
  const sessions = new Map<Page, Promise<void>>();
  /** Chromium: Playwright's own count of recorded responses per URL, the sessions' check. */
  const seen = new Map<string, number>();
  const failedRequests = new Set<Request>();

  const record = (page: Page) => {
    let recording = sessions.get(page);
    if (recording === undefined) {
      recording = context
        .newCDPSession(page)
        .then((session) => recordDurably(session, captures));
      sessions.set(page, recording);
    }
    return recording;
  };
  if (chromium) context.on("page", (page) => void record(page));

  context.on("requestfailed", (request) => {
    failedRequests.add(request);
  });
  context.on("response", (response) => {
    if (!isRecorded(response.status(), response.headers()["content-type"]))
      return;
    const url = response.url();
    if (chromium) {
      seen.set(url, (seen.get(url) ?? 0) + 1);
      return;
    }
    const request = response.request();
    captures.push({
      url,
      text: response.text().catch(() => null),
      failed: () => failedRequests.has(request),
    });
  });

  return {
    async newPage() {
      const page = await context.newPage();
      if (chromium) await record(page);
      return page;
    },
    async settled() {
      await Promise.all(sessions.values());
      const result: WatchedBodies = { bodies: [], failed: [], unread: [] };
      const recorded = new Map<string, number>();
      for (const { url, text: read, failed } of captures) {
        const text = await read;
        recorded.set(url, (recorded.get(url) ?? 0) + 1);
        if (text !== null) result.bodies.push({ url, text });
        if (failed()) result.failed.push(url);
        else if (text === null) result.unread.push(url);
      }
      for (const [url, count] of seen) {
        for (let n = recorded.get(url) ?? 0; n < count; n += 1) {
          result.unread.push(url);
        }
      }
      return result;
    },
  };
}

/** A pattern's name in a finding: a string as given, a RegExp's source. */
const patternName = (pattern: string | RegExp) =>
  typeof pattern === "string" ? pattern : pattern.source;

/**
 * Each (URL, pattern) pair where a body matches a pattern (a string as a substring, a RegExp anywhere), once per pair;
 * never the matched text.
 */
export function findLeaks(
  bodies: readonly RecordedBody[],
  patterns: readonly (string | RegExp)[],
): { url: string; pattern: string }[] {
  const found = new Map<string, { url: string; pattern: string }>();
  for (const { url, text } of bodies) {
    for (const pattern of patterns) {
      const hit =
        typeof pattern === "string"
          ? text.includes(pattern)
          : text.search(pattern) !== -1;
      if (!hit) continue;
      const name = patternName(pattern);
      found.set(`${url}\n${name}`, { url, pattern: name });
    }
  }
  return [...found.values()];
}
