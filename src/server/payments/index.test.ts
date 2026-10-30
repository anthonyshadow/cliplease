import { afterEach, describe, expect, it, vi } from "vitest";
import { cancel, capture } from "./index";
import { CurrencyNotEnabledError, paymentsDriver } from "./registry";

const ID = "6f4c8d7e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const PI = `pi_fake_${ID}`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("payments wrappers (02 §5.8, 07 D95)", () => {
  it("captures on the currency's driver under the claim's key", async () => {
    const spy = vi.spyOn(paymentsDriver("cad"), "capture");
    await expect(capture("cad", ID, PI, 2)).resolves.toEqual({ ok: true });
    expect(spy).toHaveBeenCalledWith(PI, `pi-capture:${ID}:2`);
  });

  it("cancels with Stripe's reason for the domain's, under a key naming both", async () => {
    const spy = vi.spyOn(paymentsDriver("cad"), "cancel");
    await cancel("cad", ID, PI, "decline", 1);
    expect(spy).toHaveBeenLastCalledWith(
      PI,
      "requested_by_customer",
      `pi-cancel:${ID}:decline:1`,
    );
    await cancel("cad", ID, PI, "expire", 3);
    expect(spy).toHaveBeenLastCalledWith(
      PI,
      "abandoned",
      `pi-cancel:${ID}:expire:3`,
    );
  });

  it("never throws: a thrown capture or cancel is a transient failure named after its class (07 D25)", async () => {
    const driver = paymentsDriver("cad");
    vi.spyOn(driver, "capture").mockRejectedValue(new TypeError("x"));
    vi.spyOn(driver, "cancel").mockRejectedValue(new RangeError("y"));
    await expect(capture("cad", ID, PI, 1)).resolves.toEqual({
      ok: false,
      kind: "transient",
      code: "TypeError",
    });
    expect(driver.capture).toHaveBeenCalledWith(PI, `pi-capture:${ID}:1`);
    await expect(cancel("cad", ID, PI, "decline", 2)).resolves.toEqual({
      ok: false,
      kind: "transient",
      code: "RangeError",
    });
  });

  it("still throws for a currency that isn't enabled: a configuration error, not a Stripe one", async () => {
    await expect(capture("usd", ID, PI, 1)).rejects.toBeInstanceOf(
      CurrencyNotEnabledError,
    );
    await expect(cancel("usd", ID, PI, "expire", 1)).rejects.toBeInstanceOf(
      CurrencyNotEnabledError,
    );
  });
});
