// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type ComponentProps, createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXCLUSIVE_COPY } from "@/lib/pricing/exclusive-copy";
import { description } from "../../../tests/helpers/a11y";
import { ExclusiveRow } from "./exclusive-row";

afterEach(cleanup);

const row = (change: Partial<ComponentProps<typeof ExclusiveRow>> = {}) =>
  render(
    <ExclusiveRow
      label={EXCLUSIVE_COPY.premiumLabel}
      helper={EXCLUSIVE_COPY.premiumHelper}
      value="3.00"
      onChange={() => {}}
      examplePrice="CA$450.00"
      {...change}
    />,
  );

const field = () =>
  screen.getByRole<HTMLInputElement>("textbox", {
    name: EXCLUSIVE_COPY.premiumLabel,
  });
const example = () => document.querySelector("[data-example-price]");

describe("ExclusiveRow (04 §9.29; 05 §6.9 callout 10)", () => {
  it("is a group its label names, holding one field of exactly that name", () => {
    row();
    expect(
      screen.getByRole("group", { name: EXCLUSIVE_COPY.premiumLabel }),
    ).toBeTruthy();
    expect(screen.getAllByRole("textbox")).toEqual([field()]);
    expect(field().getAttribute("inputmode")).toBe("decimal");
    expect(field().getAttribute("autocomplete")).toBe("off");
    expect(field().hasAttribute("step")).toBe(false);
  });

  it("shows the value as given, with the × as the field's adornment", () => {
    row();
    expect(field().value).toBe("3.00");
    expect(screen.getByText("×")).toBeTruthy();
  });

  it("describes the field by the prefix, then the helper", () => {
    row();
    expect(description(field())).toBe(`× ${EXCLUSIVE_COPY.premiumHelper}`);
  });

  it("adds the note to the description and under the helper", () => {
    row({ note: EXCLUSIVE_COPY.noExclusiveTerm });
    expect(description(field())).toBe(
      `× ${EXCLUSIVE_COPY.premiumHelper} ${EXCLUSIVE_COPY.noExclusiveTerm}`,
    );
    expect(screen.getByText(EXCLUSIVE_COPY.noExclusiveTerm)).toBeTruthy();
  });

  it("has no note line without a note", () => {
    row();
    expect(screen.queryByText(EXCLUSIVE_COPY.noExclusiveTerm)).toBeNull();
  });

  it("shows the formatted example price the caller gives", () => {
    row();
    expect(example()?.textContent).toBe("CA$450.00");
  });

  it("leaves the example price's box empty for null", () => {
    row({ examplePrice: null });
    expect(example()?.textContent).toBe("");
  });

  it("puts the error under the field and marks it invalid", () => {
    row({ error: "Minimum is ×1.00." });
    expect(screen.getByText("Minimum is ×1.00.")).toBeTruthy();
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(description(field())).toBe(
      `× Minimum is ×1.00. ${EXCLUSIVE_COPY.premiumHelper}`,
    );
  });

  it("passes the typed text up, and the field to fieldRef", () => {
    const onChange = vi.fn();
    const fieldRef = createRef<HTMLInputElement>();
    row({ onChange, fieldRef });
    fireEvent.change(field(), { target: { value: "4.00" } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("4.00");
    expect(fieldRef.current).toBe(field());
  });
});
