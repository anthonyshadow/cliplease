import type { Metadata } from "next";
import { LegalPage } from "@/components/layout/legal-page";
import { TERMS_SECTIONS } from "./content";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return <LegalPage title="Terms of Service" sections={TERMS_SECTIONS} />;
}
