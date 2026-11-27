import { readFileSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";
import { expect, test as teardown } from "@playwright/test";
import { MOCK_TOKEN } from "./helpers/leaks";

// The safety teardown (P22, S5's server-log half): once every project has finished, the e2e server's own output
// (scripts/e2e-server.mjs writes it, build and start) holds no mock social token. A failure names line numbers only,
// never the line.

const SERVER_LOG = ".data/e2e-server.log";

teardown("S5: the e2e server's log holds no mock social token", () => {
  // Without the terminal colors, which can sit inside a line.
  const text = stripVTControlCharacters(readFileSync(SERVER_LOG, "utf8"));
  // The capture worked: both scripts' command lines are there (bun prints each one). Booleans, so a failure never
  // prints the log.
  for (const command of ["$ next build", "$ next start"]) {
    expect(text.includes(command), `${SERVER_LOG} has "${command}"`).toBe(true);
  }
  const lines = text
    .split("\n")
    .flatMap((line, index) => (MOCK_TOKEN.test(line) ? [index + 1] : []));
  expect(lines, `${SERVER_LOG} lines with a mock token`).toEqual([]);
});
