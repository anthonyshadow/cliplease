import type { Metadata } from "next";
import { LegalPage } from "@/components/layout/legal-page";
import { TERMS_SECTIONS } from "./content";

const TITLE = "Terms of Service";

export const metadata: Metadata = { title: TITLE };

export default function TermsPage() {
  return <LegalPage title={TITLE} sections={TERMS_SECTIONS} />;
}
