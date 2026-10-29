// The emails' light palette and type (05 §8). Literal hex, because emails can't read CSS variables: canvas #FFFFFF,
// ink #111111, ink-2 #616161, link #0060DF, hairline #E5E5E5; the button is ink with white text. Only src/emails may
// hold hex colors (the token lint skips it).

const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const INK = "#111111";
const INK_2 = "#616161";

export const body = {
  backgroundColor: "#FFFFFF",
  color: INK,
  fontFamily: FONT,
  margin: 0,
};
export const container = { padding: "32px 24px" };
export const wordmark = {
  fontSize: "17px",
  fontWeight: 600,
  margin: "0 0 32px",
};
export const heading = {
  fontSize: "22px",
  lineHeight: "28px",
  fontWeight: 600,
  margin: "0 0 16px",
};
export const paragraph = {
  fontSize: "16px",
  lineHeight: "24px",
  margin: "0 0 12px",
};
/** 04's footnote size in ink-2: the context block and the footer. */
export const footnote = {
  fontSize: "13px",
  lineHeight: "18px",
  color: INK_2,
  margin: 0,
};
export const hairline = { borderColor: "#E5E5E5", margin: "24px 0" };
/** An ink pill 44 px tall: 12 px above and below a 20 px line. */
export const button = {
  backgroundColor: INK,
  color: "#FFFFFF",
  borderRadius: "999px",
  fontSize: "16px",
  lineHeight: "20px",
  fontWeight: 600,
  padding: "12px 24px",
  textDecoration: "none",
};
export const link = { color: "#0060DF", wordBreak: "break-all" as const };
