import { describe, expect, it } from "vitest";
import { dropDecided, mergeSettledRows, type SettledRow } from "./settled-rows";

type Row = { id: string; v: string };
const row = (id: string, v = "server"): Row => ({ id, v });
const ids = (rows: readonly Row[]) => rows.map((r) => r.id);
const settledOf = (...entries: [Row, number][]) =>
  new Map<string, SettledRow<Row>>(
    entries.map(([r, index]) => [r.id, { row: r, index }]),
  );

describe("mergeSettledRows (02 §4.4 rule 2)", () => {
  it("returns the server rows unchanged when nothing settled", () => {
    const rows = [row("a"), row("b")];
    expect(mergeSettledRows(rows, new Map())).toBe(rows);
  });

  it("keeps a settled row at its index when the server rows drop it", () => {
    const merged = mergeSettledRows(
      [row("a"), row("c")],
      settledOf([row("b", "settled"), 1]),
    );
    expect(ids(merged)).toEqual(["a", "b", "c"]);
    expect(merged[1]?.v).toBe("settled");
  });

  it("puts the settled entry in place of a server row with the same id", () => {
    const merged = mergeSettledRows(
      [row("a"), row("b"), row("c")],
      settledOf([row("b", "settled"), 1]),
    );
    expect(ids(merged)).toEqual(["a", "b", "c"]);
    expect(merged.map((r) => r.v)).toEqual(["server", "settled", "server"]);
  });

  it("keeps the other rows in the server's order", () => {
    const merged = mergeSettledRows(
      [row("d"), row("a"), row("e")],
      settledOf([row("b", "settled"), 0], [row("c", "settled"), 2]),
    );
    expect(ids(merged)).toEqual(["b", "d", "c", "a", "e"]);
  });

  it("clamps an index past the end", () => {
    const merged = mergeSettledRows(
      [row("a")],
      settledOf([row("z", "settled"), 5]),
    );
    expect(ids(merged)).toEqual(["a", "z"]);
  });

  it("shows a settled row when the server has no rows left", () => {
    const merged = mergeSettledRows([], settledOf([row("b", "settled"), 0]));
    expect(ids(merged)).toEqual(["b"]);
  });
});

describe("dropDecided", () => {
  it("lets go of decided rows and keeps the ones whose action is still running", () => {
    const settled = new Map([
      ["a", { row: row("a"), index: 0, outcome: "approved" }],
      ["b", { row: row("b"), index: 2, outcome: null }],
    ]);
    expect([...dropDecided(settled).keys()]).toEqual(["b"]);
  });

  it("returns the same map when nothing is decided, so the refresh renders nothing extra", () => {
    const settled = new Map([
      ["b", { row: row("b"), index: 2, outcome: null }],
    ]);
    expect(dropDecided(settled)).toBe(settled);
  });
});
