import { describe, expect, it } from "vitest";
import { createVideoSchema, titleField } from "./video";

describe("titleField (07 D23, owner answer Q-43 a)", () => {
  it.each([
    ["x", "x"],
    ["x".repeat(100), "x".repeat(100)],
    [`  ${"x".repeat(100)}\n `, "x".repeat(100)],
    [
      `${"x".repeat(50)}\n\n\n${"y".repeat(49)}`,
      `${"x".repeat(50)} ${"y".repeat(49)}`,
    ],
    ["\u202eHe saw\tsnow ", "He saw snow"],
  ])("accepts %j as %j", (raw, title) => {
    expect(titleField.safeParse(raw)).toEqual({ success: true, data: title });
  });

  it.each([
    "",
    "   ",
    "\n\t",
    "\u202e\u200f",
    "x".repeat(101),
    ` ${"x".repeat(101)} `,
  ])("rejects %j", (raw) => {
    expect(titleField.safeParse(raw).success).toBe(false);
  });
});

describe("createVideoSchema (02 §6.1)", () => {
  it("parses the tidied title", () => {
    expect(
      createVideoSchema.parse({
        title: " He saw snow for the first time\nand lost it ",
      }),
    ).toEqual({ title: "He saw snow for the first time and lost it" });
  });

  it.each([{}, { title: "" }, { title: 7 }, { title: "x".repeat(101) }])(
    "rejects %j on the title",
    (input) => {
      const result = createVideoSchema.safeParse(input);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(["title"]);
    },
  );
});
