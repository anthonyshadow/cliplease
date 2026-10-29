// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Disclosure } from "./disclosure";

afterEach(cleanup);

const triggers = () => screen.getAllByRole("button", { name: "Details" });

describe("Disclosure (04 §9.11)", () => {
  it("is a lone trigger that opens its content", async () => {
    render(<Disclosure label="Details">facts</Disclosure>);
    expect(triggers()).toHaveLength(1);
    expect(screen.queryByText("facts")).toBeNull();
    await act(async () => fireEvent.click(triggers()[0] as HTMLElement));
    expect(screen.getByText("facts")).toBeTruthy();
  });

  it("puts the trigger in a row for the actions' reserved spot (null): one trigger", () => {
    const { container } = render(
      <Disclosure label="Details" actions={null} rowClassName="row-spot">
        facts
      </Disclosure>,
    );
    expect(triggers()).toHaveLength(1);
    expect(
      container.querySelector(".row-spot")?.contains(triggers()[0] ?? null),
    ).toBe(true);
  });

  it("with actions, gives each tier its own trigger in the order it shows: before them from md, after them below", () => {
    render(
      <Disclosure
        label="Details"
        actions={
          <>
            <button type="button">Decline</button>
            <button type="button">Approve</button>
          </>
        }
      >
        facts
      </Disclosure>,
    );
    const [wide, narrow] = triggers();
    expect(wide?.parentElement?.className).toBe("hidden md:block");
    expect(narrow?.parentElement?.className).toBe("md:hidden");
    const order = screen.getAllByRole("button").map((b) => b.textContent);
    expect(order).toEqual(["Details", "Decline", "Approve", "Details"]);
  });
});
