import { Body, Container, Head, Heading, Hr, Html, Text } from "react-email";
import { APP_NAME } from "@/lib/app-name";
import { OTP_EXPIRES_IN_S } from "@/lib/sign-in";

// The sign-in code email (05 §8, row sign-in-code). Light palette as literal hex, because emails can't read CSS
// variables (05 §8): canvas #FFFFFF, ink #111111, ink-2 #616161. No images, no button.
const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const body = {
  backgroundColor: "#FFFFFF",
  color: "#111111",
  fontFamily: FONT,
  margin: 0,
};
const container = { padding: "32px 24px" };
const wordmark = { fontSize: "17px", fontWeight: 600, margin: "0 0 32px" };
const heading = {
  fontSize: "22px",
  lineHeight: "28px",
  fontWeight: 600,
  margin: "0 0 16px",
};
const paragraph = { fontSize: "16px", lineHeight: "24px", margin: "0 0 12px" };
// The code in title-1 size with the code tracking (04 §4).
const code = {
  fontSize: "28px",
  lineHeight: "34px",
  fontWeight: 600,
  letterSpacing: "0.04em",
  margin: "0 0 16px",
};
const footer = {
  fontSize: "13px",
  lineHeight: "18px",
  color: "#616161",
  margin: 0,
};

/** The code grouped 3 + 3 ("123 456"), as one string so the HTML keeps it together. */
export function groupCode(value: string): string {
  return `${value.slice(0, 3)} ${value.slice(3)}`;
}

export function SignInCode({ code: value }: { code: string }) {
  return (
    <Html lang="en">
      <Head />
      <Body style={body}>
        <Container style={container}>
          <Text style={wordmark}>{APP_NAME}</Text>
          <Heading as="h1" style={heading}>
            Your sign-in code
          </Heading>
          <Text style={paragraph}>Enter this code to sign in:</Text>
          <Text style={code}>{groupCode(value)}</Text>
          <Text style={paragraph}>
            {`It expires in ${OTP_EXPIRES_IN_S / 60} minutes. If you didn't ask for it, ignore this email.`}
          </Text>
          <Hr style={{ borderColor: "#E5E5E5", margin: "24px 0" }} />
          <Text style={footer}>
            {`You got this email because someone asked to sign in to ${APP_NAME} with this address.`}
            <br />
            Questions? Reply to this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
