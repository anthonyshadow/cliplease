import { describe, expect, it } from "vitest";
import { requestedCode } from "./requested-code";

// The not-found view names a code only when the address held a canonical one (owner answer Q-184).
describe("requestedCode", () => {
  it("is the path's last segment when it is a canonical code", () => {
    expect(requestedCode("/verify/CL-0000-0000")).toBe("CL-0000-0000");
  });

  it("ignores the query", () => {
    expect(requestedCode("/verify/CL-0000-0000?utm=x/y")).toBe("CL-0000-0000");
  });

  it("decodes the segment before checking it", () => {
    expect(requestedCode("/verify/CL%2D0000-0000")).toBe("CL-0000-0000");
  });

  it.each([
    "/verify/CLR-7K3M-9QXA",
    "/verify/cl-0000-0000",
    "/verify/%3Cb%3Ehi%3C%2Fb%3E",
    "/verify/%E0%A4%A",
    "/verify/",
    "",
  ])("is null for %j, which is never echoed", (path) => {
    expect(requestedCode(path)).toBeNull();
  });

  it("is null without the forwarded path", () => {
    expect(requestedCode(null)).toBeNull();
  });
});
