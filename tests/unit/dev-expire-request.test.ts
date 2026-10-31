import { describe, expect, it } from "vitest";
import {
  devExpireRefusal,
  parseDevExpireArgs,
  USAGE,
} from "../../scripts/dev-expire-request";

// The dev clock's pure checks (02 §11.1 step 9, 07 D51): what refuses a run before the database is touched.

const ID = "6f4c8d7e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const OTHER_ID = "00000000-0000-4000-8000-000000000101";

describe("devExpireRefusal", () => {
  it.each(["development", "test"])("lets APP_ENV=%s run", (appEnv) => {
    expect(devExpireRefusal(appEnv)).toBeNull();
  });

  it.each(["production", "preview"])("refuses APP_ENV=%s", (appEnv) => {
    expect(devExpireRefusal(appEnv)).toBe(
      `refusing to run with APP_ENV=${appEnv}: development or test only (07 D51).`,
    );
  });

  it("refuses an unset APP_ENV", () => {
    expect(devExpireRefusal(undefined)).toBe(
      "refusing to run with APP_ENV=(unset): development or test only (07 D51).",
    );
  });
});

describe("parseDevExpireArgs", () => {
  it("takes one request id and calls the cron", () => {
    expect(parseDevExpireArgs([ID])).toEqual({ requestId: ID, cron: true });
  });

  it("leaves the cron call out with --no-cron, before or after the id", () => {
    expect(parseDevExpireArgs([ID, "--no-cron"])).toEqual({
      requestId: ID,
      cron: false,
    });
    expect(parseDevExpireArgs(["--no-cron", ID])).toEqual({
      requestId: ID,
      cron: false,
    });
  });

  it.each<[string, string[]]>([
    ["no arguments", []],
    ["only the flag", ["--no-cron"]],
    ["an id that isn't a uuid", ["CL-7K3M-9QXA"]],
    ["two ids", [ID, OTHER_ID]],
    ["an unknown flag", [ID, "--cron"]],
    ["a flag it doesn't take yet", [ID, "--checkout"]],
    ["a short flag", [ID, "-n"]],
  ])("refuses %s", (_case, argv) => {
    expect(parseDevExpireArgs(argv)).toBeNull();
  });

  it("prints the usage with both forms", () => {
    expect(USAGE).toMatch(
      /^usage: bunx tsx scripts\/dev-expire-request\.ts <requestId> \[--no-cron\]\n/,
    );
  });
});
