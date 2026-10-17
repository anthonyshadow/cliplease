import type { Metadata } from "next";
import { LegalPage } from "@/components/layout/legal-page";
import { PRIVACY_SECTIONS } from "./content";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return <LegalPage title="Privacy Policy" sections={PRIVACY_SECTIONS} />;
}
