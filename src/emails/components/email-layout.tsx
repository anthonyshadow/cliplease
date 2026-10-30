import type { ReactNode } from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Section,
  Text,
} from "react-email";
import { APP_NAME } from "@/lib/app-name";
import { REQUEST_EMAIL_COPY as COPY } from "../request-copy";
import * as s from "./styles";

/** Who reads the email: the footer says why they got it (Q-124 a, Q-125 a). */
export type EmailAudience = "buyer" | "creator";

/**
 * Every outbox email's frame (05 §8): the wordmark as text, the headline (the subject's message), the paragraphs, the
 * context block (video title, scope), one table-based ink button with its URL printed under it, then the footer (with
 * any `footerLines` above the reason, as license-approved's public record link) and the test-mode line. No images, one
 * button.
 */
export function EmailLayout({
  headline,
  paragraphs,
  context,
  button,
  audience,
  footerLines = [],
}: {
  headline: string;
  paragraphs: readonly string[];
  context: readonly string[];
  button: { label: string; url: string };
  audience: EmailAudience;
  footerLines?: readonly ReactNode[];
}) {
  return (
    <Html lang="en">
      <Head />
      <Body style={s.body}>
        <Container style={s.container}>
          <Text style={s.wordmark}>{APP_NAME}</Text>
          <Heading as="h1" style={s.heading}>
            {headline}
          </Heading>
          {paragraphs.map((text) => (
            <Text key={text} style={s.paragraph}>
              {text}
            </Text>
          ))}
          <Section style={{ margin: "12px 0 24px" }}>
            {context.map((line) => (
              <Text key={line} style={s.footnote}>
                {line}
              </Text>
            ))}
          </Section>
          <Section>
            <Button href={button.url} style={s.button}>
              {button.label}
            </Button>
          </Section>
          <Text style={{ ...s.footnote, margin: "12px 0 0" }}>
            {`${COPY.orOpen} `}
            <Link href={button.url} style={s.link}>
              {button.url}
            </Link>
          </Text>
          <Hr style={s.hairline} />
          {footerLines.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list, never reordered
            <Text key={i} style={{ ...s.footnote, margin: "0 0 12px" }}>
              {line}
            </Text>
          ))}
          <Text style={s.footnote}>
            {audience === "buyer" ? COPY.buyerReason : COPY.creatorReason}
            <br />
            {COPY.questions}
          </Text>
          <Text style={{ ...s.footnote, margin: "12px 0 0" }}>
            {COPY.testMode}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
