// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHECKOUT_COPY } from "@/lib/licensing/checkout-copy";
import type {
  CheckoutHoldTimes,
  ExtendHoldResult,
} from "@/lib/licensing/checkout-hold";
import { REQUEST_STATUS_COPY } from "@/lib/licensing/request-status";
import { type ActionResult, GENERIC_ERROR_MESSAGE } from "@/lib/result";
import { HOUR_MS } from "@/lib/time";
import { CheckoutHoldClock } from "./checkout-hold-clock";

const COPY = CHECKOUT_COPY;

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", async (actual) => ({
  ...(await actual<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: mocks.refresh }),
}));

const CHECKOUT_PATH = "/dev/fake-checkout/6f4c8d7e";
const RELEASE_URL = `${CHECKOUT_PATH}/release`;
const LICENSE_PATH = "/@maya/first-snow";
const FLAG = `cliplease.checkout-hold.released.${RELEASE_URL}`;

/** The device's clock, far from the server's: only the time passing on it may matter. */
const DEVICE_START = Date.parse("2031-03-04T05:06:07.000Z");

let lastNow = Date.parse("2026-11-06T12:00:00.000Z");
/** A server `now` no test has used: the clock's record of them lasts as long as the module. */
const nextNow = () => {
  lastNow += HOUR_MS;
  return lastNow;
};

const iso = (ms: number) => new Date(ms).toISOString();

/** The times at `at`: the hold `hold` seconds away, the session `session` seconds away. */
const timesAt = (at: number, hold: number, session = 3000) => ({
  holdUntil: iso(at + hold * 1000),
  sessionEndsAt: iso(at + session * 1000),
  now: iso(at),
});
const freshTimes = (hold: number, session?: number) =>
  timesAt(nextNow(), hold, session);

type Answer = ActionResult<ExtendHoldResult>;
const granted = (times: CheckoutHoldTimes): Answer => ({
  ok: true,
  data: { ok: true, ...times },
});
const refusedWith = (
  reason: "not_pending" | "session_ended" | "video_unavailable" | "taken",
): Answer => ({ ok: true, data: { ok: false, reason } });
const extendAnswering = (answer: Answer) => vi.fn(async () => answer);
const neverCalled = () => vi.fn<() => Promise<Answer>>();

const clock = (
  times: CheckoutHoldTimes,
  extend: () => Promise<Answer> = neverCalled(),
) => (
  <CheckoutHoldClock
    {...times}
    extend={extend}
    releaseUrl={RELEASE_URL}
    licensePath={LICENSE_PATH}
  >
    <form>
      <button type="submit">Pay</button>
    </form>
  </CheckoutHoldClock>
);

const timer = () => screen.queryByRole("timer");
const clockReads = (time: string) =>
  expect(timer()?.textContent).toBe(COPY.holdClock(time));
const pay = () => screen.queryByRole("button", { name: "Pay" });
const extendButton = () =>
  screen.queryByRole("button", { name: COPY.holdExtend });
const backLink = () =>
  screen.queryByRole("link", { name: REQUEST_STATUS_COPY.backToLicense });
const liveText = () =>
  document.querySelector("[data-hold-live]")?.textContent ?? null;
/** The line as the block shows it: the live region can say the same words. */
const shownLine = (text: string) =>
  screen
    .queryAllByText(text)
    .filter((element) => !element.hasAttribute("data-hold-live"));

const advance = (seconds: number) =>
  act(() => {
    vi.advanceTimersByTime(seconds * 1000);
  });
const pressExtend = () =>
  act(async () => {
    const button = extendButton();
    if (!button) throw new Error("no Extend button");
    fireEvent.click(button);
  });
const mount = (times: CheckoutHoldTimes, extend?: () => Promise<Answer>) =>
  act(async () => render(clock(times, extend)));

/** Leaving as the browser does it: a traversal moves the location first, then fires popstate. */
const leaveBy = (type: "pagehide" | "popstate") =>
  act(() => {
    if (type === "popstate") {
      window.history.replaceState(null, "", LICENSE_PATH);
    }
    window.dispatchEvent(new Event(type));
  });
/** Forward to a clock the router hasn't unmounted yet: the location is the page's own again. */
const comeBack = () =>
  act(async () => {
    window.history.replaceState(null, "", CHECKOUT_PATH);
    window.dispatchEvent(new Event("popstate"));
  });
