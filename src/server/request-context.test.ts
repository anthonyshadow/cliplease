import { describe, expect, it } from "vitest";
import { clientIp, clientUserAgent } from "./request-context";

describe("clientIp", () => {
  it.each([
    ["203.0.113.7", "203.0.113.7"],
    [" 203.0.113.7, 10.0.0.1", "203.0.113.7"],
    ["::1", "::1"],
    ["::ffff:127.0.0.1", "::ffff:127.0.0.1"],
  ])("keeps the first address of %j", (header, ip) => {
    expect(clientIp(header)).toBe(ip);
  });

  it.each([null, "", "unknown", "1.2.3.4:80", "fe80::1%lo0"])(
    "is null for %j, which Postgres's inet would refuse",
    (header) => {
      expect(clientIp(header)).toBeNull();
    },
  );
});

describe("clientUserAgent", () => {
  it("keeps an agent up to 512 characters and cuts a longer one to 512", () => {
    const agent = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X)";
    expect(clientUserAgent(agent)).toBe(agent);
    expect(clientUserAgent("x".repeat(512))).toHaveLength(512);
    expect(clientUserAgent("x".repeat(600))).toBe("x".repeat(512));
  });

  it.each([null, ""])("is null for %j", (header) => {
    expect(clientUserAgent(header)).toBeNull();
  });
});
