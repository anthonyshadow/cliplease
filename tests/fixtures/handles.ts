// The handle format cases, shared by the unit test (HANDLE_RE, handleProblem) and the [int] parity test (the
// creator_profile_handle_format CHECK), so the two can't drift apart (02 §5.2, 07 D20).

export const VALID_HANDLES = [
  "maya",
  "maya.films",
  "m_a.y_a",
  "abc",
  "a".repeat(30),
] as const;

export const INVALID_HANDLES = [
  ["ma", "length"],
  ["a".repeat(31), "length"],
  ["a..b", "characters"],
  [".maya", "characters"],
  ["maya_", "characters"],
  ["Maya", "characters"],
  ["maya-films", "characters"],
] as const;