const dispatchPageshow = (persisted: boolean) =>
  act(async () => {
    window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted }));
  });
const dispatchVisibility = () =>
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
const blockStorage = () =>
  vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
    throw new Error("blocked");
  });

/** The unmounted clock's popstate listener goes in the next task. */
const nextTask = () => new Promise((resolve) => setTimeout(resolve));

const FAKED = ["Date", "setInterval", "clearInterval"] as const;
/** For a test that waits on the clock's own timeout. */
const fakeTimeoutsToo = () =>
  vi.useFakeTimers({
    now: DEVICE_START,
    toFake: [...FAKED, "setTimeout", "clearTimeout"],
  });

/** The flag as it stood when the beacon went: the flag must come first. */
let flagAtBeacon: string | null | undefined;
const beacon = vi.fn((_url: string) => {
  flagAtBeacon = sessionStorage.getItem(FLAG);
  return true;
});

beforeEach(() => {
  flagAtBeacon = undefined;
  window.history.replaceState(null, "", CHECKOUT_PATH);
  vi.useFakeTimers({ now: DEVICE_START, toFake: [...FAKED] });
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    value: beacon,
  });
});
afterEach(async () => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  await nextTask();
  vi.restoreAllMocks();
  mocks.refresh.mockReset();
  beacon.mockClear();
  sessionStorage.clear();
});

const expectNoLeave = () => {
  expect(beacon).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(FLAG)).toBeNull();
};

describe("CheckoutHoldClock's clock", () => {
  it("first renders the server's now, whatever the device's clock says", () => {
    render(clock(freshTimes(572)));
    clockReads("9:32");
  });

  it("ticks each second from there", () => {
    render(clock(freshTimes(572)));
    advance(1);
    clockReads("9:31");
    advance(60);
    clockReads("8:31");
  });

  it("is a timer, and the live region is empty at load in every phase", () => {
    for (const hold of [300, 30, -1]) {
      render(clock(freshTimes(hold)));
      expect(timer()).not.toBeNull();
      expect(timer()?.getAttribute("aria-live")).toBeNull();
      expect(liveText()).toBe("");
      cleanup();
    }
  });
});

describe("what each phase shows", () => {
  it.each([
    ["held", 300, true],
    ["ending", 30, true],
    ["lapsed", -1, false],
    ["ended", -60, false],
  ] as const)("%s: Pay only while the hold runs", (phase, hold, payShown) => {
    render(clock(freshTimes(hold, phase === "ended" ? -1 : 3000)));
    expect(pay() !== null).toBe(payShown);
  });

  it("held: the clock alone, no line and no Extend", () => {
    render(clock(freshTimes(300)));
    expect(extendButton()).toBeNull();
    expect(shownLine(COPY.holdEnding)).toEqual([]);
    expect(shownLine(COPY.holdEnded)).toEqual([]);
    expect(backLink()).toBeNull();
  });

  it("ending: the warning and Extend, beside Pay", () => {
    render(clock(freshTimes(30)));
    expect(shownLine(COPY.holdEnding)).toHaveLength(1);
    expect(extendButton()).not.toBeNull();
    expect(pay()).not.toBeNull();
  });

  it("lapsed: 0:00, the ended line and Extend", () => {
    render(clock(freshTimes(-1)));
    clockReads("0:00");
    expect(shownLine(COPY.holdEnded)).toHaveLength(1);
    expect(extendButton()).not.toBeNull();
  });

  it("ended: the window's line and the way back, with no clock and no Extend", () => {
    render(clock(freshTimes(-60, -1)));
    expect(timer()).toBeNull();
    expect(shownLine(COPY.sessionEnded)).toHaveLength(1);
    expect(extendButton()).toBeNull();
    expect(backLink()?.getAttribute("href")).toBe(LICENSE_PATH);
  });

  it("at the cap: the warning, and no Extend", () => {
    render(clock(freshTimes(30, 30)));
    expect(shownLine(COPY.holdEnding)).toHaveLength(1);
    expect(extendButton()).toBeNull();
    expect(pay()).not.toBeNull();
  });

  it("the server's first paint of a lapsed row is the clock alone; the line, Extend and data-hold-ready come at mount", () => {
    const times = freshTimes(-1);
    const html = renderToString(clock(times));
    expect(html).toContain('role="timer"');
    expect(html).toContain(COPY.holdClock("0:00"));
    expect(html).not.toContain(COPY.holdEnded);
    expect(html).not.toContain(COPY.holdExtend);
    expect(html).not.toContain("data-hold-ready");

    const { container } = render(clock(times));
    expect(shownLine(COPY.holdEnded)).toHaveLength(1);
    expect(extendButton()).not.toBeNull();
    expect(container.querySelector("[data-hold-ready]")).not.toBeNull();
  });
});

