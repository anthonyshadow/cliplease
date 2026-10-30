// 07 D98: an amount always carries its currency's prefix ("CA$1,732.50"), never a bare "$". Plain, with no imports:
// Vitest and Playwright both load it.

/** A "$" before a digit that isn't the end of a currency prefix such as "CA$" or "US$". */
export const BARE_DOLLAR = /(^|[^A-Z])\$\d/;
