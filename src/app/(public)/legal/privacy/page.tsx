import type { Metadata } from "next";
import { LegalPage } from "@/components/layout/legal-page";
import { PRIVACY_SECTIONS } from "./content";

const TITLE = "Privacy Policy";

export const metadata: Metadata = { title: TITLE };

export default function PrivacyPage() {
  return <LegalPage title={TITLE} sections={PRIVACY_SECTIONS} />;
}
