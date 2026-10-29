import { Body, Container, Head, Heading, Hr, Html, Text } from "react-email";
import { APP_NAME } from "@/lib/app-name";
import { OTP_EXPIRES_IN_S } from "@/lib/sign-in";
import * as s from "./components/styles";

// The sign-in code email (05 §8, row sign-in-code). No images, no button.

// The code in title-1 size with the code tracking (04 §4).
const code = {
  fontSize: "28px",
  lineHeight: "34px",
  fontWeight: 600,
  letterSpacing: "0.04em",
  margin: "0 0 16px",
};

/** The code grouped 3 + 3 ("123 456"), as one string so the HTML keeps it together. */
export function groupCode(value: string): string {
  return `${value.slice(0, 3)} ${value.slice(3)}`;
}

export function SignInCode({ code: value }: { code: string }) {
  return (
    <Html lang="en">
      <Head />
      <Body style={s.body}>
        <Container style={s.container}>
          <Text style={s.wordmark}>{APP_NAME}</Text>
          <Heading as="h1" style={s.heading}>
            Your sign-in code
          </Heading>
          <Text style={s.paragraph}>Enter this code to sign in:</Text>
          <Text style={code}>{groupCode(value)}</Text>
          <Text style={s.paragraph}>
            {`It expires in ${OTP_EXPIRES_IN_S / 60} minutes. If you didn't ask for it, ignore this email.`}
          </Text>
          <Hr style={s.hairline} />
          <Text style={s.footnote}>
            {`You got this email because someone asked to sign in to ${APP_NAME} with this address.`}
            <br />
            Questions? Reply to this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
