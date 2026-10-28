// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { formatDeadline } from "@/lib/format";
import { REQUEST_STATUS_COPY } from "@/lib/licensing/request-status";
import { WaitingBody } from "./waiting-body";

const EXPIRES_AT = "2026-10-30T19:10:00.000Z";
const props = { handle: "maya", total: "CA$1,732.50", expiresAt: EXPIRES_AT };

afterEach(cleanup);

describe("WaitingBody (01 §4.8)", () => {
  it("leaves the deadline out of the server's HTML", () => {
    const server = document.createElement("div");
    server.innerHTML = renderToString(<WaitingBody {...props} />);
    expect(server.textContent).toBe(
      REQUEST_STATUS_COPY.waitingBody("maya", "CA$1,732.50", null),
    );
  });

  it("names the deadline in the viewer's zone once mounted", () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const { container } = render(<WaitingBody {...props} />);
    expect(container.textContent).toBe(
      REQUEST_STATUS_COPY.waitingBody(
        "maya",
        "CA$1,732.50",
        formatDeadline(new Date(EXPIRES_AT), zone),
      ),
    );
  });

  it("names no deadline without one", () => {
    const { container } = render(<WaitingBody {...props} expiresAt={null} />);
    expect(container.textContent).not.toContain("has until");
  });
});
