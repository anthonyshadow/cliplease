import { describe, expect, it } from "vitest";
import { isIosDevice } from "./device";

const UA = {
  iPhone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  iPad: "Mozilla/5.0 (iPad; CPU OS 17_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.7 Mobile/15E148 Safari/604.1",
  iPod: "Mozilla/5.0 (iPod; U; CPU like Mac OS X; en) AppleWebKit/420.1 (KHTML, like Gecko) Version/3.0 Mobile/3A101a Safari/419.3",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  android:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  windows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
};

describe("isIosDevice (04 §9.26, 07 D152)", () => {
  it.each<[string, boolean, string, number]>([
    ["iPhone Safari", true, UA.iPhone, 5],
    ["iPhone UA without touch points", true, UA.iPhone, 0],
    ["iPad", true, UA.iPad, 5],
    ["iPod", true, UA.iPod, 5],
    ["iPadOS desktop UA with touch", true, UA.macSafari, 5],
    ["Mac Safari without touch", false, UA.macSafari, 0],
    ["Mac Safari with one touch point", false, UA.macSafari, 1],
    ["desktop Chrome on macOS", false, UA.macChrome, 0],
    ["Android Chrome", false, UA.android, 5],
    ["Windows touch laptop", false, UA.windows, 10],
  ])("%s → %s", (_name, expected, userAgent, maxTouchPoints) => {
    expect(isIosDevice(userAgent, maxTouchPoints)).toBe(expected);
  });
});
