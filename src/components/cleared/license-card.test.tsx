// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LicenseSnapshotV1 } from "@/lib/licensing/snapshot";
import { FIRST_SNOW } from "../../../tests/helpers/license-snapshot-fixtures";
import { LicenseCard } from "./license-card";

afterEach(cleanup);

const SNAPSHOT = FIRST_SNOW;

const card = (
  over: Partial<LicenseSnapshotV1> = {},
  status: "valid" | "expired" | "revoked" = "valid",
) =>
  render(
    <LicenseCard
      snapshot={{ ...SNAPSHOT, ...over }}
      status={status}
      amountTotalCents={173_250}
    />,
  );

/** The FactList as label → value text. */
const facts = (): Record<string, string> =>
  Object.fromEntries(
    Array.from(document.querySelectorAll("dt"), (dt) => [
      dt.textContent ?? "",
      dt.nextElementSibling?.textContent ?? "",
    ]),
  );

describe("LicenseCard (04 §10.2 item 5; 05 §4.4)", () => {
  it("names the video in its heading, beside the bare poster route and the sm badge from the snapshot", () => {
    const { container } = card();
    expect(screen.getByRole("region", { name: "First snow" }).tagName).toBe(
      "SECTION",
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      `/api/media/posters/${SNAPSHOT.video.id}`,
    );
    expect(screen.getByText("Verified · @maya.films · Instagram")).toBeTruthy();
  });

  it("lists the record's facts in 05's order, Rights between Territory and Licensed to", () => {
    card();
    const f = facts();
    expect(Object.keys(f)).toEqual([
      "License",
      "Status",
      "Use",
      "Term",
      "Territory",
      "Rights",
      "Licensed to",
      "Paid",
    ]);
    expect(f.Status).toBe("Valid");
    expect(f.Use).toBe("Paid social ads");
    expect(f.Term).toBe(
      "1 year · 15 Oct 2026, 14:32 UTC to 15 Oct 2027, 14:32 UTC",
    );
    expect(f.Territory).toBe("Worldwide");
    expect(f.Rights).toBe("Non-exclusive");
    expect(f["Licensed to"]).toBe("Daily Laughs Media LLC");
    expect(f.Paid).toBe("CA$1,732.50");
    expect(screen.getByText("Amounts in Canadian dollars (CAD).")).toBeTruthy();
  });

  it("prints the code in the code style with its own Copy", () => {
    card();
    const code = screen.getByText("CL-7K3M-9QXA");
    expect(code.className).toContain("tracking-code");
    expect(code.className).toContain("tabular-nums");
    expect(
      screen.getByRole("button", { name: "Copy license code" }),
    ).toBeTruthy();
  });

  it("reads Exclusive until the end in UTC for an exclusive license (07 D113)", () => {
    card({ exclusive: true });
    expect(facts().Rights).toBe("Exclusive until 15 Oct 2027, 14:32 UTC");
  });

  it("has no end date for a Perpetual term", () => {
    card({
      endsAt: null,
      scope: {
        ...SNAPSHOT.scope,
        termKey: "perpetual",
        termLabel: "Perpetual",
      },
    });
    expect(facts().Term).toBe(
      "Perpetual · From 15 Oct 2026, 14:32 UTC · No end date",
    );
  });

  it("adds the chosen place to a country or region territory", () => {
    card({
      scope: {
        ...SNAPSHOT.scope,
        territoryKey: "country",
        territoryLabel: "One country",
        territoryDetail: "United States",
      },
    });
    expect(facts().Territory).toBe("One country — United States");
  });

  it.each([
    ["expired", "Expired", "bg-fill"],
    ["revoked", "Revoked", "bg-danger-tint"],
    ["valid", "Valid", "bg-cleared"],
  ] as const)("shows the %s pill (04 §9.9)", (status, label, tone) => {
    card({}, status);
    const pill = screen.getByText(label);
    expect(pill.className).toContain(tone);
  });

  it("is self-attested when the record has no verified posting (07 D89)", () => {
    card({ ownership: { kind: "self_attested" }, postings: [] });
    expect(screen.getByText("Self-attested by the creator")).toBeTruthy();
  });
});