describe("the live region", () => {
  it("warns once on the way from held into the last minute", () => {
    render(clock(freshTimes(62)));
    expect(liveText()).toBe("");
    advance(2);
    expect(liveText()).toBe(COPY.holdEnding);
    expect(shownLine(COPY.holdEnding)).toHaveLength(1);
    expect(extendButton()).not.toBeNull();
    const speech = new MutationObserver(() => {});
    speech.observe(document.querySelector("[data-hold-live]") as Node, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    advance(10);
    expect(speech.takeRecords()).toEqual([]);
    speech.disconnect();
    expect(liveText()).toBe(COPY.holdEnding);
  });

  it("says nothing when the page opens already in the last minute", () => {
    render(clock(freshTimes(30)));
    advance(5);
    expect(liveText()).toBe("");
  });

  it("gives no warning coming out of a lapse into the last minute: it says the new value", async () => {
    const at = nextNow();
    await mount(
      timesAt(at, -1, 90),
      extendAnswering(granted(timesAt(at + 1_000, 50, 89))),
    );
    await pressExtend();
    expect(liveText()).toBe(COPY.holdClock("0:50"));
  });

  it("says the ended line on a lapse, and Pay goes", () => {
    render(clock(freshTimes(2)));
    expect(pay()).not.toBeNull();
    advance(3);
    expect(liveText()).toBe(COPY.holdEnded);
    expect(shownLine(COPY.holdEnded)).toHaveLength(1);
    expect(pay()).toBeNull();
    expect(extendButton()).not.toBeNull();
  });

  it("says the window's line when the session ends while the page is open", () => {
    render(clock(freshTimes(2, 2)));
    advance(3);
    expect(liveText()).toBe(COPY.sessionEnded);
    expect(pay()).toBeNull();
    expect(backLink()).not.toBeNull();
  });
});

describe("pressing Extend", () => {
  it("moves the clock on from the answer, brings Pay back, moves focus to it and speaks the new value", async () => {
    const at = nextNow();
    const answerAt = at + 5_000;
    await mount(
      timesAt(at, -1),
      extendAnswering(granted(timesAt(answerAt, 600))),
    );
    expect(pay()).toBeNull();
    await pressExtend();
    clockReads("10:00");
    expect(pay()).not.toBeNull();
    expect(extendButton()).toBeNull();
    expect(document.activeElement).toBe(pay());
    expect(liveText()).toBe(COPY.holdClock("10:00"));
    advance(1);
    clockReads("9:59");
    expect(liveText()).toBe(COPY.holdClock("10:00"));
  });

  it("keeps the focus on Extend when an extension still leaves it there", async () => {
    const at = nextNow();
    await mount(
      timesAt(at, 30, 90),
      extendAnswering(granted(timesAt(at + 1_000, 50, 89))),
    );
    await pressExtend();
    expect(document.activeElement).toBe(extendButton());
    clockReads("0:50");
  });

  it.each([["too_early"], ["at_limit"]] as const)(
    "%s takes the answer's times",
    async (reason) => {
      const at = nextNow();
      const times = timesAt(at + 1_000, 45);
      await mount(
        timesAt(at, 30),
        extendAnswering({ ok: true, data: { ok: false, reason, ...times } }),
      );
      await pressExtend();
      clockReads("0:45");
      expect(pay()).not.toBeNull();
      advance(1);
      clockReads("0:44");
    },
  );

  it.each([
    ["taken", COPY.holdTaken],
    ["session_ended", COPY.sessionEnded],
    ["video_unavailable", REQUEST_STATUS_COPY.unavailableBody],
  ] as const)(
    "%s: its line and the way back, in place of the clock and Pay",
    async (reason, line) => {
      await mount(freshTimes(30), extendAnswering(refusedWith(reason)));
      await pressExtend();
      expect(shownLine(line)).toHaveLength(1);
      expect(liveText()).toBe(line);
      expect(backLink()?.getAttribute("href")).toBe(LICENSE_PATH);
      expect(document.activeElement).toBe(backLink());
      expect(timer()).toBeNull();
      expect(pay()).toBeNull();
      expect(extendButton()).toBeNull();
    },
  );

  it("taken stays taken: no clock and no ended line, even with newer props or as the clock runs out", async () => {
    const at = nextNow();
    const { rerender } = render(
      clock(timesAt(at, 5), extendAnswering(refusedWith("taken"))),
    );
    await pressExtend();
    const stillTaken = () => {
      expect(timer()).toBeNull();
      expect(screen.queryByText(COPY.holdEnded)).toBeNull();
      expect(shownLine(COPY.holdTaken)).toHaveLength(1);
      expect(liveText()).toBe(COPY.holdTaken);
      expect(backLink()).not.toBeNull();
      expect(pay()).toBeNull();
    };
    stillTaken();
    advance(10);
    stillTaken();
    rerender(clock(timesAt(at + 60_000, 600)));
    stillTaken();
  });

  it("not_pending refreshes, so the page can redirect to /r", async () => {
    await mount(freshTimes(30), extendAnswering(refusedWith("not_pending")));
    await pressExtend();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(timer()).not.toBeNull();
    expect(backLink()).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it.each([
    [
      "a refusal of the call",
      () =>
        Promise.resolve<Answer>({
          ok: false,
          error: { code: "failed", message: GENERIC_ERROR_MESSAGE },
        }),
    ],
    ["a rejected call", () => Promise.reject(new Error("offline"))],
  ])(
    "%s shows the generic line under Extend, and Extend can go again",
    async (_, failing) => {
      const at = nextNow();
      const extend = vi
        .fn<() => Promise<Answer>>()
        .mockImplementationOnce(failing)
        .mockResolvedValueOnce(granted(timesAt(at + 1_000, 600)));
      await mount(timesAt(at, -1), extend);
      await pressExtend();
      expect(screen.getByRole("alert").textContent).toBe(GENERIC_ERROR_MESSAGE);
      expect(extendButton()).not.toBeNull();
      expect(pay()).toBeNull();
      await pressExtend();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(pay()).not.toBeNull();
    },
  );

  it("a failed press's line doesn't come back with a later last minute", async () => {
    const at = nextNow();
    const { rerender } = render(
      clock(timesAt(at, -1), () => Promise.reject(new Error("offline"))),
    );
    await pressExtend();
    expect(screen.getByRole("alert")).not.toBeNull();
    rerender(clock(timesAt(at + 60_000, 62)));
    advance(2);
    expect(extendButton()).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a retry takes the failed line away while it runs", async () => {
    const extend = vi
      .fn<() => Promise<Answer>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementationOnce(() => new Promise<Answer>(() => {}));
    await mount(freshTimes(-1), extend);
    await pressExtend();
    expect(screen.getByRole("alert")).not.toBeNull();
    await pressExtend();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("the failed line goes when the session ends", async () => {
    await mount(freshTimes(-1, 5), () => Promise.reject(new Error("offline")));
    await pressExtend();
    expect(screen.getByRole("alert")).not.toBeNull();
    advance(6);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(backLink()).not.toBeNull();
  });

  it("a redirect says nothing: the router is already going", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/r/6f4c8d7e;307;",
    });
    await mount(freshTimes(-1), () => Promise.reject(redirect));
    await pressExtend();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(extendButton()).not.toBeNull();
  });

  it("an older read arriving after the answer changes nothing; a later one is adopted", async () => {
    const at = nextNow();
    const { rerender } = render(
      clock(
        timesAt(at, 30),
        extendAnswering(granted(timesAt(at + 10_000, 600))),
      ),
    );
    await pressExtend();
    clockReads("10:00");

    rerender(clock(timesAt(at + 5_000, -1)));
    clockReads("10:00");
    expect(pay()).not.toBeNull();

    rerender(clock(timesAt(at + 20_000, 45)));
    clockReads("0:45");
    expect(pay()).not.toBeNull();
    expect(extendButton()).not.toBeNull();
  });
});

describe("leaving", () => {
  it.each([
    ["pagehide", 300],
    ["pagehide", 30],
    ["popstate", 300],
    ["popstate", 30],
  ] as const)("%s with %i s left: the flag, then the beacon", (type, hold) => {
    render(clock(freshTimes(hold)));
    leaveBy(type);
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon).toHaveBeenCalledWith(RELEASE_URL);
    expect(flagAtBeacon).toBe("1");
    expect(sessionStorage.getItem(FLAG)).toBe("1");
  });

  it.each([["pagehide"], ["popstate"]] as const)(
    "%s does nothing on a lapsed or ended page (AD-74 h)",
    (type) => {
      render(clock(freshTimes(-1)));
      leaveBy(type);
      expectNoLeave();
      cleanup();
      render(clock(freshTimes(-60, -1)));
      leaveBy(type);
      expectNoLeave();
    },
  );

  it.each([["pagehide"], ["popstate"]] as const)(
    "%s does nothing after a refusal",
    async (type) => {
      await mount(freshTimes(30), extendAnswering(refusedWith("taken")));
      await pressExtend();
      leaveBy(type);
      expectNoLeave();
    },
  );

  it("popstate lets go even when the router's listener, added first, unmounts the page", () => {
    let view: ReturnType<typeof render> | undefined;
    const router = () => view?.unmount();
    window.addEventListener("popstate", router);
    view = render(clock(freshTimes(300)));
    leaveBy("popstate");
    window.removeEventListener("popstate", router);
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(FLAG)).toBe("1");
  });

  it("an unmounted clock doesn't listen any more", async () => {
    render(clock(freshTimes(300)));
    cleanup();
    await nextTask();
    leaveBy("popstate");
    leaveBy("pagehide");
    expectNoLeave();
  });

  it("stops once the clock has reached zero", () => {
    render(clock(freshTimes(2)));
    advance(3);
    leaveBy("pagehide");
    expectNoLeave();
  });

  it("still sends the beacon with storage blocked", () => {
    render(clock(freshTimes(300)));
    blockStorage();
    beacon.mockImplementationOnce(() => true);
    leaveBy("pagehide");
    expect(beacon).toHaveBeenCalledTimes(1);
  });
});

