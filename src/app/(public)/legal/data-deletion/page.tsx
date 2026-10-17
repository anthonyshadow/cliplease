import type { Metadata } from "next";
import { LegalPage } from "@/components/layout/legal-page";
import { DATA_DELETION_SECTIONS, DATA_DELETION_TITLE } from "./content";

export const metadata: Metadata = { title: { absolute: DATA_DELETION_TITLE } };

export default function DataDeletionPage() {
  return (
    <LegalPage title={DATA_DELETION_TITLE} sections={DATA_DELETION_SECTIONS} />
  );
}
