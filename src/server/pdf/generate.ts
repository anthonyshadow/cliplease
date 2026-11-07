import "server-only";
import { Document, Font, renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import type { LicenseSnapshotV1 } from "@/lib/licensing/snapshot";
import { verifyPath } from "@/lib/urls";
import { env } from "../env";
import { pdfFonts } from "./fonts";
import { LicensePdf } from "./license-pdf";
import { licensePdfContent } from "./license-pdf-content";

// The license PDF, rendered on demand and never stored (02 §5.10; 07 D17). Besides the snapshot it reads two request
// facts that never change after checkout, the territory code and the terms acceptance time (owner answer Q-183,
// amending 07 D15's "the snapshot only" and 02 §5.10's one-argument signature). Its embedded fonts load before the
// words and the columns are measured with them (fonts.ts). A .ts file, so the element is built with createElement.

// Codes, handles and URLs never break (05 §9): react-pdf would hyphenate words otherwise.
Font.registerHyphenationCallback((word) => [word]);

/** The request facts the PDF prints next to the snapshot (Q-183). */
export type LicensePdfRequestFacts = {
  territoryCode: string | null;
  acceptedAt: Date;
};

/** The license PDF for `snapshot`: the same bytes on every render (01 J9.2), its creation date the issue time. */
export async function renderLicensePdf(
  snapshot: LicenseSnapshotV1,
  { territoryCode, acceptedAt }: LicensePdfRequestFacts,
): Promise<Buffer> {
  const fonts = await pdfFonts();
  const content = licensePdfContent(
    snapshot,
    {
      territoryCode,
      acceptedAt,
      verifyUrl: `${env.APP_URL}${verifyPath(snapshot.code)}`,
    },
    fonts.regular.family,
  );
  const { title, author, createdAt } = content.meta;
  return renderToBuffer(
    createElement(
      Document,
      { title, author, language: "en", creationDate: createdAt },
      createElement(LicensePdf, { content, face: fonts.regular }),
    ),
  );
}
