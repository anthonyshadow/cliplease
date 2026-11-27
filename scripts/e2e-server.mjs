// The e2e webServer (playwright.config.ts, P22): `bun run build`, then `bun run start --port 3100`, every byte of both
// also written to .data/e2e-server.log (truncated at start) for the safety teardown's token scan (S5). Each child's
// stdout and stderr still go to this process's own, so the console keeps the server's stderr as before, and the exit
// code is the build's when it fails, else the server's. Playwright starts this command as the leader of its own process
// group and stops it by killing the group; the children are never detached, so they go with it. Writes are synchronous,
// so the log is complete up to that kill.
import { spawn } from "node:child_process";
import { mkdirSync, openSync, writeSync } from "node:fs";
import { constants } from "node:os";

const LOG = ".data/e2e-server.log";

mkdirSync(".data", { recursive: true });
const log = openSync(LOG, "w");

/** The running child, so a SIGINT or SIGTERM reaches it. */
let child = null;
let stopping = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    child?.kill(signal);
  });
}

/** Runs `bun run <args>`, its output teed to the log; resolves to its exit code (128 + n for signal n). */
function run(args) {
  return new Promise((resolve) => {
    child = spawn("bun", ["run", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const [from, to] of [
      [child.stdout, process.stdout],
      [child.stderr, process.stderr],
    ]) {
      from.on("data", (chunk) => {
        writeSync(log, chunk);
        to.write(chunk);
      });
    }
    child.on("error", (error) => {
      process.stderr.write(`e2e-server: ${error.message}\n`);
      resolve(1);
    });
    child.on("close", (code, signal) => {
      child = null;
      resolve(code ?? 128 + (constants.signals[signal] ?? 0));
    });
  });
}

const built = await run(["build"]);
process.exitCode =
  built !== 0 || stopping ? built : await run(["start", "--port", "3100"]);
