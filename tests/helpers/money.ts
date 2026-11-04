// 07 D98: an amount always carries its currency's prefix ("CA$1,732.50"), never a bare "$". Vitest and Playwright both
// load it.
import { formatMoney } from "../../src/lib/format";

/** A "$" before a digit that isn't the end of a currency prefix such as "CA$" or "US$". */
export const BARE_DOLLAR = /(^|[^A-Z])\$\d/;

/** Minor units in Canadian dollars: "CA$1,732.50". */
export const cad = (cents: number) => formatMoney(cents, "cad");