describe("visibilitychange", () => {
  it("to visible re-syncs and refreshes, and never releases", () => {
    render(clock(freshTimes(300)));
    vi.setSystemTime(DEVICE_START + 30_000);
    dispatchVisibility();
    clockReads("4:30");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expectNoLeave();
  });

  it("to hidden does neither", () => {
    render(clock(freshTimes(300)));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    dispatchVisibility();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expectNoLeave();
  });
});

describe("coming back to a page that let go", () => {
  it("mount with the flag: clears it, extends once, and moves no focus and says nothing", async () => {
    const at = nextNow();
    const extend = extendAnswering(granted(timesAt(at + 1_000, 600)));
    const outside = document.body.appendChild(document.createElement("button"));
    outside.focus();
    sessionStorage.setItem(FLAG, "1");
    await mount(timesAt(at, -1), extend);
    expect(extend).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(FLAG)).toBeNull();
    expect(document.activeElement).toBe(outside);
    expect(liveText()).toBe("");
    clockReads("10:00");
    expect(pay()).not.toBeNull();
    outside.remove();
  });

  it("no flag: nothing is extended, and a lapsed page stays lapsed", async () => {
    const extend = neverCalled();
    await mount(freshTimes(-1), extend);
    expect(extend).not.toHaveBeenCalled();
    expect(pay()).toBeNull();
    expect(extendButton()).not.toBeNull();
  });

  it("while the call runs: no line, and Extend shows loading", async () => {
    sessionStorage.setItem(FLAG, "1");
    await mount(freshTimes(-1), () => new Promise<Answer>(() => {}));
    expect(screen.queryByText(COPY.holdEnded)).toBeNull();
    expect(
      screen.getByRole("button", { name: /Extend/ }).getAttribute("aria-busy"),
    ).toBe("true");
    expect(pay()).toBeNull();
  });

  it("a tick into the last minute while the call runs says nothing", async () => {
    sessionStorage.setItem(FLAG, "1");
    await mount(freshTimes(62), () => new Promise<Answer>(() => {}));
    advance(3);
    expect(liveText()).toBe("");
  });

  it("a read arriving while the call runs waits for its answer, so Pay doesn't flash away", async () => {
    const at = nextNow();
    let answer: (value: Answer) => void = () => {};
    sessionStorage.setItem(FLAG, "1");
    const { rerender } = render(
      clock(
        timesAt(at, 300),
        () =>
          new Promise<Answer>((resolve) => {
            answer = resolve;
          }),
      ),
    );
    rerender(clock(timesAt(at + 5_000, -1)));
    clockReads("5:00");
    expect(pay()).not.toBeNull();
    await act(async () => answer(granted(timesAt(at + 10_000, 600))));
    clockReads("10:00");
    expect(pay()).not.toBeNull();
  });

  it("a read that waited is adopted if the call fails", async () => {
    const at = nextNow();
    let fail: (error: Error) => void = () => {};
    sessionStorage.setItem(FLAG, "1");
    const { rerender } = render(
      clock(
        timesAt(at, 300),
        () =>
          new Promise<Answer>((_, reject) => {
            fail = reject;
          }),
      ),
    );
    rerender(clock(timesAt(at + 5_000, -1)));
    expect(pay()).not.toBeNull();
    await act(async () => fail(new Error("offline")));
    clockReads("0:00");
    expect(pay()).toBeNull();
    expect(extendButton()).not.toBeNull();
  });

  it("a refusal still sets its line, and moves no focus", async () => {
    sessionStorage.setItem(FLAG, "1");
    await mount(freshTimes(-1), extendAnswering(refusedWith("taken")));
    expect(shownLine(COPY.holdTaken)).toHaveLength(1);
    expect(liveText()).toBe(COPY.holdTaken);
    expect(backLink()).not.toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it("a failed call says nothing: the lapsed state and its Extend are there", async () => {
    sessionStorage.setItem(FLAG, "1");
    await mount(freshTimes(-1), () => Promise.reject(new Error("offline")));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(shownLine(COPY.holdEnded)).toHaveLength(1);
    expect(extendButton()).not.toBeNull();
  });

  it("pageshow with the flag does the same as a mount", async () => {
    const at = nextNow();
    const extend = extendAnswering(granted(timesAt(at + 1_000, 600)));
    await mount(timesAt(at, -1), extend);
    expect(extend).not.toHaveBeenCalled();
    sessionStorage.setItem(FLAG, "1");
    await dispatchPageshow(true);
    expect(extend).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(FLAG)).toBeNull();
    expect(document.activeElement).toBe(document.body);
    expect(liveText()).toBe("");
    clockReads("10:00");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("pageshow with no flag: a restored page re-syncs and refreshes, a loaded one does nothing", async () => {
    await mount(freshTimes(300));
    await dispatchPageshow(false);
    expect(mocks.refresh).not.toHaveBeenCalled();
    vi.setSystemTime(DEVICE_START + 30_000);
    await dispatchPageshow(true);
    clockReads("4:30");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("with storage blocked nothing throws, and the lapsed state stays usable", async () => {
    blockStorage();
    const at = nextNow();
    const extend = extendAnswering(granted(timesAt(at + 1_000, 600)));
    await mount(timesAt(at, -1), extend);
    expect(extend).not.toHaveBeenCalled();
    expect(shownLine(COPY.holdEnded)).toHaveLength(1);
    await pressExtend();
    expect(pay()).not.toBeNull();
  });

  it("with storage blocked a restored page refreshes once", async () => {
    blockStorage();
    await mount(freshTimes(-1));
    await dispatchPageshow(true);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("with storage blocked a reload reads the row again, its first read being from before the release: the lapsed state and Extend, no running clock", async () => {
    fakeTimeoutsToo();
    blockStorage();
    const at = nextNow();
    const { rerender } = await mount(timesAt(at, 598));
    clockReads("9:58");
    expect(pay()).not.toBeNull();
    advance(4);
    expect(mocks.refresh).not.toHaveBeenCalled();
    advance(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    advance(60);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    await act(async () => rerender(clock(timesAt(at + 5_000, -1))));
    expect(pay()).toBeNull();
    expect(extendButton()).not.toBeNull();
    expect(shownLine(COPY.holdEnded)).toHaveLength(1);
  });

  it("the same with only writes refused: the old page couldn't leave its mark either", async () => {
    fakeTimeoutsToo();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    await mount(freshTimes(598));
    advance(5);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("with storage working the mark tells a reload, so a first arrival reads nothing more and leaves no probe behind", async () => {
    fakeTimeoutsToo();
    await mount(freshTimes(598));
    advance(60);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(sessionStorage).toHaveLength(0);
  });
});

describe("Pay gone with the focus on it (WCAG 2.4.3)", () => {
  const block = () => document.querySelector("[data-hold-ready]");

  it("the tick that takes Pay away leaves the focus on the clock, and the next stop is Extend", async () => {
    await mount(freshTimes(3));
    pay()?.focus();
    expect(document.activeElement).toBe(pay());
    advance(4);
    expect(pay()).toBeNull();
    expect(document.activeElement).toBe(block());
    expect(block()?.contains(extendButton())).toBe(true);
  });

  it("the same when the session ends with the hold", async () => {
    await mount(freshTimes(3, 3));
    pay()?.focus();
    advance(4);
    expect(pay()).toBeNull();
    expect(backLink()).not.toBeNull();
    expect(document.activeElement).toBe(block());
  });

  it("a newer read that takes Pay away does the same", async () => {
    const at = nextNow();
    const { rerender } = await mount(timesAt(at, 300));
    pay()?.focus();
    await act(async () => rerender(clock(timesAt(at + 1_000, -1))));
    expect(pay()).toBeNull();
    expect(document.activeElement).toBe(block());
  });

  it("with the focus elsewhere it stays where it is", async () => {
    await mount(freshTimes(3));
    advance(4);
    expect(pay()).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
});

describe("Forward before the router has swapped the page out (AD-74 a)", () => {
  it("is a return, not another leave: clears the flag, extends once, moves no focus and says nothing", async () => {
    const at = nextNow();
    const extend = extendAnswering(granted(timesAt(at + 1_000, 600)));
    await mount(timesAt(at, 300), extend);
    await leaveBy("popstate");
    expect(sessionStorage.getItem(FLAG)).toBe("1");
    expect(extend).not.toHaveBeenCalled();
    await comeBack();
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(extend).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(FLAG)).toBeNull();
    clockReads("10:00");
    expect(pay()).not.toBeNull();
    expect(document.activeElement).toBe(document.body);
    expect(liveText()).toBe("");
  });

  it("Back again lets go again", async () => {
    const at = nextNow();
    await mount(
      timesAt(at, 300),
      extendAnswering(granted(timesAt(at + 1_000, 600))),
    );
    await leaveBy("popstate");
    await comeBack();
    await leaveBy("popstate");
    expect(beacon).toHaveBeenCalledTimes(2);
    expect(sessionStorage.getItem(FLAG)).toBe("1");
  });

  it("a traversal to the page's own path with nothing to come back to does nothing", async () => {
    const extend = neverCalled();
    await mount(freshTimes(300), extend);
    await comeBack();
    expect(extend).not.toHaveBeenCalled();
    expectNoLeave();
    expect(pay()).not.toBeNull();
  });

  it("a lapsed page: Back and Forward send nothing and extend nothing", async () => {
    const extend = neverCalled();
    await mount(freshTimes(-1), extend);
    await leaveBy("popstate");
    await comeBack();
    expect(extend).not.toHaveBeenCalled();
    expectNoLeave();
    expect(pay()).toBeNull();
    expect(extendButton()).not.toBeNull();
  });
});

describe("a release that lands after the resume's Extend", () => {
  const tooEarly = (times: CheckoutHoldTimes): Answer => ({
    ok: true,
    data: { ok: false, reason: "too_early", ...times },
  });

  it("too_early means it is still on its way: the row is read once more a little later, and what it says is adopted", async () => {
    fakeTimeoutsToo();
    const at = nextNow();
    sessionStorage.setItem(FLAG, "1");
    const { rerender } = await mount(
      timesAt(at, 600),
      extendAnswering(tooEarly(timesAt(at + 1_000, 599))),
    );
    clockReads("9:59");
    expect(pay()).not.toBeNull();
    advance(4);
    expect(mocks.refresh).not.toHaveBeenCalled();
    advance(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    rerender(clock(timesAt(at + 7_000, -1)));
    clockReads("0:00");
    expect(pay()).toBeNull();
    expect(extendButton()).not.toBeNull();
    expect(liveText()).toBe(COPY.holdEnded);
    advance(30);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("a resume that was granted isn't read again", async () => {
    fakeTimeoutsToo();
    const at = nextNow();
    sessionStorage.setItem(FLAG, "1");
    await mount(
      timesAt(at, -1),
      extendAnswering(granted(timesAt(at + 1_000, 600))),
    );
    advance(30);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("a pressed Extend isn't read again: no release went", async () => {
    fakeTimeoutsToo();
    const at = nextNow();
    await mount(
      timesAt(at, 30),
      extendAnswering(tooEarly(timesAt(at + 1_000, 45))),
    );
    await pressExtend();
    advance(30);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("an unmounted clock doesn't read it again", async () => {
    fakeTimeoutsToo();
    const at = nextNow();
    sessionStorage.setItem(FLAG, "1");
    await mount(
      timesAt(at, 600),
      extendAnswering(tooEarly(timesAt(at + 1_000, 599))),
    );
    cleanup();
    advance(30);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("a cached page (AD-74 b)", () => {
  it("doesn't refresh on a now it hasn't seen", () => {
    render(clock(freshTimes(300)));
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("refreshes when the same now mounts again", () => {
    const times = freshTimes(300);
    render(clock(times));
    cleanup();
    render(clock(times));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("remembers a now it adopted", () => {
    const at = nextNow();
    const later = timesAt(at + 30_000, 270);
    const { rerender } = render(clock(timesAt(at, 300)));
    rerender(clock(later));
    expect(mocks.refresh).not.toHaveBeenCalled();
    cleanup();
    render(clock(later));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("remembers a now it didn't adopt, being older than Extend's answer", async () => {
    const at = nextNow();
    const older = timesAt(at + 5_000, 25);
    const { rerender } = render(
      clock(
        timesAt(at, 30),
        extendAnswering(granted(timesAt(at + 10_000, 600))),
      ),
    );
    await pressExtend();
    rerender(clock(older));
    clockReads("10:00");
    expect(mocks.refresh).not.toHaveBeenCalled();
    cleanup();
    render(clock(older));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it.each([["pagehide"], ["popstate"]] as const)(
    "holds nothing until a newer read says so: no Pay, and %s lets nothing go",
    async (type) => {
      const at = nextNow();
      const cached = timesAt(at, 300);
      render(clock(cached));
      cleanup();
      await nextTask();
      const { rerender } = render(clock(cached));
      clockReads("5:00");
      expect(pay()).toBeNull();
      await leaveBy(type);
      expectNoLeave();

      window.history.replaceState(null, "", CHECKOUT_PATH);
      rerender(clock(timesAt(at + 1_000, 299)));
      expect(pay()).not.toBeNull();
      await leaveBy(type);
      expect(beacon).toHaveBeenCalledTimes(1);
    },
  );

  it("a read older than the cached page changes nothing", () => {
    const at = nextNow();
    const cached = timesAt(at, 300);
    render(clock(cached));
    cleanup();
    const { rerender } = render(clock(cached));
    rerender(clock(timesAt(at - 1_000, 301)));
    expect(pay()).toBeNull();
  });

  it("a pressed Extend's answer is as good as a newer read", async () => {
    const at = nextNow();
    const cached = timesAt(at, 30);
    render(clock(cached));
    cleanup();
    await mount(cached, extendAnswering(granted(timesAt(at + 1_000, 600))));
    expect(pay()).toBeNull();
    await pressExtend();
    expect(pay()).not.toBeNull();
  });

  it("with the flag it stays as a return: Pay shows while the call runs", async () => {
    const cached = freshTimes(300);
    render(clock(cached));
    cleanup();
    sessionStorage.setItem(FLAG, "1");
    await mount(cached, () => new Promise<Answer>(() => {}));
    expect(pay()).not.toBeNull();
  });

  it("with storage blocked it holds nothing either", () => {
    const cached = freshTimes(300);
    render(clock(cached));
    cleanup();
    blockStorage();
    render(clock(cached));
    expect(pay()).toBeNull();
  });
});
