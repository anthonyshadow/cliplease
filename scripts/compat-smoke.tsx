// P00 compatibility smoke (07 D58, D108): react-pdf, react-email and Better Auth on Node 24.
// package.json has no "type", so tsx runs this file as CommonJS: no top-level await, and
// @react-pdf/renderer is loaded with a dynamic import because its ESM-only dependencies
// (@react-pdf/hyphenate) export only the "import" condition.
import { betterAuth } from "better-auth";
import { toNextJsHandler } from "better-auth/next-js";
import { Text as EmailText, Html, render } from "react-email";

const LINE = "ClipLease compatibility smoke";

function checkRuntime(): void {
  const [major, minor] = process.versions.node.split(".").map(Number);
  const bun = process.versions.bun;
  if (bun || major !== 24 || minor < 21) {
    const got = bun ? `bun ${bun}` : `node ${process.versions.node}`;
    throw new Error(
      `expected Node >= 24.21 on the 24 line (07 D107, R2), got ${got}`,
    );
  }
  console.log(`runtime node ${process.versions.node}`);
}

async function checkReactPdf(): Promise<string> {
  const { Document, Page, Text, renderToBuffer } = await import(
    "@react-pdf/renderer"
  );
  const buffer = await renderToBuffer(
    <Document>
      <Page>
        <Text>{LINE}</Text>
      </Page>
    </Document>,
  );
  const head = buffer.subarray(0, 4).toString("latin1");
  if (head !== "%PDF") {
    throw new Error(`buffer starts with ${JSON.stringify(head)}, not %PDF`);
  }
  return `renderToBuffer returned ${buffer.length} bytes starting with %PDF`;
}

async function checkReactEmail(): Promise<string> {
  const html = await render(
    <Html>
      <EmailText>{LINE}</EmailText>
    </Html>,
  );
  if (!html.includes(LINE)) {
    throw new Error("rendered HTML does not contain the line");
  }
  return `render returned ${html.length} chars containing the line`;
}

function checkBetterAuth(): string {
  if (
    typeof betterAuth !== "function" ||
    typeof toNextJsHandler !== "function"
  ) {
    throw new Error("betterAuth or toNextJsHandler is not a function");
  }
  const auth = betterAuth({
    secret: "compat-smoke-placeholder-not-a-real-secret-0000",
    baseURL: "http://localhost:3000",
  });
  const handlers = toNextJsHandler(auth);
  if (
    typeof handlers.GET !== "function" ||
    typeof handlers.POST !== "function"
  ) {
    throw new Error("toNextJsHandler(auth) did not return GET and POST");
  }
  return "imports are functions; betterAuth({ secret, baseURL }) built without a database; toNextJsHandler(auth) returned GET and POST";
}

async function main(): Promise<void> {
  checkRuntime();
  const checks: [string, () => Promise<string> | string][] = [
    ["react-pdf", checkReactPdf],
    ["react-email", checkReactEmail],
    ["better-auth", checkBetterAuth],
  ];
  let failed = false;
  for (const [name, check] of checks) {
    try {
      console.log(`OK ${name}: ${await check()}`);
    } catch (error) {
      failed = true;
      console.error(`FAIL ${name}:`, error);
    }
  }
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error("FAIL", error);
  process.exit(1);
});
